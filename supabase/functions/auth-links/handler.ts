// auth-links Edge Function: token lookup and account activation (docs/USER_MANAGEMENT_API.md §8, §9, §11).
// Public endpoint (deployed with --no-verify-jwt): authorized only by the link token.
// Pure handler (no Deno APIs): index.ts passes the real dependencies, tests pass fakes.
//
// The raw token never reaches the database: only its SHA-256 hash. Passwords are never logged
// and never put in error messages.
import { ApiError, mapRpcError, toApiError } from '../_shared/errors.ts';
import { errorResponse, evaluateCors, json, matchRoute, readJsonBody, routePath } from '../_shared/http.ts';
import type { RouteDefinition } from '../_shared/http.ts';
import { safeLog } from '../_shared/log.ts';
import { toActivationLinkInfo, toActivationResult } from '../_shared/mappers.ts';
import { isUuid, validatePassword } from '../_shared/rules.ts';
import { hashToken, normalizeIncomingToken } from '../_shared/tokens.ts';
import type { AuthAdminError, AuthLinkDeps } from '../_shared/types.ts';

type Action = 'lookup' | 'activate';

const ROUTES: RouteDefinition<Action>[] = [
  { pattern: /^\/invitations\/lookup$/, methods: { POST: 'lookup' } },
  { pattern: /^\/activate$/, methods: { POST: 'activate' } },
];

interface FoundAuthUser {
  userId: string;
  hasProfile: boolean;
}

export async function handleAuthLinks(request: Request, deps: AuthLinkDeps): Promise<Response> {
  const cors = evaluateCors(request, deps.allowedOrigins);
  if (!cors.ok) return errorResponse(new ApiError('forbidden', 'This origin is not allowed.'));
  if (request.method === 'OPTIONS') return json(204, null, cors.headers);

  try {
    if (!deps.keys.secretKey) {
      safeLog('config_missing', { step: 'auth-links' });
      throw new ApiError('unknown');
    }

    const { action } = matchRoute(ROUTES, request.method, routePath(new URL(request.url), 'auth-links'));
    const body = await readJsonBody(request);
    const token = normalizeIncomingToken(body.token);
    if (!token) throw new ApiError('token_invalid');

    const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
      const { data, error } = await deps.serviceRpc(fn, args);
      if (error) throw mapRpcError(error, fn);
      return data;
    };

    if (action === 'lookup') {
      const info = await rpc('fn_get_activation_link', { p_token_hash: await hashToken(token) });
      return json(200, toActivationLinkInfo(info), cors.headers);
    }

    const password = typeof body.password === 'string' ? body.password : '';
    const passwordError = validatePassword(password);
    if (passwordError) throw new ApiError('invalid_input', passwordError);

    const tokenHash = await hashToken(token);
    const info = toActivationLinkInfo(await rpc('fn_get_activation_link', { p_token_hash: tokenHash }));
    const result = info.purpose === 'password_reset'
      ? await activatePasswordReset(deps, rpc, tokenHash, password)
      : await activateInvitation(deps, rpc, tokenHash, info.email, password);
    return json(200, result, cors.headers);
  } catch (error) {
    return errorResponse(toApiError(error, 'auth-links'), cors.headers);
  }
}

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

// Password reset: claim the link in the database FIRST (single use), then set the password.
async function activatePasswordReset(deps: AuthLinkDeps, rpc: Rpc, tokenHash: string, password: string) {
  const claim = await rpc('fn_accept_password_reset', { p_token_hash: tokenHash });
  const userId = (claim as Record<string, unknown> | null)?.user_id;
  if (!isUuid(userId)) throw new ApiError('unknown');

  const outcome = await updatePassword(deps, userId, password, false);
  if (outcome !== 'ok') {
    safeLog('password_update_failed', { step: 'password_reset', code: outcome });
    if (outcome === 'weak_password') {
      throw new ApiError('invalid_input', 'Your link was used, but the new password was too weak for the password policy and could not be saved. Ask your Admin for a new password link.');
    }
    throw new ApiError('unknown', 'Your link was used, but the new password could not be saved. Ask your Admin for a new password link.');
  }
  // Never return user_id to the browser.
  return toActivationResult(claim);
}

// Invitation (docs §11 activation order):
//   existing account WITH a profile -> email_in_use, its password is never touched;
//   no account -> create it with this password, then accept;
//   account WITHOUT a profile (left from an earlier failed try) -> accept FIRST, then set the password.
// The accept function locks the link (FOR UPDATE), so only one request can succeed; a password of an
// existing auth user is changed only after this request's accept succeeded.
async function activateInvitation(deps: AuthLinkDeps, rpc: Rpc, tokenHash: string, email: string, password: string) {
  const found = await findAuthUser(rpc, email);
  if (found?.hasProfile) throw new ApiError('email_in_use');
  if (found) return acceptOrphan(deps, rpc, tokenHash, found.userId, password);

  const created = await safeCreateUser(deps, email, password);
  if (created.userId) {
    return toActivationResult(await rpc('fn_accept_invitation', { p_token_hash: tokenHash, p_auth_user_id: created.userId }));
  }

  // Supabase Auth password policy is stricter than ours: no link was used, the user can try again.
  if (created.error && isWeakPasswordError(created.error)) {
    safeLog('create_user_failed', { step: 'invitation', code: 'weak_password' });
    throw new ApiError('invalid_input', WEAK_PASSWORD_MESSAGE);
  }

  // A concurrent request created the account a moment ago: continue as an orphan, or stop.
  if (created.error && isEmailExistsError(created.error)) {
    const again = await findAuthUser(rpc, email);
    if (again?.hasProfile) throw new ApiError('email_in_use');
    if (again) return acceptOrphan(deps, rpc, tokenHash, again.userId, password);
  }
  safeLog('create_user_failed', { step: 'invitation', code: created.error?.code ?? 'none' });
  throw new ApiError('unknown');
}

async function acceptOrphan(deps: AuthLinkDeps, rpc: Rpc, tokenHash: string, userId: string, password: string) {
  const accepted = await rpc('fn_accept_invitation', { p_token_hash: tokenHash, p_auth_user_id: userId });
  const outcome = await updatePassword(deps, userId, password, true);
  if (outcome !== 'ok') {
    safeLog('password_update_failed', { step: 'invitation', code: outcome });
    if (outcome === 'weak_password') {
      throw new ApiError('invalid_input', 'Your account was created, but the password was too weak for the password policy and could not be saved. Ask your Admin for a password link.');
    }
    throw new ApiError('unknown', 'Your account was created, but the password could not be saved. Ask your Admin for a password link.');
  }
  return toActivationResult(accepted);
}

async function findAuthUser(rpc: Rpc, email: string): Promise<FoundAuthUser | null> {
  const data = await rpc('fn_find_auth_user_by_email', { p_email: email });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  if (!isUuid(record.user_id)) return null;
  return { userId: record.user_id, hasProfile: record.has_profile === true };
}

async function safeCreateUser(deps: AuthLinkDeps, email: string, password: string) {
  try {
    return await deps.createAuthUser(email, password);
  } catch {
    return { userId: null, error: { message: 'create user failed', code: 'exception' } };
  }
}

async function updatePassword(
  deps: AuthLinkDeps,
  userId: string,
  password: string,
  emailConfirm: boolean,
): Promise<'ok' | 'weak_password' | 'failed'> {
  try {
    const { error } = await deps.updateAuthUser(userId, { password, emailConfirm });
    if (!error) return 'ok';
    return isWeakPasswordError(error) ? 'weak_password' : 'failed';
  } catch {
    return 'failed';
  }
}

const WEAK_PASSWORD_MESSAGE = 'This password does not meet the password policy. Choose a stronger password.';

// Supabase Auth has its own password policy (length, character classes, leaked password check).
function isWeakPasswordError(error: AuthAdminError): boolean {
  return error.code === 'weak_password' || /weak[_ ]password|password is known to be weak|pwned|leaked/i.test(error.message);
}

function isEmailExistsError(error: AuthAdminError): boolean {
  return error.code === 'email_exists'
    || error.code === 'user_already_exists'
    || /already (been )?registered|already exists/i.test(error.message);
}
