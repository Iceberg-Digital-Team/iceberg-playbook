// Deno entry for the auth-links Edge Function. Only this file uses Deno and npm: imports.
// All logic is in handler.ts (tested in Node with fakes).
// Deploy with --no-verify-jwt (public endpoint, authorized by the link token; the handler does
// its own token checks and rate limiting): see docs/USER_MANAGEMENT_API.md §14.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { parseAllowedOriginsEnv, resolveSupabaseKeys } from '../_shared/env.ts';
import type { AuthLinkDeps, RpcResult, SupabaseKeys } from '../_shared/types.ts';
import { AUTH_CALL_TIMEOUT_MS, handleAuthLinks } from './handler.ts';

const env = Deno.env.toObject();
const supabaseUrl = env.SUPABASE_URL ?? '';
const resolvedKeys = resolveSupabaseKeys(env);
// Without a project URL nothing can work: treat it like missing keys (500, no partial work).
const keys: SupabaseKeys = supabaseUrl ? resolvedKeys : { publishableKey: null, secretKey: null, source: 'none' };
// Every request of the secret client is really aborted after AUTH_CALL_TIMEOUT_MS (the handler
// also stops waiting then), so no Auth call can outlive the 60 second link lease.
const timedFetch: typeof fetch = (input, init = {}) => {
  const timeout = AbortSignal.timeout(AUTH_CALL_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};
const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: timedFetch },
};
// Secret key client: server-only database functions and Supabase Auth admin calls.
const secretClient = keys.secretKey ? createClient(supabaseUrl, keys.secretKey, clientOptions) : null;

const notConfigured = { message: 'not configured' };

async function serviceRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  if (!secretClient) return { data: null, error: notConfigured };
  const response = await secretClient.rpc(fn, args);
  return {
    data: response.data,
    error: response.error
      ? {
          code: response.error.code,
          message: response.error.message,
          details: response.error.details,
          hint: response.error.hint,
          status: response.status,
        }
      : null,
  };
}

const deps: AuthLinkDeps = {
  keys,
  allowedOrigins: parseAllowedOriginsEnv(env.ALLOWED_ORIGINS),

  serviceRpc,

  rateLimitHit(keyHash, limit, windowSeconds) {
    return serviceRpc('fn_rate_limit_hit', { p_key_hash: keyHash, p_limit: limit, p_window_seconds: windowSeconds });
  },

  async createAuthUser(email, password) {
    if (!secretClient) return { userId: null, error: notConfigured };
    const { data, error } = await secretClient.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return { userId: null, error: { message: error.message, code: error.code ?? null, status: error.status } };
    return { userId: data.user?.id ?? null, error: data.user ? null : { message: 'no user returned' } };
  },

  async updateAuthUser(userId, attributes) {
    if (!secretClient) return { error: notConfigured };
    const { error } = await secretClient.auth.admin.updateUserById(userId, {
      password: attributes.password,
      ...(attributes.emailConfirm ? { email_confirm: true } : {}),
    });
    return { error: error ? { message: error.message, code: error.code ?? null, status: error.status } : null };
  },
};

Deno.serve(request => handleAuthLinks(request, deps));
