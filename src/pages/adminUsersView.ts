// View model for the Admin Users page. Pure (no React, no DOM, no backend).
import type { Role } from '../auth/auth';
import { formatGuideDate } from '../data';
import {
  customDateBounds,
  DEFAULT_EXPIRY_PRESET,
  getRowActions,
  resolveExpiry,
  validateExpiresAt,
  validateInviteInput,
} from '../services/adminUserRules';
import type { AdminAction, AdminActionContext, ExpiryPreset } from '../services/adminUserRules';
import { isAdminUserError } from '../services/adminUserService';
import type {
  AdminSuggestion,
  AdminUserErrorCode,
  CreatedLink,
  InviteUserInput,
  UserListRow,
  UserListStatus,
} from '../services/adminUserService';

export type BadgeKind = 'active' | 'disabled' | 'pending' | 'expired';

export const STATUS_BADGES: Record<UserListStatus, { label: string; kind: BadgeKind }> = {
  'Active': { label: 'Active', kind: 'active' },
  'Disabled': { label: 'Disabled', kind: 'disabled' },
  'Pending Invite': { label: 'Pending Invite', kind: 'pending' },
  'Invite Expired': { label: 'Invite Expired', kind: 'expired' },
};

export const ACTION_LABELS: Record<AdminAction, string> = {
  change_role: 'Change role',
  disable_user: 'Disable',
  enable_user: 'Enable',
  resend_invitation: 'Resend invitation',
  revoke_invitation: 'Revoke invitation',
  create_password_link: 'Create password link',
};

// Fixed English format (same as Guide dates), not the browser locale.
export function formatDateTime(iso: string): string {
  return formatGuideDate(iso);
}

export function countActiveAdmins(rows: UserListRow[]): number {
  return rows.filter(row => row.kind === 'user' && row.role === 'Admin' && row.status === 'Active').length;
}

export function blockedReason(action: AdminAction, code: AdminUserErrorCode): string {
  if (code === 'self_action') {
    return action === 'disable_user' ? 'You cannot disable your own account.' : 'You cannot change your own role.';
  }
  if (code === 'last_admin') return 'This is the last active Admin.';
  if (code === 'invalid_status') return 'Not available for this status.';
  return 'Not available.';
}

export interface RowActionView {
  action: AdminAction;
  label: string;
  disabledReason: string | null;
}

export interface RowView {
  key: string;
  id: string;
  kind: UserListRow['kind'];
  name: string;
  email: string;
  role: Role;
  status: { label: string; kind: BadgeKind };
  expiresText: string;
  actions: RowActionView[];
}

export function buildRowView(row: UserListRow, ctx: AdminActionContext): RowView {
  return {
    key: `${row.kind}-${row.id}`,
    id: row.id,
    kind: row.kind,
    name: row.fullName,
    email: row.email,
    role: row.role,
    status: STATUS_BADGES[row.status],
    expiresText: row.kind === 'invitation' && row.expiresAt ? formatDateTime(row.expiresAt) : '—',
    actions: getRowActions(row, ctx).map(({ action, blockedBy }) => ({
      action,
      label: ACTION_LABELS[action],
      disabledReason: blockedBy ? blockedReason(action, blockedBy) : null,
    })),
  };
}

export interface Confirmation {
  title: string;
  body: string;
  confirmLabel: string;
}

// Disable and Revoke always ask; a role change asks (with a warning) when Admin is involved.
export function confirmationFor(action: AdminAction, row: Pick<UserListRow, 'fullName' | 'email' | 'role'>, newRole?: Role): Confirmation | null {
  const who = row.fullName || row.email;
  if (action === 'disable_user') {
    return {
      title: `Disable ${who}?`,
      body: 'They can no longer sign in. Their history stays. Open password links are revoked.',
      confirmLabel: 'Disable user',
    };
  }
  if (action === 'revoke_invitation') {
    return {
      title: `Revoke the invitation for ${row.email}?`,
      body: 'The link stops working. You can invite this email again later.',
      confirmLabel: 'Revoke invitation',
    };
  }
  if (action === 'change_role' && newRole && newRole !== row.role && (newRole === 'Admin' || row.role === 'Admin')) {
    return {
      title: `Change the role of ${who}?`,
      body: newRole === 'Admin' ? 'This gives full admin rights.' : 'This removes full admin rights.',
      confirmLabel: 'Change role',
    };
  }
  return null;
}

// ---- Errors and suggestions ----

export interface SuggestionView {
  label: string;
  action: AdminSuggestion['action'];
  targetId: string;
}

const SUGGESTION_LABELS: Record<AdminSuggestion['action'], string> = {
  create_password_link: 'Create password link instead',
  enable_user: 'Enable user',
  resend_invitation: 'Resend invitation',
};

export function presentError(error: unknown): { message: string; suggestion: SuggestionView | null } {
  if (isAdminUserError(error)) {
    const suggestion = error.suggestion;
    return {
      message: error.message,
      suggestion: suggestion
        ? {
            label: SUGGESTION_LABELS[suggestion.action],
            action: suggestion.action,
            targetId: suggestion.action === 'resend_invitation' ? suggestion.invitationId : suggestion.userId,
          }
        : null,
    };
  }
  if (error instanceof Error && error.message) return { message: error.message, suggestion: null };
  return { message: 'Something went wrong. Please try again.', suggestion: null };
}

// ---- Expiry and invite form ----

export type ExpiryChoiceValue = ExpiryPreset | 'custom';

export interface ExpiryFormValue {
  preset: ExpiryChoiceValue;
  customDate: string;
}

export const EXPIRY_OPTIONS: { value: ExpiryChoiceValue; label: string }[] = [
  { value: '24h', label: '24 hours' },
  { value: '3d', label: '3 days' },
  { value: '7d', label: '7 days' },
  { value: 'custom', label: 'Pick a date' },
];

export const DEFAULT_EXPIRY_FORM: ExpiryFormValue = { preset: DEFAULT_EXPIRY_PRESET, customDate: '' };

export function expiryDateBounds(now: Date): { min: string; max: string } {
  return customDateBounds(now);
}

export function expiryFromForm(value: ExpiryFormValue, now: Date): { expiresAt: string | null; error: string } {
  if (value.preset === 'custom' && !value.customDate.trim()) return { expiresAt: null, error: 'Choose a date.' };
  const expiresAt = resolveExpiry(
    value.preset === 'custom' ? { preset: 'custom', date: value.customDate } : { preset: value.preset },
    now,
  );
  if (!expiresAt) return { expiresAt: null, error: 'Choose a date from today up to 7 days ahead.' };
  const error = validateExpiresAt(expiresAt, now);
  return error ? { expiresAt: null, error } : { expiresAt, error: '' };
}

export interface InviteFormFields {
  email: string;
  fullName: string;
  role: string;
  expiry: ExpiryFormValue;
}

export function validateInviteForm(fields: InviteFormFields, now: Date): {
  errors: { email: string; fullName: string; role: string; expiry: string };
  input: InviteUserInput | null;
} {
  const { errors, value } = validateInviteInput({ email: fields.email, fullName: fields.fullName, role: fields.role });
  const expiry = expiryFromForm(fields.expiry, now);
  const allErrors = { ...errors, expiry: expiry.error };
  if (!value || !expiry.expiresAt) return { errors: allErrors, input: null };
  return { errors: allErrors, input: { ...value, expiresAt: expiry.expiresAt } };
}

// ---- Link result ----

export const LINK_NOTICE = 'This link is shown only once. Send it to the user yourself.';

export function linkResultView(link: CreatedLink): {
  mode: 'manual' | 'email';
  title: string;
  url: string | null;
  expiresText: string;
  notice: string;
} {
  const title = link.purpose === 'password_reset' ? 'Password link' : 'Invitation link';
  const expiresText = `Valid until ${formatDateTime(link.expiresAt)}.`;
  if (link.delivery === 'email' || !link.activationUrl) {
    return { mode: 'email', title, url: null, expiresText, notice: `Sent by email to ${link.email}.` };
  }
  return { mode: 'manual', title, url: link.activationUrl, expiresText, notice: LINK_NOTICE };
}
