import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '../lib/supabase';
import type { AuthAdapter, AuthSession, Profile, Role, SignInInput } from './auth';

export async function fetchUserProfile(
  client: SupabaseClient,
  userId: string
): Promise<Profile | null> {
  const { data, error } = await client
    .from('profiles')
    .select('id, full_name, role, avatar_url')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    user_id: data.id,
    full_name: data.full_name || 'Team Member',
    role: data.role as Role,
    department: 'Support Team',
    avatar_url: data.avatar_url ?? null,
  };
}

export function createSupabaseAuthAdapter(
  client: SupabaseClient = defaultSupabase
): AuthAdapter {
  return {
    async signIn(input: SignInInput): Promise<AuthSession> {
      const { data, error } = await client.auth.signInWithPassword({
        email: input.email.trim(),
        password: input.password,
      });

      if (error || !data.user) {
        throw new Error(error?.message || 'Invalid email or password.');
      }

      const profile = await fetchUserProfile(client, data.user.id);

      return {
        user: {
          id: data.user.id,
          email: data.user.email || input.email.trim(),
        },
        profile,
      };
    },

    async signOut(): Promise<void> {
      const { error } = await client.auth.signOut();
      if (error) {
        throw new Error(error.message);
      }
    },

    async getSession(): Promise<AuthSession | null> {
      const { data: { session }, error } = await client.auth.getSession();
      if (error || !session?.user) {
        return null;
      }

      const profile = await fetchUserProfile(client, session.user.id);

      return {
        user: {
          id: session.user.id,
          email: session.user.email || '',
        },
        profile,
      };
    },
  };
}

export const supabaseAuthAdapter: AuthAdapter = createSupabaseAuthAdapter();
