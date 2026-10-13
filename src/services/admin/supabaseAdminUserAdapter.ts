// Supabase implementation of AdminUserAdapter (reference backend).
// It calls ONLY the two Edge Functions of docs/USER_MANAGEMENT_API.md §9 through
// supabase.functions.invoke: 'admin-users' (caller's session JWT, attached by supabase-js)
// and 'auth-links' (public, authorized by the link token).
// This is the only file that knows Supabase function names and paths; an Iceberg adapter
// replaces this file and the configureAdminUserService call in src/main.tsx.
import { supabase } from '../../lib/supabase';
import { isRole } from '../adminUserRules';
import { ADMIN_ERROR_MESSAGES, AdminUserError } from '../adminUserService';
import type {
  ActivateAccountInput,
  ActivationLinkInfo,
  ActivationResult,
  AdminSuggestion,
  AdminUser,
  AdminUserAdapter,
  AdminUserErrorCode,
  Invitation,
  InviteUserInput,
  IssuedLink,
} from '../adminUserService';

export const ADMIN_USERS_FUNCTION = 'admin-users';
export const AUTH_LINKS_FUNCTION = 'auth-links';

type InvokeMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

// The small part of SupabaseClient this adapter uses (tests pass a fake).
export interface AdminFunctionsClient {
  auth: {
    getSession(): Promise<{ data: { session: { access_token: string } | null }; error: unknown }>;
  };
  functions: {
    invoke(
      functionName: string,
      options?: { method?: InvokeMethod; body?: Record<string, unknown> },
    ): Promise<{ data: unknown; error: unknown }>;
  };
}

// ---- Response guards: wrong shape -> AdminUserError('unknown'); only contract fields are kept ----

type Row = Record<string, unknown>;

function badResponse(): AdminUserError {
  return new AdminUserError('unknown', 'The server returned an unexpected response.');
}

function asRow(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badResponse();
  return value as Row;
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || !value) throw badResponse();
  return value;
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw badResponse();
  return value;
}

function oneOf<T extends string>(row: Row, key: string, allowed: readonly T[]): T {
  const value = row[key];
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw badResponse();
  return value as T;
}

function role(row: Row) {
  const value = row.role;
  if (!isRole(value)) throw badResponse();
  return value;
}

const PURPOSES = ['invitation', 'password_reset'] as const;

function toAdminUser(value: unknown): AdminUser {
  const row = asRow(value);
  return {
    id: text(row, 'id'),
    email: text(row, 'email'),
    fullName: text(row, 'fullName'),
    role: role(row),
    status: oneOf(row, 'status', ['Active', 'Disabled'] as const),
    createdAt: text(row, 'createdAt'),
  };
}

function toInvitation(value: unknown): Invitation {
  const row = asRow(value);
  return {
    id: text(row, 'id'),
    purpose: oneOf(row, 'purpose', PURPOSES),
    email: text(row, 'email'),
    fullName: text(row, 'fullName'),
    role: role(row),
    userId: nullableText(row, 'userId'),
    status: oneOf(row, 'status', ['Pending', 'Accepted', 'Expired', 'Revoked'] as const),
    expiresAt: text(row, 'expiresAt'),
    acceptedAt: nullableText(row, 'acceptedAt'),
    revokedAt: nullableText(row, 'revokedAt'),
    invitedBy: nullableText(row, 'invitedBy'),
    createdAt: text(row, 'createdAt'),
  };
}

function toUserList(value: unknown): { users: AdminUser[]; invitations: Invitation[] } {
  const row = asRow(value);
  if (!Array.isArray(row.users) || !Array.isArray(row.invitations)) throw badResponse();
  return { users: row.users.map(toAdminUser), invitations: row.invitations.map(toInvitation) };
}

function toIssuedLink(value: unknown): IssuedLink {
  const row = asRow(value);
  return {
    invitationId: text(row, 'invitationId'),
    purpose: oneOf(row, 'purpose', PURPOSES),
    email: text(row, 'email'),
    expiresAt: text(row, 'expiresAt'),
    delivery: oneOf(row, 'delivery', ['manual', 'email'] as const),
    token: nullableText(row, 'token'),
  };
}

function toActivationLinkInfo(value: unknown): ActivationLinkInfo {
  const row = asRow(value);
  return {
    purpose: oneOf(row, 'purpose', PURPOSES),
    status: oneOf(row, 'status', ['Pending'] as const),
    email: text(row, 'email'),
    fullName: text(row, 'fullName'),
    role: role(row),
    expiresAt: text(row, 'expiresAt'),
  };
}

function toActivationResult(value: unknown): ActivationResult {
  const row = asRow(value);
  return { purpose: oneOf(row, 'purpose', PURPOSES), email: text(row, 'email') };
}

// ---- Error mapping ----

function isErrorCode(value: unknown): value is AdminUserErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ADMIN_ERROR_MESSAGES, value);
}

function toSuggestion(value: unknown): AdminSuggestion | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Row;
  if ((row.action === 'create_password_link' || row.action === 'enable_user') && typeof row.userId === 'string' && row.userId) {
    return { action: row.action, userId: row.userId };
  }
  if (row.action === 'resend_invitation' && typeof row.invitationId === 'string' && row.invitationId) {
    return { action: 'resend_invitation', invitationId: row.invitationId };
  }
  return null;
}

// Edge Function error body: { error: { code, message, suggestion } } (docs §9).
function fromErrorBody(body: unknown): AdminUserError | null {
  if (!body || typeof body !== 'object') return null;
  const error = (body as Row).error;
  if (!error || typeof error !== 'object') return null;
  const { code, message, suggestion } = error as Row;
  if (!isErrorCode(code)) return new AdminUserError('unknown');
  return new AdminUserError(code, typeof message === 'string' && message.trim() ? message : undefined, toSuggestion(suggestion));
}

interface ResponseLike {
  status: number;
  json(): Promise<unknown>;
}

function isResponseLike(value: unknown): value is ResponseLike {
  return !!value && typeof value === 'object'
    && typeof (value as ResponseLike).status === 'number'
    && typeof (value as ResponseLike).json === 'function';
}

// functions-js returns (never throws) FunctionsHttpError (context = Response),
// FunctionsRelayError or FunctionsFetchError; each sets error.name to its class name.
async function toAdminUserError(error: unknown): Promise<AdminUserError> {
  const name = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined;
  if (name === 'FunctionsFetchError') return new AdminUserError('network');
  if (name === 'FunctionsHttpError') {
    const context = (error as { context?: unknown }).context;
    if (isResponseLike(context)) {
      let body: unknown = null;
      try {
        body = await context.json();
      } catch {
        body = null;
      }
      const mapped = fromErrorBody(body);
      if (mapped) return mapped;
      // e.g. the platform gateway rejecting the JWT with its own body
      if (context.status === 401) return new AdminUserError('unauthenticated');
    }
    return new AdminUserError('unknown');
  }
  return new AdminUserError('unknown');
}

// ---- Adapter ----

export function createSupabaseAdminUserAdapter(client: AdminFunctionsClient = supabase): AdminUserAdapter {
  // Admin calls need a signed-in user; supabase-js attaches the session JWT to invoke().
  async function requireSession(): Promise<void> {
    let hasSession = false;
    try {
      const { data, error } = await client.auth.getSession();
      hasSession = !error && !!data.session?.access_token;
    } catch {
      hasSession = false;
    }
    if (!hasSession) throw new AdminUserError('unauthenticated');
  }

  async function call(
    functionName: string,
    path: string,
    method: InvokeMethod,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    if (functionName === ADMIN_USERS_FUNCTION) await requireSession();
    let result: { data: unknown; error: unknown };
    try {
      result = await client.functions.invoke(`${functionName}/${path}`, body === undefined ? { method } : { method, body });
    } catch {
      throw new AdminUserError('network');
    }
    if (result.error) throw await toAdminUserError(result.error);
    return result.data;
  }

  const admin = (path: string, method: InvokeMethod, body?: Record<string, unknown>) =>
    call(ADMIN_USERS_FUNCTION, path, method, body);
  const links = (path: string, body: Record<string, unknown>) => call(AUTH_LINKS_FUNCTION, path, 'POST', body);
  const id = (value: string) => encodeURIComponent(value);

  return {
    async listUsers() {
      return toUserList(await admin('users', 'GET'));
    },
    async createInvitation(input: InviteUserInput) {
      const body = { email: input.email, fullName: input.fullName, role: input.role, expiresAt: input.expiresAt };
      return toIssuedLink(await admin('invitations', 'POST', body));
    },
    async resendInvitation(invitationId: string, expiresAt: string) {
      return toIssuedLink(await admin(`invitations/${id(invitationId)}/resend`, 'POST', { expiresAt }));
    },
    async revokeInvitation(invitationId: string) {
      await admin(`invitations/${id(invitationId)}`, 'DELETE');
    },
    async changeUserRole(userId: string, newRole) {
      return toAdminUser(await admin(`users/${id(userId)}/role`, 'PATCH', { role: newRole }));
    },
    async disableUser(userId: string) {
      return toAdminUser(await admin(`users/${id(userId)}/disable`, 'POST'));
    },
    async enableUser(userId: string) {
      return toAdminUser(await admin(`users/${id(userId)}/enable`, 'POST'));
    },
    async createPasswordResetLink(userId: string, expiresAt: string) {
      return toIssuedLink(await admin(`users/${id(userId)}/password-links`, 'POST', { expiresAt }));
    },
    async getInvitation(token: string) {
      return toActivationLinkInfo(await links('invitations/lookup', { token }));
    },
    async activateAccount(input: ActivateAccountInput) {
      return toActivationResult(await links('activate', { token: input.token, password: input.password }));
    },
  };
}

// Default instance on the app's Supabase client (wired in src/main.tsx).
export const supabaseAdminUserAdapter: AdminUserAdapter = createSupabaseAdminUserAdapter();
