// Server-side input rules.
// validatePassword MIRRORS src/services/adminUserRules.ts (same rules, same messages).
// tests/edge_shared.test.mjs fails if the two drift apart.
import type { Role } from './types.ts';

export const ROLES: readonly Role[] = ['Admin', 'Support', 'Viewer'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value));
}

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
