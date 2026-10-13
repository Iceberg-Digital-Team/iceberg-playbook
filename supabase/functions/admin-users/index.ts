// Deno entry for the admin-users Edge Function. Only this file uses Deno and npm: imports.
// All logic is in handler.ts (tested in Node with fakes).
// Deploy: see docs/USER_MANAGEMENT_API.md §14 (safe with or without --no-verify-jwt: the handler
// verifies the JWT and the active Admin role itself before any admin RPC).
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { parseAllowedOriginsEnv, resolveSupabaseKeys } from '../_shared/env.ts';
import type { AdminDeps, RpcResult, SupabaseKeys } from '../_shared/types.ts';
import { handleAdminUsers } from './handler.ts';

const env = Deno.env.toObject();
const supabaseUrl = env.SUPABASE_URL ?? '';
const resolvedKeys = resolveSupabaseKeys(env);
// Without a project URL nothing can work: treat it like missing keys (500, no partial work).
const keys: SupabaseKeys = supabaseUrl ? resolvedKeys : { publishableKey: null, secretKey: null, source: 'none' };
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const secretClient = keys.secretKey ? createClient(supabaseUrl, keys.secretKey, clientOptions) : null;

async function callerRpc(authorization: string, fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  // Publishable key + the caller's own JWT: the database sees the real auth.uid().
  const client = createClient(supabaseUrl, keys.publishableKey ?? '', {
    ...clientOptions,
    global: { headers: { Authorization: authorization } },
  });
  const response = await client.rpc(fn, args);
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

const deps: AdminDeps = {
  keys,
  allowedOrigins: parseAllowedOriginsEnv(env.ALLOWED_ORIGINS),

  async getAuthUser(jwt) {
    // auth.getUser(jwt) asks the Auth server: it checks the signature with the project's current
    // signing keys (legacy and new), the expiry, that the user still exists and that the session
    // was not signed out. A local claims check (getClaims) would miss deleted users / ended sessions.
    if (!secretClient) return { userId: null, error: { message: 'not configured' } };
    const { data, error } = await secretClient.auth.getUser(jwt);
    if (error) return { userId: null, error: { message: error.message, code: error.code ?? null, status: error.status } };
    return { userId: data.user?.id ?? null, error: null };
  },

  checkActiveAdmin(authorization) {
    return callerRpc(authorization, 'fn_admin_current_caller', {});
  },

  callerRpc,

  async setUserBanned(userId, banned) {
    if (!secretClient) return { error: { message: 'not configured' } };
    const { error } = await secretClient.auth.admin.updateUserById(userId, {
      ban_duration: banned ? '876000h' : 'none',
    });
    return { error: error ? { message: error.message, code: error.code ?? null, status: error.status } : null };
  },
};

Deno.serve(request => handleAdminUsers(request, deps));
