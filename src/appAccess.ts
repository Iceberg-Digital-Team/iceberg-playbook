// Which top-level view the app shows for a route, and the Admin Users page guard.
// Pure (no React, no DOM). UX only: the server is the real guard for every admin operation.
import type { Profile } from './auth/auth';

export const AUTH_PATHS: readonly string[] = ['/login', '/forgot-password'];
// Pages that work both signed in and signed out.
export const PUBLIC_PATHS: readonly string[] = ['/activate'];

export type EntryView = 'workspace' | 'login' | 'forgot-password' | 'activate';

export function decideEntry(path: string, signedIn: boolean): { view: EntryView; redirect: string | null } {
  if (PUBLIC_PATHS.includes(path)) return { view: 'activate', redirect: null };
  if (signedIn) {
    return AUTH_PATHS.includes(path) ? { view: 'workspace', redirect: '#/' } : { view: 'workspace', redirect: null };
  }
  if (path === '/forgot-password') return { view: 'forgot-password', redirect: null };
  return { view: 'login', redirect: path === '/login' ? null : '#/login' };
}

export function canOpenAdminUsers(profile: Profile | null | undefined): boolean {
  return profile?.role === 'Admin';
}
