import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function getEnv(name: string): string {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[name]) {
    return import.meta.env[name];
  }
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process;
  if (proc?.env && proc.env[name]) {
    return proc.env[name];
  }
  return '';
}

const supabaseUrl = getEnv('VITE_SUPABASE_URL');
const supabaseKey = getEnv('VITE_SUPABASE_PUBLISHABLE_KEY') || getEnv('VITE_SUPABASE_ANON_KEY');

export function validateSupabaseConfig(): void {
  const missing: string[] = [];
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!supabaseKey) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY)');

  if (missing.length > 0) {
    throw new Error(
      `Missing required Supabase environment configuration: ${missing.join(', ')}. ` +
      'Please check your .env.local file (refer to .env.example).'
    );
  }
}

// Fail clearly during development if required environment variables are missing
validateSupabaseConfig();

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
