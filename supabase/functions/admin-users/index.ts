// Deno entry for the admin-users Edge Function. Only this file uses Deno and npm: imports.
// All logic is in handler.ts (tested in Node with fakes).
// Deploy: see docs/USER_MANAGEMENT_API.md §14.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { parseAllowedOriginsEnv, resolveSupabaseKeys } from '../_shared/env.ts';
import type { AdminDeps, SupabaseKeys } from '../_shared/types.ts';
import { handleAdminUsers } from './handler.ts';

const env = Deno.env.toObject();
const supabaseUrl = env.SUPABASE_URL ?? '';
const resolvedKeys = resolveSupabaseKeys(env);
// Without a project URL nothing can work: treat it like missing keys (500, no partial work).
const keys: SupabaseKeys = supabaseUrl ? resolvedKeys : { publishableKey: null, secretKey: null, source: 'none' };
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const secretClient = keys.secretKey ? createClient(supabaseUrl, keys.secretKey, clientOptions) : null;

const deps: AdminDeps = {
  keys,
  allowedOrigins: parseAllowedOriginsEnv(env.ALLOWED_ORIGINS),

  async callerRpc(authorization, fn, args) {
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
  },

  async setUserBanned(userId, banned) {
    if (!secretClient) return { error: { message: 'not configured' } };
    const { error } = await secretClient.auth.admin.updateUserById(userId, {
      ban_duration: banned ? '876000h' : 'none',
    });
    return { error: error ? { message: error.message, code: error.code ?? null, status: error.status } : null };
  },
};

Deno.serve(request => handleAdminUsers(request, deps));
