// Deno entry for the auth-links Edge Function. Only this file uses Deno and npm: imports.
// All logic is in handler.ts (tested in Node with fakes).
// Deploy with --no-verify-jwt (public endpoint, authorized by the link token): see docs/USER_MANAGEMENT_API.md §14.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { parseAllowedOriginsEnv, resolveSupabaseKeys } from '../_shared/env.ts';
import type { AuthLinkDeps, SupabaseKeys } from '../_shared/types.ts';
import { handleAuthLinks } from './handler.ts';

const env = Deno.env.toObject();
const supabaseUrl = env.SUPABASE_URL ?? '';
const resolvedKeys = resolveSupabaseKeys(env);
// Without a project URL nothing can work: treat it like missing keys (500, no partial work).
const keys: SupabaseKeys = supabaseUrl ? resolvedKeys : { publishableKey: null, secretKey: null, source: 'none' };
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
// Secret key client: server-only database functions and Supabase Auth admin calls.
const secretClient = keys.secretKey ? createClient(supabaseUrl, keys.secretKey, clientOptions) : null;

const notConfigured = { message: 'not configured' };

const deps: AuthLinkDeps = {
  keys,
  allowedOrigins: parseAllowedOriginsEnv(env.ALLOWED_ORIGINS),

  async serviceRpc(fn, args) {
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
