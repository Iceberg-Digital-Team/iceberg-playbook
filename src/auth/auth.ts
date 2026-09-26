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
// UI preview only: no account lookup, token, credential storage or authorization.
// Replace this adapter with Supabase Auth and load the profile by user.id.
export const mockAuthAdapter: AuthAdapter = {
  async signIn({ email, password }) {
    const errors = validateSignIn(email, password);
    if (errors.email || errors.password) throw new Error('Enter a valid work email and password.');
    await new Promise(resolve => setTimeout(resolve, 650));
    return {
      user: { id: 'preview-user', email: email.trim() },
      profile: { user_id: 'preview-user', full_name: 'Tarik Deniz', role: 'Support', department: 'Support Team', avatar_url: null },
    };
  },
  async signOut() {},
};
// Future mutation boundaries can use the user ID for created_by, updated_by,
// and version_created_by. Existing authors and historical records stay intact.
export function getAuthActor(session: AuthSession) {
  return { userId: session.user.id, name: session.profile?.full_name || session.user.email };
}
