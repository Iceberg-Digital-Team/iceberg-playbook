import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthAdapter, AuthSession, SignInInput } from './auth';
import { supabaseAuthAdapter } from './supabaseAuth';

export interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  signIn: (input: SignInInput) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  adapter = supabaseAuthAdapter,
}: {
  children: ReactNode;
  adapter?: AuthAdapter;
}) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(() => Boolean(adapter.getSession));

  useEffect(() => {
    let active = true;

    if (!adapter.getSession) {
      return;
    }

    adapter.getSession()
      .then(s => {
        if (active) {
          setSession(s);
          setLoading(false);
        }
      })
      .catch(err => {
        console.error('[AuthProvider] Failed to restore session:', err);
        if (active) {
          setSession(null);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [adapter]);

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        signIn: async input => {
          setSession(await adapter.signIn(input));
        },
        signOut: async () => {
          try {
            await adapter.signOut();
          } finally {
            setSession(null);
          }
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required.');
  return context;
}
