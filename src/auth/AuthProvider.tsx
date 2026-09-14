import { createContext, useContext, useState, type ReactNode } from 'react';
import { mockAuthAdapter, type AuthAdapter, type AuthSession, type SignInInput } from './auth';

interface AuthContextValue {
  session: AuthSession | null;
  signIn: (input: SignInInput) => Promise<void>;
  signOut: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children, adapter = mockAuthAdapter }: { children: ReactNode; adapter?: AuthAdapter }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  return <AuthContext.Provider value={{ session,
    signIn: async input => { setSession(await adapter.signIn(input)); },
    signOut: async () => { await adapter.signOut(); setSession(null); },
  }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required.');
  return context;
}
