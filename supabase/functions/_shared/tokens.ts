// Link tokens: 32 random bytes, base64url in the link, only the SHA-256 hex goes to the database.
// Uses Web Crypto only (works in Deno and in Node tests).

const TOKEN_BYTES = 32;
// base64url of 32 bytes without padding is always 43 characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Incoming token from a request body: trimmed; wrong format -> null (token_invalid, no database call).
export function normalizeIncomingToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  return TOKEN_PATTERN.test(token) ? token : null;
}
