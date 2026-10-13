// Error format and mapping of database errors (convention of migration 12:
// ERRCODE 'P0001', MESSAGE = code, DETAIL = English text, HINT = suggestion JSON).
import { safeLog } from './log.ts';
import type { AdminSuggestion, RpcError } from './types.ts';

export type ApiErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid_input'
  | 'invalid_status'
  | 'email_in_use'
  | 'invitation_exists'
  | 'last_admin'
  | 'self_action'
  | 'token_invalid'
  | 'token_expired'
  | 'token_used'
  | 'token_revoked'
  | 'rate_limited'
  | 'link_busy'
  | 'unknown';

export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  invalid_status: 409,
  email_in_use: 409,
  invitation_exists: 409,
  last_admin: 409,
  self_action: 409,
  token_invalid: 400,
  token_expired: 410,
  token_used: 410,
  token_revoked: 410,
  rate_limited: 429,
  link_busy: 409,
  unknown: 500,
};

// Same texts as ADMIN_ERROR_MESSAGES in src/services/adminUserService.ts.
export const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  unauthenticated: 'Your session has ended. Please sign in again.',
  forbidden: 'Permission denied. Only active Admins can manage users.',
  not_found: 'The user or invitation was not found.',
  invalid_input: 'Some of the entered values are not valid.',
  invalid_status: 'This action is not allowed for the current status.',
  email_in_use: 'This email already has an account.',
  invitation_exists: 'This email already has an open invitation. Resend it instead.',
  last_admin: 'The last active Admin cannot be disabled or demoted.',
  self_action: 'You cannot disable your own account or change your own role.',
  token_invalid: 'This link is not valid. Ask your Admin for a new link.',
  token_expired: 'This link has expired. Ask your Admin for a new link.',
  token_used: 'This link has already been used. Ask your Admin for a new link if needed.',
  token_revoked: 'This link has been revoked. Ask your Admin for a new link.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  link_busy: 'This link is being used right now. Please try again in a moment.',
  unknown: 'Something went wrong. Please try again.',
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly suggestion: AdminSuggestion | null;
  readonly status: number;
  readonly headers: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    message?: string,
    suggestion: AdminSuggestion | null = null,
    options: { status?: number; headers?: Record<string, string> } = {},
  ) {
    super(message || DEFAULT_MESSAGES[code]);
    this.name = 'ApiError';
    this.code = code;
    this.suggestion = suggestion;
    this.status = options.status ?? ERROR_STATUS[code];
    this.headers = options.headers ?? {};
  }
}

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_STATUS, value);
}

const ID = /^[0-9a-f-]{36}$/i;

// HINT from the database -> contract suggestion. Anything unexpected -> null.
export function parseSuggestion(hint: string | null | undefined): AdminSuggestion | null {
  if (!hint) return null;
  let value: unknown;
  try {
    value = JSON.parse(hint);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if ((record.action === 'create_password_link' || record.action === 'enable_user')
      && typeof record.userId === 'string' && ID.test(record.userId)) {
    return { action: record.action, userId: record.userId };
  }
  if (record.action === 'resend_invitation' && typeof record.invitationId === 'string' && ID.test(record.invitationId)) {
    return { action: 'resend_invitation', invitationId: record.invitationId };
  }
  return null;
}

const JWT_ERROR_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303']);

export function mapRpcError(error: RpcError, rpc: string): ApiError {
  if (error.code === 'P0001' && isApiErrorCode(error.message) && error.message !== 'unknown') {
    const detail = typeof error.details === 'string' && error.details.trim() ? error.details.trim() : undefined;
    return new ApiError(error.message, detail, parseSuggestion(error.hint));
  }
  if ((error.code && JWT_ERROR_CODES.has(error.code)) || error.status === 401) {
    return new ApiError('unauthenticated');
  }
  safeLog('rpc_unexpected_error', { rpc, sqlstate: error.code ?? 'none' });
  return new ApiError('unknown');
}

export function toApiError(error: unknown, step: string): ApiError {
  if (error instanceof ApiError) return error;
  safeLog('unexpected_exception', { step });
  return new ApiError('unknown');
}
