import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '../lib/supabase';
import type { AuthAdapter, AuthSession, Profile, Role, SignInInput } from './auth';

export async function fetchUserProfile(
  client: SupabaseClient,
  userId: string
): Promise<Profile | null> {
  const { data, error } = await client
    .from('profiles')
    .select('id, full_name, role, department, avatar_url')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('[Auth] Failed to load user profile:', error.message);
    return null;
  }

  if (!data) {
    console.warn('[Auth] No profile found for user:', userId);
    return null;
  }

  return {
    user_id: data.id,
    full_name: data.full_name || 'Team Member',
    role: data.role as Role,
    department: data.department || 'Support Team',
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
      if (!profile) {
        // Authenticated in auth.users, but no matching profile exists in public.profiles.
        // Sign out immediately and deny access with a clear error.
        await client.auth.signOut().catch(() => {});
        throw new Error('Account profile not found. Please contact an administrator to provision your profile.');
      }

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
        console.error('[Auth] Error signing out from Supabase:', error.message);
        throw new Error(error.message);
      }
    },

    async getSession(): Promise<AuthSession | null> {
      try {
        const { data: { session }, error } = await client.auth.getSession();
        if (error) {
          console.error('[Auth] Failed to get session from Supabase:', error.message);
          return null;
        }

        if (!session?.user) {
          return null;
        }

        const profile = await fetchUserProfile(client, session.user.id);
        if (!profile) {
          console.warn('[Auth] Session user has no profile; clearing session.');
          await client.auth.signOut().catch(() => {});
          return null;
        }

        return {
          user: {
            id: session.user.id,
            email: session.user.email || '',
          },
          profile,
        };
      } catch (err) {
        console.error('[Auth] Unexpected error during session restoration:', err);
        return null;
      }
    },
  };
}

export const supabaseAuthAdapter: AuthAdapter = createSupabaseAuthAdapter();
