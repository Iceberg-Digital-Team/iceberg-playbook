// admin-users Edge Function: every /api/admin/* operation of docs/USER_MANAGEMENT_API.md §9.
// Pure handler (no Deno APIs): index.ts passes the real dependencies, tests pass fakes.
//
// Defense in depth (safe with and without the platform verify_jwt check):
//   1. the handler validates the Bearer JWT with Supabase Auth (getAuthUser);
//   2. the handler checks the caller is an active Admin (fn_admin_current_caller, caller's JWT);
//   3. every admin RPC runs with the caller's own Authorization header, so the database checks
//      again that auth.uid() is an active Admin (migration 12).
// No admin RPC runs before 1 and 2 pass. No user id is ever taken from the body.
// The secret key is used only for the JWT check and the Supabase Auth ban / unban.
import { ApiError, mapRpcError, toApiError } from '../_shared/errors.ts';
import { errorResponse, evaluateCors, json, matchRoute, readJsonBody, routePath } from '../_shared/http.ts';
import type { RouteDefinition } from '../_shared/http.ts';
import { safeLog } from '../_shared/log.ts';
import { toAdminUser, toIssuedLink, toUserList } from '../_shared/mappers.ts';
import { isIsoDate, isRole, isUuid } from '../_shared/rules.ts';
import { generateToken, hashToken } from '../_shared/tokens.ts';
import type { AdminDeps } from '../_shared/types.ts';

type Action =
  | 'listUsers'
  | 'createInvitation'
  | 'resendInvitation'
  | 'revokeInvitation'
  | 'changeRole'
  | 'disableUser'
  | 'enableUser'
  | 'createPasswordLink';

const ROUTES: RouteDefinition<Action>[] = [
  { pattern: /^\/users$/, methods: { GET: 'listUsers' } },
  { pattern: /^\/invitations$/, methods: { POST: 'createInvitation' } },
  { pattern: /^\/invitations\/([^/]+)\/resend$/, methods: { POST: 'resendInvitation' } },
  { pattern: /^\/invitations\/([^/]+)$/, methods: { DELETE: 'revokeInvitation' } },
  { pattern: /^\/users\/([^/]+)\/role$/, methods: { PATCH: 'changeRole' } },
  { pattern: /^\/users\/([^/]+)\/disable$/, methods: { POST: 'disableUser' } },
  { pattern: /^\/users\/([^/]+)\/enable$/, methods: { POST: 'enableUser' } },
  { pattern: /^\/users\/([^/]+)\/password-links$/, methods: { POST: 'createPasswordLink' } },
];

function bearerHeader(request: Request): string {
  const header = request.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+$/i.test(header.trim())) throw new ApiError('unauthenticated');
  return header.trim();
}

// Steps 1 and 2 above. Missing / invalid JWT -> 401; not an active Admin -> 403;
// Auth server or database unreachable -> 500 (never a silent pass).
async function verifyAdminCaller(deps: AdminDeps, authorization: string): Promise<void> {
  const jwt = authorization.replace(/^Bearer\s+/i, '');

  let user: { userId: string | null; error: { status?: number } | null };
  try {
    user = await deps.getAuthUser(jwt);
  } catch {
    safeLog('caller_check_failed', { step: 'auth' });
    throw new ApiError('unknown');
  }
  // No HTTP status (network failure, status 0) or 5xx: the Auth server could not answer.
  const status = user.error?.status;
  if (user.error && (!status || status >= 500)) {
    safeLog('caller_check_failed', { step: 'auth' });
    throw new ApiError('unknown');
  }
  if (user.error || !isUuid(user.userId)) throw new ApiError('unauthenticated');

  let admin: Awaited<ReturnType<AdminDeps['checkActiveAdmin']>>;
  try {
    admin = await deps.checkActiveAdmin(authorization);
  } catch {
    safeLog('caller_check_failed', { step: 'admin' });
    throw new ApiError('unknown');
  }
  if (admin.error) throw mapRpcError(admin.error, 'fn_admin_current_caller');
  const callerId = (admin.data as Record<string, unknown> | null)?.user_id;
  // The database must see the same user the Auth server confirmed.
  if (callerId !== user.userId) {
    safeLog('caller_mismatch', { step: 'admin' });
    throw new ApiError('unauthenticated');
  }
}

function requireId(value: string | undefined): string {
  if (!isUuid(value)) throw new ApiError('invalid_input', 'The id in the path is not valid.');
  return value;
}

function requireString(body: Record<string, unknown>, key: string, label: string): string {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim()) throw new ApiError('invalid_input', `${label} is required.`);
  return value;
}

function requireExpiry(body: Record<string, unknown>): string {
  const value = body.expiresAt;
  if (!isIsoDate(value)) throw new ApiError('invalid_input', 'Choose a valid expiry date.');
  return value;
}

export async function handleAdminUsers(request: Request, deps: AdminDeps): Promise<Response> {
  const cors = evaluateCors(request, deps.allowedOrigins);
  if (!cors.ok) return errorResponse(new ApiError('forbidden', 'This origin is not allowed.'));
  if (request.method === 'OPTIONS') return json(204, null, cors.headers);

  try {
    // No partial work without configuration.
    if (!deps.keys.publishableKey || !deps.keys.secretKey) {
      safeLog('config_missing', { step: 'admin-users' });
      throw new ApiError('unknown');
    }

    const { action, params } = matchRoute(ROUTES, request.method, routePath(new URL(request.url), 'admin-users'));
    const authorization = bearerHeader(request);
    await verifyAdminCaller(deps, authorization);

    const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
      const { data, error } = await deps.callerRpc(authorization, fn, args);
      if (error) throw mapRpcError(error, fn);
      return data;
    };

    switch (action) {
      case 'listUsers':
        return json(200, toUserList(await rpc('fn_admin_list_users', {})), cors.headers);

      case 'createInvitation': {
        const body = await readJsonBody(request);
        const email = requireString(body, 'email', 'Email');
        const fullName = requireString(body, 'fullName', 'Name');
        if (!isRole(body.role)) throw new ApiError('invalid_input', 'Choose a valid role.');
        const expiresAt = requireExpiry(body);
        const token = generateToken();
        const data = await rpc('fn_admin_create_invitation', {
          p_email: email,
          p_full_name: fullName,
          p_role: body.role,
          p_expires_at: expiresAt,
          p_token_hash: await hashToken(token),
        });
        return json(201, toIssuedLink(data, token), cors.headers);
      }

      case 'resendInvitation': {
        const invitationId = requireId(params[0]);
        const expiresAt = requireExpiry(await readJsonBody(request));
        const token = generateToken();
        const data = await rpc('fn_admin_resend_invitation', {
          p_invitation_id: invitationId,
          p_expires_at: expiresAt,
          p_token_hash: await hashToken(token),
        });
        return json(200, toIssuedLink(data, token), cors.headers);
      }

      case 'revokeInvitation': {
        await rpc('fn_admin_revoke_invitation', { p_invitation_id: requireId(params[0]) });
        return json(204, null, cors.headers);
      }

      case 'changeRole': {
        const userId = requireId(params[0]);
        const body = await readJsonBody(request);
        if (!isRole(body.role)) throw new ApiError('invalid_input', 'Choose a valid role.');
        const data = await rpc('fn_admin_change_user_role', { p_user_id: userId, p_role: body.role });
        return json(200, toAdminUser(data), cors.headers);
      }

      case 'disableUser':
      case 'enableUser': {
        const userId = requireId(params[0]);
        const disabling = action === 'disableUser';
        const data = await rpc(disabling ? 'fn_admin_disable_user' : 'fn_admin_enable_user', { p_user_id: userId });
        await syncSignIn(deps, authorization, userId, disabling);
        return json(200, toAdminUser(data), cors.headers);
      }

      case 'createPasswordLink': {
        const userId = requireId(params[0]);
        const expiresAt = requireExpiry(await readJsonBody(request));
        const token = generateToken();
        const data = await rpc('fn_admin_create_password_reset_link', {
          p_user_id: userId,
          p_expires_at: expiresAt,
          p_token_hash: await hashToken(token),
        });
        return json(201, toIssuedLink(data, token), cors.headers);
      }
    }
  } catch (error) {
    return errorResponse(toApiError(error, 'admin-users'), cors.headers);
  }
}

// After the database step: block (disable) or allow (enable) sign-in in Supabase Auth.
// If that fails, the database step is rolled back with the opposite function and an error is
// returned. Never a silent success.
async function syncSignIn(deps: AdminDeps, authorization: string, userId: string, disabling: boolean): Promise<void> {
  const step = disabling ? 'ban' : 'unban';
  let failed = false;
  try {
    const { error } = await deps.setUserBanned(userId, disabling);
    failed = error !== null;
  } catch {
    failed = true;
  }
  if (!failed) return;

  safeLog('auth_sync_failed', { step });
  let rolledBack = false;
  try {
    const { error } = await deps.callerRpc(
      authorization,
      disabling ? 'fn_admin_enable_user' : 'fn_admin_disable_user',
      { p_user_id: userId },
    );
    rolledBack = error === null;
  } catch {
    rolledBack = false;
  }

  if (!rolledBack) {
    safeLog('auth_sync_rollback_failed', { step });
    throw new ApiError('unknown', disabling
      ? 'The user is disabled in the app, but sign-in could not be blocked. Contact the system owner.'
      : 'The user is enabled in the app, but sign-in is still blocked. Contact the system owner.');
  }
  throw new ApiError('unknown', disabling
    ? 'Could not block sign-in. The user was not disabled. Try again.'
    : 'Could not allow sign-in. The user is still disabled. Try again.');
}
