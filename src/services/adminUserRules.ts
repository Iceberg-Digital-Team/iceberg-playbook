// Pure User Management rules: statuses, allowed actions, admin safety, expiry, validation, links.
// No React, no DOM, no backend SDK, no clock: `now` is always passed in.
// The server is the authority and must enforce the same rules; these are UX mirrors.
import type { Role } from '../auth/auth';
import type {
  AdminSuggestion,
  AdminUser,
  AdminUserErrorCode,
  Invitation,
  InvitationStatus,
  UserListRow,
  UserListStatus,
} from './adminUserService';

export const ROLES: readonly Role[] = ['Admin', 'Support', 'Viewer'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

// ---- Statuses ----

export function getEffectiveInvitationStatus(
  invitation: Pick<Invitation, 'status' | 'expiresAt'>,
  now: Date,
): InvitationStatus {
  if (invitation.status !== 'Pending') return invitation.status;
  const expires = Date.parse(invitation.expiresAt);
  if (Number.isNaN(expires) || expires <= now.getTime()) return 'Expired';
  return 'Pending';
}

export function buildUserListRows(users: AdminUser[], invitations: Invitation[], now: Date): UserListRow[] {
  const rows: UserListRow[] = users.map(user => ({
    kind: 'user',
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    expiresAt: null,
  }));
  for (const invitation of invitations) {
    if (invitation.purpose !== 'invitation') continue;
    const effective = getEffectiveInvitationStatus(invitation, now);
    if (effective !== 'Pending' && effective !== 'Expired') continue;
    rows.push({
      kind: 'invitation',
      id: invitation.id,
      email: invitation.email,
      fullName: invitation.fullName,
      role: invitation.role,
      status: effective === 'Pending' ? 'Pending Invite' : 'Invite Expired',
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    });
  }
  return rows.sort((a, b) => a.fullName.localeCompare(b.fullName) || a.email.localeCompare(b.email));
}

export function tokenErrorForStatus(status: InvitationStatus): AdminUserErrorCode | null {
  switch (status) {
    case 'Pending': return null;
    case 'Expired': return 'token_expired';
    case 'Accepted': return 'token_used';
    case 'Revoked': return 'token_revoked';
  }
}

// ---- Allowed actions and admin safety ----

export type AdminAction =
  | 'resend_invitation'
  | 'revoke_invitation'
  | 'disable_user'
  | 'enable_user'
  | 'change_role'
  | 'create_password_link';

export const ADMIN_ACTIONS: readonly AdminAction[] = [
  'resend_invitation',
  'revoke_invitation',
  'disable_user',
  'enable_user',
  'change_role',
  'create_password_link',
];

export const ALLOWED_ACTIONS: Record<UserListStatus, readonly AdminAction[]> = {
  'Active': ['disable_user', 'change_role', 'create_password_link'],
  'Disabled': ['enable_user'],
  'Pending Invite': ['resend_invitation', 'revoke_invitation'],
  'Invite Expired': ['resend_invitation'],
};

export function isActionAllowed(status: UserListStatus, action: AdminAction): boolean {
  return ALLOWED_ACTIONS[status].includes(action);
}

export interface AdminActionContext {
  currentUserId: string;
  activeAdminCount: number;
}

// Returns the error code that blocks the action, or null when it is allowed.
// For change_role without newRole, checks whether any role change is possible.
export function checkAdminAction(
  row: UserListRow,
  action: AdminAction,
  ctx: AdminActionContext,
  newRole?: Role,
): AdminUserErrorCode | null {
  if (!isActionAllowed(row.status, action)) return 'invalid_status';
  if (row.kind !== 'user') return null;
  const isSelf = row.id === ctx.currentUserId;
  if (isSelf && (action === 'disable_user' || action === 'change_role')) return 'self_action';
  const isLastAdmin = row.role === 'Admin' && row.status === 'Active' && ctx.activeAdminCount <= 1;
  if (isLastAdmin && (action === 'disable_user' || (action === 'change_role' && newRole !== 'Admin'))) {
    return 'last_admin';
  }
  if (action === 'change_role' && newRole !== undefined && newRole === row.role) return 'invalid_input';
  return null;
}

export function getRowActions(
  row: UserListRow,
  ctx: AdminActionContext,
): { action: AdminAction; blockedBy: AdminUserErrorCode | null }[] {
  return ALLOWED_ACTIONS[row.status].map(action => ({ action, blockedBy: checkAdminAction(row, action, ctx) }));
}

// ---- Invite conflicts ----

export function findInviteConflict(
  email: string,
  users: AdminUser[],
  invitations: Invitation[],
  now: Date,
): { code: 'email_in_use' | 'invitation_exists'; suggestion: AdminSuggestion | null } | null {
  const target = normalizeEmail(email);
  const user = users.find(u => normalizeEmail(u.email) === target);
  if (user) {
    return {
      code: 'email_in_use',
      suggestion: user.status === 'Active'
        ? { action: 'create_password_link', userId: user.id }
        : { action: 'enable_user', userId: user.id },
    };
  }
  const open = invitations.find(inv => {
    if (inv.purpose !== 'invitation' || normalizeEmail(inv.email) !== target) return false;
    const status = getEffectiveInvitationStatus(inv, now);
    return status === 'Pending' || status === 'Expired';
  });
  if (open) return { code: 'invitation_exists', suggestion: { action: 'resend_invitation', invitationId: open.id } };
  return null;
}

// ---- Expiry ----

export type ExpiryPreset = '24h' | '3d' | '7d';
export type ExpiryChoice = { preset: ExpiryPreset } | { preset: 'custom'; date: string };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const EXPIRY_PRESET_MS: Record<ExpiryPreset, number> = { '24h': DAY_MS, '3d': 3 * DAY_MS, '7d': 7 * DAY_MS };
export const DEFAULT_EXPIRY_PRESET: ExpiryPreset = '24h';
export const MAX_EXPIRY_MS = 7 * DAY_MS;
export const EXPIRY_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

function formatLocalDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Presets add exact time to now. A custom date means the end of that local day,
// capped at now + MAX_EXPIRY_MS. Returns null for a malformed or past date.
export function resolveExpiry(choice: ExpiryChoice, now: Date): string | null {
  if (choice.preset !== 'custom') return new Date(now.getTime() + EXPIRY_PRESET_MS[choice.preset]).toISOString();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(choice.date.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (end.getFullYear() !== year || end.getMonth() !== month - 1 || end.getDate() !== day) return null;
  if (end.getTime() <= now.getTime()) return null;
  return new Date(Math.min(end.getTime(), now.getTime() + MAX_EXPIRY_MS)).toISOString();
}

export function customDateBounds(now: Date): { min: string; max: string } {
  return { min: formatLocalDate(now), max: formatLocalDate(new Date(now.getTime() + MAX_EXPIRY_MS)) };
}

export function validateExpiresAt(expiresAt: string, now: Date): string {
  const time = typeof expiresAt === 'string' ? Date.parse(expiresAt) : Number.NaN;
  if (Number.isNaN(time)) return 'Choose a valid expiry date.';
  if (time <= now.getTime()) return 'The expiry must be in the future.';
  if (time > now.getTime() + MAX_EXPIRY_MS + EXPIRY_CLOCK_TOLERANCE_MS) return 'A link can be valid for at most 7 days.';
  return '';
}

// ---- Invite input ----

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MAX_LENGTH = 254;
export const FULL_NAME_MAX_LENGTH = 100;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateInviteInput(input: { email: string; fullName: string; role: string }): {
  errors: { email: string; fullName: string; role: string };
  value: { email: string; fullName: string; role: Role } | null;
} {
  const email = normalizeEmail(typeof input.email === 'string' ? input.email : '');
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
  const errors = {
    email: !email ? 'Enter an email address.'
      : email.length > EMAIL_MAX_LENGTH ? `Email must be at most ${EMAIL_MAX_LENGTH} characters.`
      : !EMAIL_PATTERN.test(email) ? 'Enter a valid email address.' : '',
    fullName: !fullName ? 'Enter a name.'
      : fullName.length > FULL_NAME_MAX_LENGTH ? `Name must be at most ${FULL_NAME_MAX_LENGTH} characters.` : '',
    role: isRole(input.role) ? '' : 'Choose a valid role.',
  };
  const valid = !errors.email && !errors.fullName && !errors.role;
  return { errors, value: valid ? { email, fullName, role: input.role as Role } : null };
}

// ---- Password ----

export const PASSWORD_MIN_LENGTH = 8;
// bcrypt only uses the first 72 bytes.
export const PASSWORD_MAX_BYTES = 72;

export function validatePassword(password: string): string {
  if (typeof password !== 'string' || !password) return 'Enter a password.';
  if (!password.trim()) return 'Password cannot be only spaces.';
  if ([...password].length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `Password is too long. Use at most ${PASSWORD_MAX_BYTES} characters (fewer with special characters).`;
  }
  return '';
}

export function validatePasswordForm(password: string, confirm: string): { password: string; confirm: string } {
  return {
    password: validatePassword(password),
    confirm: !confirm ? 'Confirm your password.' : confirm !== password ? 'Passwords do not match.' : '',
  };
}

// ---- Activation link ----

// <base>#/activate?token=<encoded>. The URL carries the token and nothing else.
export function buildActivationUrl(baseUrl: string, token: string): string {
  const base = (typeof baseUrl === 'string' ? baseUrl : '').split('#')[0].trim();
  const value = typeof token === 'string' ? token.trim() : '';
  if (!base) throw new Error('Activation base URL is required.');
  if (!value) throw new Error('Activation token is required.');
  return `${base}#/activate?token=${encodeURIComponent(value)}`;
}

export function readActivationToken(params: Record<string, string | undefined>): string | null {
  const raw = params.token;
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value || null;
}
