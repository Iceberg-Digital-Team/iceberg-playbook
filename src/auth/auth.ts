export type Role = 'Admin' | 'Support' | 'Viewer';
export interface AuthUser { id: string; email: string }
export interface Profile { user_id: string; full_name: string; role: Role; department: string; avatar_url: string | null }
export interface AuthSession { user: AuthUser; profile: Profile | null }
export interface SignInInput { email: string; password: string; remember: boolean }
export interface AuthAdapter {
  signIn(input: SignInInput): Promise<AuthSession>;
  signOut(): Promise<void>;
  getSession?(): Promise<AuthSession | null>;
}
export function validateSignIn(email: string, password: string) {
  return {
    email: !email.trim() ? 'Enter your work email.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'Enter a valid work email.' : '',
    password: !password.trim() ? 'Enter your password.' : '',
  };
}
// Future mutation boundaries can use the user ID for created_by, updated_by,
// and version_created_by. Existing authors and historical records stay intact.
export function getAuthActor(session: AuthSession) {
  return { userId: session.user.id, name: session.profile?.full_name || session.user.email };
}
