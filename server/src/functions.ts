// Hosts the user-management handlers (supabase/functions/*/handler.ts) on this server.
// The handlers are pure Request -> Response functions; only their dependencies are wired here.
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { authenticateToken, hashPassword, isBearer } from './auth.ts';
import { config } from './config.ts';
import { isDbError, pool, toDbError } from './db.ts';
import { callRpc } from './rest.ts';
import { handleAdminUsers } from '../../supabase/functions/admin-users/handler.ts';
import { handleAuthLinks } from '../../supabase/functions/auth-links/handler.ts';
import type { AdminDeps, AuthLinkDeps, RpcResult, SupabaseKeys } from '../../supabase/functions/_shared/types.ts';

// The shared handlers only need "configured" keys. The secret doubles as the HMAC key for the
// rate-limit counters, so it is derived from JWT_SECRET and never leaves the server.
const keys: SupabaseKeys = {
  publishableKey: 'local',
  secretKey: createHmac('sha256', config.jwtSecret).update('iceberg-rate-limit').digest('hex'),
  source: 'legacy',
};

async function rpc(role: 'authenticated' | 'service_role', claims: { sub?: string; email?: string }, fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  try {
    return { data: await callRpc(role, claims, fn, args), error: null };
  } catch (error) {
    const e = (error as { db?: { code: string | null; message: string; details: string | null; hint: string | null } }).db
      ?? (isDbError(error) ? toDbError(error) : { code: null, message: 'Internal error', details: null, hint: null });
    return { data: null, error: { code: e.code, message: e.message, details: e.details, hint: e.hint, status: 400 } };
  }
}

async function callerClaims(authorization: string): Promise<{ sub: string; email: string } | null> {
  const token = isBearer(authorization);
  const user = token ? await authenticateToken(token) : null;
  return user ? { sub: user.id, email: user.email } : null;
}

const adminDeps: AdminDeps = {
  keys,
  allowedOrigins: config.allowedOrigins,

  async getAuthUser(jwt) {
    const user = await authenticateToken(jwt);
    return user ? { userId: user.id, error: null } : { userId: null, error: { message: 'invalid token', status: 401 } };
  },

  async checkActiveAdmin(authorization) {
    return this.callerRpc(authorization, 'fn_admin_current_caller', {});
  },

  async callerRpc(authorization, fn, args) {
    const claims = await callerClaims(authorization);
    if (!claims) return { data: null, error: { code: 'PGRST301', message: 'JWT expired or invalid', status: 401 } };
    return rpc('authenticated', claims, fn, args);
  },

  async setUserBanned(userId, banned) {
    try {
      await pool.query(
        `UPDATE auth.users SET banned_until = CASE WHEN $2 THEN NOW() + INTERVAL '100 years' ELSE NULL END, updated_at = NOW() WHERE id = $1`,
        [userId, banned],
      );
      return { error: null };
    } catch {
      return { error: { message: 'update failed' } };
    }
  },
};

const linkDeps: AuthLinkDeps = {
  keys,
  allowedOrigins: config.allowedOrigins,

  serviceRpc: (fn, args) => rpc('service_role', {}, fn, args),

  rateLimitHit: (keyHash, limit, windowSeconds) =>
    rpc('service_role', {}, 'fn_rate_limit_hit', { p_key_hash: keyHash, p_limit: limit, p_window_seconds: windowSeconds }),

  async createAuthUser(email, password) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO auth.users (email, encrypted_password, email_confirmed_at) VALUES ($1, $2, NOW()) RETURNING id`,
        [email.trim(), hashPassword(password)],
      );
      return { userId: rows[0].id, error: null };
    } catch (error) {
      if (toDbError(error).code === '23505') return { userId: null, error: { message: 'User already registered', code: 'email_exists', status: 422 } };
      return { userId: null, error: { message: 'create user failed', status: 500 } };
    }
  },

  async updateAuthUser(userId, attributes) {
    try {
      await pool.query(
        `UPDATE auth.users SET encrypted_password = $2,
           email_confirmed_at = CASE WHEN $3 THEN COALESCE(email_confirmed_at, NOW()) ELSE email_confirmed_at END,
           updated_at = NOW() WHERE id = $1`,
        [userId, hashPassword(attributes.password), Boolean(attributes.emailConfirm)],
      );
      return { error: null };
    } catch {
      return { error: { message: 'update failed' } };
    }
  },
};

export const functionRoutes = new Hono();
functionRoutes.all('/admin-users/*', c => handleAdminUsers(c.req.raw, adminDeps));
functionRoutes.all('/admin-users', c => handleAdminUsers(c.req.raw, adminDeps));
functionRoutes.all('/auth-links/*', c => handleAuthLinks(c.req.raw, linkDeps));
functionRoutes.all('/auth-links', c => handleAuthLinks(c.req.raw, linkDeps));

