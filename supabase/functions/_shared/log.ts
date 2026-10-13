// Safe logging: only whitelisted keys with short plain values.
// Never log tokens, token hashes, passwords, emails, keys or request bodies.

const ALLOWED_KEYS = ['route', 'rpc', 'sqlstate', 'code', 'step'] as const;
type LogKey = (typeof ALLOWED_KEYS)[number];
const SAFE_VALUE = /^[A-Za-z0-9_.:/-]{1,64}$/;

export function safeLog(event: string, fields: Partial<Record<LogKey, string | null | undefined>> = {}): void {
  const parts = [`[user-management] ${SAFE_VALUE.test(event) ? event : 'event'}`];
  for (const key of ALLOWED_KEYS) {
    const value = fields[key];
    if (typeof value === 'string' && SAFE_VALUE.test(value)) parts.push(`${key}=${value}`);
  }
  console.warn(parts.join(' '));
}
