// Rate limiting for the public link endpoints (docs/USER_MANAGEMENT_API.md §9, §10).
// Edge Function instances share no memory, so the counters live in the database
// (fn_rate_limit_hit, migration 12). Keys are HMAC-SHA-256(secret key, "<kind>:<value>"):
// no raw IP address and no token hash is ever stored or logged.
// Uses Web Crypto only (works in Deno and in Node tests).
import { ApiError } from './errors.ts';
import { safeLog } from './log.ts';
import type { RpcResult } from './types.ts';

export type RateLimitKind = 'lookup-ip' | 'activate-ip' | 'token';

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

// lookup: at most 20 per IP per 10 minutes; activate: at most 10 per IP per 10 minutes;
// per token: at most 10 per hour (lookup and activate counted together).
export const RATE_LIMITS: Record<RateLimitKind, RateLimitRule> = {
  'lookup-ip': { limit: 20, windowSeconds: 600 },
  'activate-ip': { limit: 10, windowSeconds: 600 },
  token: { limit: 10, windowSeconds: 3600 },
};

export const UNKNOWN_CLIENT_IP = 'unknown';

// Client IP as set by the platform, never a value the caller chose:
// 1. cf-connecting-ip: Supabase's edge is Cloudflare, which sets it to the real client IP and
//    rejects a request that sends its own value.
// 2. Fallback: the RIGHT-most X-Forwarded-For entry. Proxies append the address they saw, so
//    the last entry comes from the platform proxy; the left-most one can be forged by the client.
// 3. Neither header: one shared "unknown" bucket (fails closed instead of skipping the limit).
export function clientIp(request: Request): string {
  const cloudflare = request.headers.get('cf-connecting-ip')?.trim();
  if (cloudflare) return cloudflare;
  const forwarded = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  if (forwarded.length > 0) return forwarded[forwarded.length - 1];
  return UNKNOWN_CLIENT_IP;
}

// Lower-case hex HMAC-SHA-256 (64 chars), the only form that reaches the database.
export async function rateLimitKey(secret: string, kind: RateLimitKind, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${kind}:${value}`));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

export type RateLimitHit = (keyHash: string, limit: number, windowSeconds: number) => Promise<RpcResult>;

// Counts one request. Over the limit -> 429 rate_limited with Retry-After; any failure of the
// counter -> 500 unknown (fail closed). Never logs the key or the value.
export async function enforceRateLimit(hit: RateLimitHit, secret: string, kind: RateLimitKind, value: string): Promise<void> {
  const rule = RATE_LIMITS[kind];
  const keyHash = await rateLimitKey(secret, kind, value);
  let result: RpcResult;
  try {
    result = await hit(keyHash, rule.limit, rule.windowSeconds);
  } catch {
    result = { data: null, error: { message: 'rate limit call failed' } };
  }
  const row = (Array.isArray(result.data) ? result.data[0] : result.data) as Record<string, unknown> | null | undefined;
  if (result.error || !row || typeof row !== 'object' || typeof row.allowed !== 'boolean') {
    safeLog('rate_limit_failed', { step: kind });
    throw new ApiError('unknown');
  }
  if (!row.allowed) {
    const retry = row.retry_after_seconds;
    const retryAfter = typeof retry === 'number' && Number.isInteger(retry) && retry > 0 ? retry : rule.windowSeconds;
    safeLog('rate_limited', { step: kind });
    throw new ApiError('rate_limited', undefined, null, { headers: { 'Retry-After': String(retryAfter) } });
  }
}
