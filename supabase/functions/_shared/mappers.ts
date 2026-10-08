// The only place where database jsonb (snake_case) becomes contract types (camelCase).
// Output objects contain exactly the contract keys; nothing else (never token_hash, never user_id
// of a reset link in browser responses).
import { ApiError } from './errors.ts';
import type {
  ActivationLinkInfo,
  ActivationResult,
  AdminUser,
  Invitation,
  InvitationStatus,
  IssuedLink,
  LinkPurpose,
  Role,
  UserStatus,
} from './types.ts';

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('unknown');
  }
  return value as Row;
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new ApiError('unknown');
  return value;
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

export function toAdminUser(value: unknown): AdminUser {
  const row = asRow(value);
  return {
    id: text(row, 'id'),
    email: text(row, 'email'),
    fullName: text(row, 'full_name'),
    role: text(row, 'role') as Role,
    status: text(row, 'status') as UserStatus,
    createdAt: text(row, 'created_at'),
  };
}

export function toInvitation(value: unknown): Invitation {
  const row = asRow(value);
  return {
    id: text(row, 'id'),
    purpose: text(row, 'purpose') as LinkPurpose,
    email: text(row, 'email'),
    fullName: text(row, 'full_name'),
    role: text(row, 'role') as Role,
    userId: nullableText(row, 'user_id'),
    status: text(row, 'status') as InvitationStatus,
    expiresAt: text(row, 'expires_at'),
    acceptedAt: nullableText(row, 'accepted_at'),
    revokedAt: nullableText(row, 'revoked_at'),
    invitedBy: nullableText(row, 'invited_by'),
    createdAt: text(row, 'created_at'),
  };
}

export function toUserList(value: unknown): { users: AdminUser[]; invitations: Invitation[] } {
  const row = asRow(value);
  const users = Array.isArray(row.users) ? row.users : [];
  const invitations = Array.isArray(row.invitations) ? row.invitations : [];
  return { users: users.map(toAdminUser), invitations: invitations.map(toInvitation) };
}

// The raw token appears only here, in the creation response.
export function toIssuedLink(value: unknown, token: string): IssuedLink {
  const row = asRow(value);
  return {
    invitationId: text(row, 'invitation_id'),
    purpose: text(row, 'purpose') as LinkPurpose,
    email: text(row, 'email'),
    expiresAt: text(row, 'expires_at'),
    delivery: 'manual',
    token,
  };
}

export function toActivationLinkInfo(value: unknown): ActivationLinkInfo {
  const row = asRow(value);
  return {
    purpose: text(row, 'purpose') as LinkPurpose,
    status: 'Pending',
    email: text(row, 'email'),
    fullName: text(row, 'full_name'),
    role: text(row, 'role') as Role,
    expiresAt: text(row, 'expires_at'),
  };
}

export function toActivationResult(value: unknown): ActivationResult {
  const row = asRow(value);
  return { purpose: text(row, 'purpose') as LinkPurpose, email: text(row, 'email') };
}
