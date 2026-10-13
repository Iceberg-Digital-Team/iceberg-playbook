// Admin User Management: portable domain types, service contract and operations.
// No backend SDK here. A backend-specific AdminUserAdapter is configured at startup
// (Supabase reference adapter in task D, Iceberg adapter later). See docs/USER_MANAGEMENT_API.md.
import type { Role } from '../auth/auth';
import {
  buildActivationUrl,
  buildUserListRows,
  isRole,
  validateExpiresAt,
  validateInviteInput,
  validatePassword,
} from './adminUserRules';

export type UserStatus = 'Active' | 'Disabled';
export type InvitationStatus = 'Pending' | 'Accepted' | 'Expired' | 'Revoked';
export type UserListStatus = 'Active' | 'Disabled' | 'Pending Invite' | 'Invite Expired';
export type LinkPurpose = 'invitation' | 'password_reset';
// 'manual': the admin copies the link from the screen. 'email': the backend sent it (future).
export type LinkDelivery = 'manual' | 'email';

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

export interface Invitation {
  id: string;
  purpose: LinkPurpose;
  email: string;
  fullName: string;
  role: Role;
  // Target user of a password_reset link; null for an invitation.
  userId: string | null;
  // Stored status. Use getEffectiveInvitationStatus() for display and rules.
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  invitedBy: string | null;
  createdAt: string;
}

export interface UserListRow {
  kind: 'user' | 'invitation';
  // User id for kind 'user', invitation id for kind 'invitation'.
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: UserListStatus;
  createdAt: string;
  // Invitations only.
  expiresAt: string | null;
}

export interface InviteUserInput {
  email: string;
  fullName: string;
  role: Role;
  expiresAt: string;
}

// Returned only when a link is created. The link can never be read again later.
export interface CreatedLink {
  invitationId: string;
  purpose: LinkPurpose;
  email: string;
  expiresAt: string;
  delivery: LinkDelivery;
  // Set when delivery is 'manual'; null when the backend delivered the link itself.
  activationUrl: string | null;
}

// Only what the activation page needs. No ids of other records.
export interface ActivationLinkInfo {
  purpose: LinkPurpose;
  status: 'Pending';
  email: string;
  fullName: string;
  role: Role;
  expiresAt: string;
}

export interface ActivateAccountInput {
  token: string;
  password: string;
}

export interface ActivationResult {
  purpose: LinkPurpose;
  email: string;
}

export type AdminUserErrorCode =
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
  | 'not_configured'
  | 'network'
  | 'unknown';

export type AdminSuggestion =
  | { action: 'create_password_link'; userId: string }
  | { action: 'enable_user'; userId: string }
  | { action: 'resend_invitation'; invitationId: string };

export const ADMIN_ERROR_MESSAGES: Record<AdminUserErrorCode, string> = {
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
  not_configured: 'User management is not configured.',
  network: 'Could not reach the server. Check your connection and try again.',
  unknown: 'Something went wrong. Please try again.',
};

export class AdminUserError extends Error {
  readonly code: AdminUserErrorCode;
  readonly suggestion: AdminSuggestion | null;

  constructor(code: AdminUserErrorCode, message?: string, suggestion: AdminSuggestion | null = null) {
    super(message || ADMIN_ERROR_MESSAGES[code]);
    this.name = 'AdminUserError';
    this.code = code;
    this.suggestion = suggestion;
  }
}

export function isAdminUserError(error: unknown): error is AdminUserError {
  return error instanceof AdminUserError;
}

// Raw result of a link-creating backend call. Only the adapter and this service see the token.
export interface IssuedLink {
  invitationId: string;
  purpose: LinkPurpose;
  email: string;
  expiresAt: string;
  delivery: LinkDelivery;
  token: string | null;
}

// Backend boundary. Implementations map backend errors to AdminUserError codes.
export interface AdminUserAdapter {
  listUsers(): Promise<{ users: AdminUser[]; invitations: Invitation[] }>;
  createInvitation(input: InviteUserInput): Promise<IssuedLink>;
  resendInvitation(invitationId: string, expiresAt: string): Promise<IssuedLink>;
  revokeInvitation(invitationId: string): Promise<void>;
  changeUserRole(userId: string, role: Role): Promise<AdminUser>;
  disableUser(userId: string): Promise<AdminUser>;
  enableUser(userId: string): Promise<AdminUser>;
  createPasswordResetLink(userId: string, expiresAt: string): Promise<IssuedLink>;
  getInvitation(token: string): Promise<ActivationLinkInfo>;
  activateAccount(input: ActivateAccountInput): Promise<ActivationResult>;
}

export interface AdminUserServiceOptions {
  // App URL the activation link is built on, e.g. https://playbook.example.com/
  activationBaseUrl: string;
  now?: () => Date;
}

let activeAdapter: AdminUserAdapter | null = null;
let activeOptions: AdminUserServiceOptions | null = null;

export function configureAdminUserService(adapter: AdminUserAdapter | null, options?: AdminUserServiceOptions): void {
  activeAdapter = adapter;
  activeOptions = adapter ? options ?? null : null;
}

function requireAdapter(): AdminUserAdapter {
  if (!activeAdapter) throw new AdminUserError('not_configured');
  return activeAdapter;
}

function currentTime(): Date {
  return activeOptions?.now ? activeOptions.now() : new Date();
}

function requireId(id: string, label: string): string {
  const value = typeof id === 'string' ? id.trim() : '';
  if (!value) throw new AdminUserError('invalid_input', `${label} is required.`);
  return value;
}

function requireExpiry(expiresAt: string): string {
  const message = validateExpiresAt(expiresAt, currentTime());
  if (message) throw new AdminUserError('invalid_input', message);
  return expiresAt;
}

function toCreatedLink(issued: IssuedLink): CreatedLink {
  let activationUrl: string | null = null;
  if (issued.delivery === 'manual') {
    const token = typeof issued.token === 'string' ? issued.token.trim() : '';
    if (!token) throw new AdminUserError('unknown', 'The server did not return a link to show.');
    const baseUrl = activeOptions?.activationBaseUrl;
    if (!baseUrl) throw new AdminUserError('not_configured', 'The activation link base URL is not configured.');
    activationUrl = buildActivationUrl(baseUrl, token);
  }
  return {
    invitationId: issued.invitationId,
    purpose: issued.purpose,
    email: issued.email,
    expiresAt: issued.expiresAt,
    delivery: issued.delivery,
    activationUrl,
  };
}

export async function listUsers(): Promise<UserListRow[]> {
  const adapter = requireAdapter();
  const { users, invitations } = await adapter.listUsers();
  return buildUserListRows(users, invitations, currentTime());
}

export async function inviteUser(input: InviteUserInput): Promise<CreatedLink> {
  const adapter = requireAdapter();
  const { errors, value } = validateInviteInput(input);
  if (!value) throw new AdminUserError('invalid_input', errors.email || errors.fullName || errors.role);
  const expiresAt = requireExpiry(input.expiresAt);
  return toCreatedLink(await adapter.createInvitation({ ...value, expiresAt }));
}

export async function changeUserRole(userId: string, role: Role): Promise<AdminUser> {
  const adapter = requireAdapter();
  const id = requireId(userId, 'User ID');
  if (!isRole(role)) throw new AdminUserError('invalid_input', 'Choose a valid role.');
  return adapter.changeUserRole(id, role);
}

export async function disableUser(userId: string): Promise<AdminUser> {
  const adapter = requireAdapter();
  return adapter.disableUser(requireId(userId, 'User ID'));
}

export async function enableUser(userId: string): Promise<AdminUser> {
  const adapter = requireAdapter();
  return adapter.enableUser(requireId(userId, 'User ID'));
}

export async function resendInvitation(invitationId: string, expiresAt: string): Promise<CreatedLink> {
  const adapter = requireAdapter();
  const id = requireId(invitationId, 'Invitation ID');
  return toCreatedLink(await adapter.resendInvitation(id, requireExpiry(expiresAt)));
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  const adapter = requireAdapter();
  await adapter.revokeInvitation(requireId(invitationId, 'Invitation ID'));
}

export async function createPasswordResetLink(userId: string, expiresAt: string): Promise<CreatedLink> {
  const adapter = requireAdapter();
  const id = requireId(userId, 'User ID');
  return toCreatedLink(await adapter.createPasswordResetLink(id, requireExpiry(expiresAt)));
}

export async function getInvitation(token: string): Promise<ActivationLinkInfo> {
  const adapter = requireAdapter();
  const value = typeof token === 'string' ? token.trim() : '';
  if (!value) throw new AdminUserError('token_invalid');
  const info = await adapter.getInvitation(value);
  return {
    purpose: info.purpose,
    status: info.status,
    email: info.email,
    fullName: info.fullName,
    role: info.role,
    expiresAt: info.expiresAt,
  };
}

export async function activateAccount(input: ActivateAccountInput): Promise<ActivationResult> {
  const adapter = requireAdapter();
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (!token) throw new AdminUserError('token_invalid');
  const passwordError = validatePassword(input.password);
  if (passwordError) throw new AdminUserError('invalid_input', passwordError);
  const result = await adapter.activateAccount({ token, password: input.password });
  return { purpose: result.purpose, email: result.email };
}
