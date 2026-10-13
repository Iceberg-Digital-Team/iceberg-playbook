import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importTs } from './helpers/transpile.mjs';

const { parseHash } = await importTs('src/router.ts', 'app-access-router');
const { decideEntry, canOpenAdminUsers, AUTH_PATHS, PUBLIC_PATHS } = await importTs('src/appAccess.ts', 'app-access');

test('router knows #/admin/users and #/activate (token in params)', () => {
  assert.deepEqual(parseHash('#/admin/users'), { path: '/admin/users', params: {} });
  assert.deepEqual(parseHash('#/activate?token=abc_-1'), { path: '/activate', params: { token: 'abc_-1' } });
  assert.deepEqual(parseHash('#/activate'), { path: '/activate', params: {} });
  assert.equal(parseHash('#/settings').path, '/settings');
  assert.equal(parseHash('#/admin/other').path, '/');
});

test('#/activate works signed in and signed out', () => {
  assert.deepEqual(PUBLIC_PATHS, ['/activate']);
  assert.deepEqual(decideEntry('/activate', false), { view: 'activate', redirect: null });
  assert.deepEqual(decideEntry('/activate', true), { view: 'activate', redirect: null });
});

test('signed out users go to sign in, except the auth pages', () => {
  assert.deepEqual(AUTH_PATHS, ['/login', '/forgot-password']);
  assert.deepEqual(decideEntry('/', false), { view: 'login', redirect: '#/login' });
  assert.deepEqual(decideEntry('/admin/users', false), { view: 'login', redirect: '#/login' });
  assert.deepEqual(decideEntry('/login', false), { view: 'login', redirect: null });
  assert.deepEqual(decideEntry('/forgot-password', false), { view: 'forgot-password', redirect: null });
});

test('signed in users leave the auth pages and see the workspace', () => {
  assert.deepEqual(decideEntry('/login', true), { view: 'workspace', redirect: '#/' });
  assert.deepEqual(decideEntry('/forgot-password', true), { view: 'workspace', redirect: '#/' });
  assert.deepEqual(decideEntry('/admin/users', true), { view: 'workspace', redirect: null });
  assert.deepEqual(decideEntry('/', true), { view: 'workspace', redirect: null });
});

test('only an Admin profile may open the Admin Users page (UX guard)', () => {
  const profile = role => ({ user_id: 'u', full_name: 'TEST - U', role, department: 'Support Team', avatar_url: null });
  assert.equal(canOpenAdminUsers(profile('Admin')), true);
  assert.equal(canOpenAdminUsers(profile('Support')), false);
  assert.equal(canOpenAdminUsers(profile('Viewer')), false);
  assert.equal(canOpenAdminUsers(null), false);
  assert.equal(canOpenAdminUsers(undefined), false);
});
