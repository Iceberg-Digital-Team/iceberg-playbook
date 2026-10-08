// Environment parsing (pure, no Deno APIs).
import type { SupabaseKeys } from './types.ts';

type Env = Record<string, string | undefined>;

// New Supabase API keys come as JSON dictionaries: {"<name>": "<key>"}.
// Missing value, bad JSON or unknown name -> null (caller falls back to the legacy key).
function pickNamedKey(json: string | undefined, name: string): string | null {
  if (!json || !json.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const value = (parsed as Record<string, unknown>)[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function plain(value: string | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// New keys first (SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS, name from
// SUPABASE_PUBLISHABLE_KEY_NAME / SUPABASE_SECRET_KEY_NAME, default "default"),
// then legacy SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.
export function resolveSupabaseKeys(env: Env): SupabaseKeys {
  const publishableName = plain(env.SUPABASE_PUBLISHABLE_KEY_NAME) ?? 'default';
  const secretName = plain(env.SUPABASE_SECRET_KEY_NAME) ?? 'default';

  const newPublishable = pickNamedKey(env.SUPABASE_PUBLISHABLE_KEYS, publishableName);
  const newSecret = pickNamedKey(env.SUPABASE_SECRET_KEYS, secretName);
  const publishableKey = newPublishable ?? plain(env.SUPABASE_ANON_KEY);
  const secretKey = newSecret ?? plain(env.SUPABASE_SERVICE_ROLE_KEY);

  const usedNew = Boolean(newPublishable || newSecret);
  const usedLegacy = Boolean((publishableKey && !newPublishable) || (secretKey && !newSecret));
  const source: SupabaseKeys['source'] = usedNew && usedLegacy ? 'mixed' : usedNew ? 'new' : usedLegacy ? 'legacy' : 'none';
  return { publishableKey, secretKey, source };
}

// ALLOWED_ORIGINS: comma-separated origins. Missing / empty -> [] (fail closed for browsers).
export function parseAllowedOriginsEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(origin => origin.trim().replace(/\/+$/, ''))
    .filter(origin => origin !== '' && origin !== '*');
}
