// Email + password authentication backed by auth.users (bcrypt), stateless JWT sessions.
import bcrypt from 'bcryptjs';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { pool } from './db.ts';
import { signAccessToken, signRefreshToken, verifyToken } from './tokens.ts';
import { config } from './config.ts';

export interface AuthUser {
  id: string;
  email: string;
}

// Used to keep response time similar when the email is unknown.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

async function findUserById(id: string): Promise<(AuthUser & { banned: boolean }) | null> {
  const { rows } = await pool.query(
    `SELECT id, email, (banned_until IS NOT NULL AND banned_until > NOW()) AS banned
     FROM auth.users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// Bearer token -> active user. Disabled (banned) and deleted users are rejected immediately,
// even while their access token has not expired yet.
export async function authenticate(c: Context): Promise<AuthUser | null> {
  const header = c.req.header('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  const payload = await verifyToken(match[1], 'access');
  if (!payload?.sub) return null;
  const user = await findUserById(payload.sub);
  if (!user || user.banned) return null;
  return { id: user.id, email: user.email };
}

export function isBearer(authorization: string): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

export async function authenticateToken(token: string): Promise<AuthUser | null> {
  const payload = await verifyToken(token, 'access');
  if (!payload?.sub) return null;
  const user = await findUserById(payload.sub);
  if (!user || user.banned) return null;
  return { id: user.id, email: user.email };
}

// ---- brute-force protection (per instance; a small, simple limiter) ----
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function throttled(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < Date.now()) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
  }
}

async function session(user: AuthUser) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: await signAccessToken(user.id, user.email),
    refresh_token: await signRefreshToken(user.id, user.email),
    token_type: 'bearer',
    expires_in: config.accessTokenTtlSeconds,
    expires_at: now + config.accessTokenTtlSeconds,
    user: { id: user.id, email: user.email },
  };
}

function oauthError(c: Context, status: 400 | 401 | 429, error: string, description: string) {
  return c.json({ error, error_description: description }, status);
}

export const authRoutes = new Hono();

authRoutes.post('/token', async c => {
  const grant = c.req.query('grant_type');
  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return oauthError(c, 400, 'invalid_request', 'Request body must be JSON.');
  }

  if (grant === 'refresh_token') {
    const token = typeof body.refresh_token === 'string' ? body.refresh_token : '';
    const payload = await verifyToken(token, 'refresh');
    const user = payload?.sub ? await findUserById(payload.sub) : null;
    if (!user || user.banned) return oauthError(c, 401, 'invalid_grant', 'Invalid refresh token.');
    return c.json(await session(user));
  }

  if (grant !== 'password') return oauthError(c, 400, 'unsupported_grant_type', 'Unsupported grant type.');

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return oauthError(c, 400, 'invalid_grant', 'Invalid login credentials');

  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip')
    ?? (c.req.header('x-forwarded-for') ?? '').split(',').pop()?.trim() ?? 'unknown';
  const throttleKey = `${ip}|${email}`;
  if (throttled(throttleKey)) {
    return oauthError(c, 429, 'over_request_rate_limit', 'Too many sign-in attempts. Try again later.');
  }

  const { rows } = await pool.query(
    `SELECT id, email, encrypted_password, email_confirmed_at,
            (banned_until IS NOT NULL AND banned_until > NOW()) AS banned
     FROM auth.users WHERE lower(btrim(email)) = $1`,
    [email],
  );
  const row = rows[0];
  const valid = await bcrypt.compare(password, row?.encrypted_password ?? DUMMY_HASH);
  if (!row || !valid || !row.email_confirmed_at) {
    recordFailure(throttleKey);
    return oauthError(c, 400, 'invalid_grant', 'Invalid login credentials');
  }
  if (row.banned) return oauthError(c, 400, 'user_banned', 'This account is disabled.');

  attempts.delete(throttleKey);
  await pool.query('UPDATE auth.users SET last_sign_in_at = NOW() WHERE id = $1', [row.id]);
  return c.json(await session({ id: row.id, email: row.email }));
});

// Sessions are stateless: sign-out is completed by the client dropping its tokens.
authRoutes.post('/logout', c => c.body(null, 204));

authRoutes.get('/user', async c => {
  const user = await authenticate(c);
  if (!user) return oauthError(c, 401, 'unauthorized', 'Invalid or expired token.');
  return c.json({ id: user.id, email: user.email });
});
