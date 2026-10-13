// auth-links Edge Function: token lookup and account activation (docs/USER_MANAGEMENT_API.md §8, §9, §11).
// Public endpoint (deployed with --no-verify-jwt): authorized only by the link token, and it
// protects itself: token format check, rate limits per client IP and per token, and expiry /
// single use / revocation enforced by the database functions.
// Pure handler (no Deno APIs): index.ts passes the real dependencies, tests pass fakes.
//
// The raw token never reaches the database: only its SHA-256 hash. Passwords are never logged
// and never put in error messages.
import { ApiError, mapRpcError, toApiError } from '../_shared/errors.ts';
import { errorResponse, evaluateCors, json, matchRoute, readJsonBody, routePath } from '../_shared/http.ts';
import type { RouteDefinition } from '../_shared/http.ts';
import { safeLog } from '../_shared/log.ts';
import { toActivationLinkInfo, toActivationResult } from '../_shared/mappers.ts';
import { clientIp, enforceRateLimit, UNKNOWN_CLIENT_IP } from '../_shared/rateLimit.ts';
import { isUuid, validatePassword } from '../_shared/rules.ts';
import { hashToken, normalizeIncomingToken } from '../_shared/tokens.ts';
import type { AuthAdminError, AuthLinkDeps, LinkPurpose } from '../_shared/types.ts';

type Action = 'lookup' | 'activate';

const ROUTES: RouteDefinition<Action>[] = [
  { pattern: /^\/invitations\/lookup$/, methods: { POST: 'lookup' } },
  { pattern: /^\/activate$/, methods: { POST: 'activate' } },
];

// Maximum wait for one Supabase Auth admin call. Well below the 60 second link lease
// (fn_claim_activation_link), so a slow call can never outlive this request's lease.
export const AUTH_CALL_TIMEOUT_MS = 20_000;

const WEAK_PASSWORD_MESSAGE = 'This password does not meet the password policy. Choose a stronger password.';
const PASSWORD_NOT_SAVED_MESSAGE = 'Your password could not be saved. Please try again.';
const AUTH_TIMEOUT_MESSAGE = 'Your password could not be saved. Please wait a minute and try again.';
const RESET_NOT_CLOSED_MESSAGE = 'Your new password may already work, but the link could not be closed. Try to sign in; if that does not work, ask your Admin for a new password link.';

interface FoundAuthUser {
  userId: string;
  hasProfile: boolean;
}

interface Claim {
  claimId: string;
  purpose: LinkPurpose;
  email: string;
  userId: string | null;
}

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

interface Context {
  deps: AuthLinkDeps;
  rpc: Rpc;
  timeoutMs: number;
}

// An Auth call timed out: its write may still land, so the lease is KEPT (not released) and
// ends by itself after 60 seconds. Nobody can claim the link before a late write has landed.
class LeaseKeptError extends ApiError {}

export async function handleAuthLinks(request: Request, deps: AuthLinkDeps): Promise<Response> {
  const cors = evaluateCors(request, deps.allowedOrigins);
  if (!cors.ok) return errorResponse(new ApiError('forbidden', 'This origin is not allowed.'));
  if (request.method === 'OPTIONS') return json(204, null, cors.headers);

  try {
    const secretKey = deps.keys.secretKey;
    if (!secretKey) {
      safeLog('config_missing', { step: 'auth-links' });
      throw new ApiError('unknown');
    }

    // Checks without any database call first.
    const { action } = matchRoute(ROUTES, request.method, routePath(new URL(request.url), 'auth-links'));
    const body = await readJsonBody(request);
    const token = normalizeIncomingToken(body.token);
    if (!token) throw new ApiError('token_invalid');

    let password = '';
    if (action === 'activate') {
      password = typeof body.password === 'string' ? body.password : '';
      const passwordError = validatePassword(password);
      if (passwordError) throw new ApiError('invalid_input', passwordError);
    }

    // Rate limits (database-backed): per client IP, then per token. Over the limit -> 429, no other work.
    const ip = clientIp(request);
    if (ip === UNKNOWN_CLIENT_IP) safeLog('client_ip_missing', { step: action });
    await enforceRateLimit(deps.rateLimitHit, secretKey, action === 'lookup' ? 'lookup-ip' : 'activate-ip', ip);
    const tokenHash = await hashToken(token);
    await enforceRateLimit(deps.rateLimitHit, secretKey, 'token', tokenHash);

    const rpc: Rpc = async (fn, args) => {
      const { data, error } = await deps.serviceRpc(fn, args);
      if (error) throw mapRpcError(error, fn);
      return data;
    };

    if (action === 'lookup') {
      const info = await rpc('fn_get_activation_link', { p_token_hash: tokenHash });
      return json(200, toActivationLinkInfo(info), cors.headers);
    }

    const context: Context = { deps, rpc, timeoutMs: deps.authTimeoutMs ?? AUTH_CALL_TIMEOUT_MS };
    return json(200, await activate(context, tokenHash, password), cors.headers);
  } catch (error) {
    return errorResponse(toApiError(error, 'auth-links'), cors.headers);
  }
}

// Activation (docs §11): claim a 60 second lease on the link -> set the password in Supabase Auth
// -> accept with the claim id. Only the lease holder touches a password; a parallel request gets
// link_busy. On any failure the lease is released and the link stays usable (a rejected password
// never uses up a link), except after an Auth timeout (LeaseKeptError).
async function activate(context: Context, tokenHash: string, password: string) {
  const claim = toClaim(await context.rpc('fn_claim_activation_link', { p_token_hash: tokenHash }));
  try {
    return claim.purpose === 'password_reset'
      ? await activatePasswordReset(context, claim, password)
      : await activateInvitation(context, claim, password);
  } catch (error) {
    if (!(error instanceof LeaseKeptError)) await releaseClaim(context, claim.claimId);
    throw error;
  }
}

function toClaim(value: unknown): Claim {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const purpose = row?.purpose;
  if (!row || !isUuid(row.claim_id) || typeof row.email !== 'string'
      || (purpose !== 'invitation' && purpose !== 'password_reset')) {
    throw new ApiError('unknown');
  }
  return {
    claimId: row.claim_id,
    purpose,
    email: row.email,
    userId: isUuid(row.user_id) ? row.user_id : null,
  };
}

// Best effort: if it fails, the lease still ends by itself after 60 seconds.
async function releaseClaim(context: Context, claimId: string): Promise<void> {
  try {
    const { error } = await context.deps.serviceRpc('fn_release_activation_link', { p_claim_id: claimId });
    if (error) safeLog('release_failed', { step: 'activate' });
  } catch {
    safeLog('release_failed', { step: 'activate' });
  }
}

// Password reset: set the new password while holding the lease, then accept.
async function activatePasswordReset(context: Context, claim: Claim, password: string) {
  if (!claim.userId) throw new ApiError('unknown');
  await savePassword(context, claim.userId, password, false, 'password_reset');
  try {
    // Never return user_id to the browser.
    return toActivationResult(await context.rpc('fn_accept_password_reset', { p_claim_id: claim.claimId }));
  } catch (error) {
    safeLog('accept_after_password_failed', { step: 'password_reset' });
    if (error instanceof ApiError && error.code === 'unknown') throw new ApiError('unknown', RESET_NOT_CLOSED_MESSAGE);
    throw error;
  }
}

// Invitation (docs §11 activation order), all while holding the lease:
//   existing account WITH a profile -> email_in_use, its password is never touched;
//   no account -> create it with this password, then accept;
//   account WITHOUT a profile (left from an earlier failed try) -> set the password, then accept.
async function activateInvitation(context: Context, claim: Claim, password: string) {
  const found = await findAuthUser(context.rpc, claim.email);
  if (found?.hasProfile) throw new ApiError('email_in_use');
  if (found) return acceptOrphan(context, claim, found.userId, password);

  const created = await createUser(context, claim.email, password);
  if (created.userId) return acceptInvitation(context, claim, created.userId);

  // Supabase Auth password policy (e.g. leaked password protection) rejected it: the lease is
  // released, the link stays usable and the user can choose another password.
  if (created.error && isWeakPasswordError(created.error)) {
    safeLog('create_user_failed', { step: 'invitation', code: 'weak_password' });
    throw new ApiError('invalid_input', WEAK_PASSWORD_MESSAGE);
  }

  // An auth account appeared after the lookup (e.g. left from an earlier try): continue as an orphan, or stop.
  if (created.error && isEmailExistsError(created.error)) {
    const again = await findAuthUser(context.rpc, claim.email);
    if (again?.hasProfile) throw new ApiError('email_in_use');
    if (again) return acceptOrphan(context, claim, again.userId, password);
  }
  safeLog('create_user_failed', { step: 'invitation', code: created.error?.code ?? 'none' });
  throw new ApiError('unknown');
}

async function acceptOrphan(context: Context, claim: Claim, userId: string, password: string) {
  await savePassword(context, userId, password, true, 'invitation');
  return acceptInvitation(context, claim, userId);
}

async function acceptInvitation(context: Context, claim: Claim, userId: string) {
  return toActivationResult(await context.rpc('fn_accept_invitation', { p_claim_id: claim.claimId, p_auth_user_id: userId }));
}

async function findAuthUser(rpc: Rpc, email: string): Promise<FoundAuthUser | null> {
  const data = await rpc('fn_find_auth_user_by_email', { p_email: email });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  if (!isUuid(record.user_id)) return null;
  return { userId: record.user_id, hasProfile: record.has_profile === true };
}

// Every Supabase Auth admin call waits at most context.timeoutMs. On a timeout the lease is kept
// (LeaseKeptError) because the write may still land in Supabase Auth.
async function withAuthTimeout<T>(context: Context, call: Promise<T>, step: 'create' | 'update'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      safeLog('auth_call_timeout', { step });
      reject(new LeaseKeptError('unknown', AUTH_TIMEOUT_MESSAGE));
    }, context.timeoutMs);
  });
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function createUser(context: Context, email: string, password: string) {
  try {
    return await withAuthTimeout(context, context.deps.createAuthUser(email, password), 'create');
  } catch (error) {
    if (error instanceof LeaseKeptError) throw error;
    return { userId: null, error: { message: 'create user failed', code: 'exception' } };
  }
}

async function updatePassword(
  context: Context,
  userId: string,
  password: string,
  emailConfirm: boolean,
): Promise<'ok' | 'weak_password' | 'failed'> {
  try {
    const { error } = await withAuthTimeout(context, context.deps.updateAuthUser(userId, { password, emailConfirm }), 'update');
    if (!error) return 'ok';
    return isWeakPasswordError(error) ? 'weak_password' : 'failed';
  } catch (error) {
    if (error instanceof LeaseKeptError) throw error;
    return 'failed';
  }
}

// Weak / leaked password -> 400 (the caller releases the lease, the link stays usable);
// other failure -> 500 with a "try again" message.
async function savePassword(
  context: Context,
  userId: string,
  password: string,
  emailConfirm: boolean,
  step: 'invitation' | 'password_reset',
): Promise<void> {
  const outcome = await updatePassword(context, userId, password, emailConfirm);
  if (outcome === 'ok') return;
  safeLog('password_update_failed', { step, code: outcome });
  if (outcome === 'weak_password') throw new ApiError('invalid_input', WEAK_PASSWORD_MESSAGE);
  throw new ApiError('unknown', PASSWORD_NOT_SAVED_MESSAGE);
}

// Supabase Auth has its own password policy (length, character classes, leaked password check).
function isWeakPasswordError(error: AuthAdminError): boolean {
  return error.code === 'weak_password' || /weak[_ ]password|password is known to be weak|pwned|leaked/i.test(error.message);
}

function isEmailExistsError(error: AuthAdminError): boolean {
  return error.code === 'email_exists'
    || error.code === 'user_already_exists'
    || /already (been )?registered|already exists/i.test(error.message);
}
