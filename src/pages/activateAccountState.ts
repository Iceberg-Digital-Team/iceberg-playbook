// State machine of the #/activate page. Pure (no React, no DOM, no backend).
import type { Role } from '../auth/auth';
import { isAdminUserError } from '../services/adminUserService';
import type { ActivationLinkInfo, ActivationResult, LinkPurpose } from '../services/adminUserService';

export const DEAD_LINK_HELP = 'Ask your Admin for a new link.';
const TOKEN_CODES = ['token_invalid', 'token_expired', 'token_used', 'token_revoked'];

export interface ActivationFormView {
  kind: 'form';
  purpose: LinkPurpose;
  heading: string;
  intro: string;
  email: string;
  fullName: string;
  role: Role;
  error: string;
}

export type ActivationView =
  | { kind: 'invalid'; message: string; help: string }
  | { kind: 'loading' }
  | ActivationFormView
  | { kind: 'dead'; message: string; help: string }
  | { kind: 'error'; message: string }
  | { kind: 'done'; message: string; email: string };

const INVALID_MESSAGE = 'This link is not valid.';

// Missing token -> invalid without any network call.
export function initialView(token: string | null): ActivationView {
  return token ? { kind: 'loading' } : { kind: 'invalid', message: INVALID_MESSAGE, help: DEAD_LINK_HELP };
}

export function viewFromInfo(info: ActivationLinkInfo): ActivationFormView {
  const reset = info.purpose === 'password_reset';
  return {
    kind: 'form',
    purpose: info.purpose,
    heading: reset ? 'Reset your password' : 'Activate your account',
    intro: reset ? 'Choose a new password.' : 'Set your password to activate your account.',
    email: info.email,
    fullName: info.fullName,
    role: info.role,
    error: '',
  };
}

function isDeadLinkError(error: unknown): boolean {
  return isAdminUserError(error) && TOKEN_CODES.includes(error.code);
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

export function viewFromLookupError(error: unknown): ActivationView {
  if (isDeadLinkError(error)) return { kind: 'dead', message: messageOf(error), help: DEAD_LINK_HELP };
  return { kind: 'error', message: messageOf(error) };
}

export function viewFromSubmitError(form: ActivationFormView, error: unknown): ActivationView {
  if (isDeadLinkError(error)) return { kind: 'dead', message: messageOf(error), help: DEAD_LINK_HELP };
  return { ...form, error: messageOf(error) };
}

export function viewFromResult(result: ActivationResult): ActivationView {
  return { kind: 'done', message: 'Your password is set. Sign in with your email and new password.', email: result.email };
}
