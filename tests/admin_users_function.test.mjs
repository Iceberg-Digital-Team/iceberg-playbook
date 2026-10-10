import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { importTs, importTranspiled } from './helpers/transpile.mjs';

const { handleAdminUsers } = await importTs('supabase/functions/admin-users/handler.ts', 'admin-users-function');
const { hashToken } = await importTranspiled('supabase/functions/_shared/tokens.ts', 'admin-users-function');

const BASE = 'https://project.supabase.co/functions/v1/admin-users';
const ORIGIN = 'https://app.example.test';
const AUTH = 'Bearer caller.jwt.value';
const SECRET = 'sb_secret_TEST_SECRET_VALUE';
const PUBLISHABLE = 'sb_publishable_TEST_VALUE';
const USER_ID = '11111111-2222-4333-8444-555555555555';
const INV_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const EXPIRES = '2026-10-09T10:00:00.000Z';
const CALLER_ID = 'cccccccc-dddd-4eee-8fff-000000000000';

// Every console line written during this file; checked at the end for secrets.
const logged = [];
const originalConsole = {};
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  originalConsole[level] = console[level];
  console[level] = (...args) => logged.push(args.map(String).join(' '));
}
const issuedTokens = [];
const bodies = [];

const userRow = (over = {}) => ({
  id: USER_ID, email: 'user@example.test', full_name: 'TEST - User', role: 'Support', status: 'Active',
  created_at: '2026-01-01T00:00:00+00:00', ...over,
});
const linkRow = (over = {}) => ({ invitation_id: INV_ID, purpose: 'invitation', email: 'new@example.test', expires_at: EXPIRES, ...over });

function setup(over = {}) {
  const calls = [];
  // Caller verification (JWT + active Admin) is logged separately so the RPC call lists stay exact.
  const authCalls = [];
  const deps = {
    keys: { publishableKey: PUBLISHABLE, secretKey: SECRET, source: 'new' },
    allowedOrigins: [ORIGIN],
    async getAuthUser(jwt) {
      authCalls.push({ kind: 'getUser', jwt });
      return over.getUser ? over.getUser(jwt) : { userId: CALLER_ID, error: null };
    },
    async checkActiveAdmin(authorization) {
      authCalls.push({ kind: 'checkAdmin', authorization });
      return over.checkAdmin ? over.checkAdmin(authorization) : { data: { user_id: CALLER_ID }, error: null };
    },
    async callerRpc(authorization, fn, args) {
      calls.push({ kind: 'rpc', authorization, fn, args });
      const result = over.rpc?.[fn];
      if (typeof result === 'function') return result(args);
      return result ?? { data: null, error: null };
    },
    async setUserBanned(userId, banned) {
      calls.push({ kind: 'ban', userId, banned });
      return over.ban ? over.ban(userId, banned) : { error: null };
    },
    ...over.deps,
  };
  return { deps, calls, authCalls };
}

async function call(deps, method, path, { body, headers = {}, auth = AUTH, origin = ORIGIN } = {}) {
  const allHeaders = { ...headers };
  if (auth) allHeaders.Authorization = auth;
  if (origin) allHeaders.Origin = origin;
  if (body !== undefined) allHeaders['Content-Type'] = 'application/json';
  const response = await handleAdminUsers(
    new Request(`${BASE}${path}`, { method, headers: allHeaders, body: body === undefined ? undefined : JSON.stringify(body) }),
    deps,
  );
  const text = await response.text();
  bodies.push(text);
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null, text };
}

after(() => {
  Object.assign(console, originalConsole);
});

test('OPTIONS preflight returns 204 with CORS headers and no RPC', async () => {
  const { deps, calls } = setup();
  const res = await call(deps, 'OPTIONS', '/users', { auth: null });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), null);
  assert.equal(calls.length, 0);
});

test('disallowed or unconfigured origin -> 403 without RPC', async () => {
  const { deps, calls } = setup();
  assert.equal((await call(deps, 'GET', '/users', { origin: 'https://evil.example.test' })).status, 403);
  const closed = setup({ deps: { allowedOrigins: [] } });
  const res = await call(closed.deps, 'OPTIONS', '/users');
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'forbidden');
  assert.equal((await call(closed.deps, 'GET', '/users')).status, 403);
  assert.equal(calls.length + closed.calls.length, 0);
  assert.ok(logged.some(line => line.includes('cors_not_configured')));
});

test('unknown route -> 404, wrong method -> 405 with Allow', async () => {
  const { deps, calls } = setup();
  const notFound = await call(deps, 'GET', '/nope');
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body.error.code, 'not_found');
  const wrong = await call(deps, 'DELETE', '/users');
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('Allow'), 'GET, OPTIONS');
  assert.equal(calls.length, 0);
});

test('missing or malformed Authorization -> 401 without RPC', async () => {
  const { deps, calls } = setup();
  for (const auth of [null, 'caller.jwt', 'Basic abc', 'Bearer ']) {
    const res = await call(deps, 'GET', '/users', { auth });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'unauthenticated');
  }
  assert.equal(calls.length, 0);
});

test('missing keys -> 500 unknown before any RPC or auth call', async () => {
  for (const keys of [
    { publishableKey: null, secretKey: SECRET, source: 'mixed' },
    { publishableKey: PUBLISHABLE, secretKey: null, source: 'mixed' },
    { publishableKey: null, secretKey: null, source: 'none' },
  ]) {
    const { deps, calls } = setup({ deps: { keys } });
    const res = await call(deps, 'POST', `/users/${USER_ID}/disable`);
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'unknown');
    assert.equal(calls.length, 0);
  }
  assert.ok(logged.some(line => line.includes('config_missing step=admin-users')));
});

test('GET /users calls fn_admin_list_users with the caller JWT and maps camelCase', async () => {
  const { deps, calls } = setup({
    rpc: { fn_admin_list_users: { data: { users: [userRow()], invitations: [] }, error: null } },
  });
  const res = await call(deps, 'GET', '/users');
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [{ kind: 'rpc', authorization: AUTH, fn: 'fn_admin_list_users', args: {} }]);
  assert.equal(res.body.users[0].fullName, 'TEST - User');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('POST /invitations sends only the token hash and returns the raw token once', async () => {
  const { deps, calls } = setup({ rpc: { fn_admin_create_invitation: { data: linkRow(), error: null } } });
  const res = await call(deps, 'POST', '/invitations', {
    body: { email: 'New@Example.test', fullName: 'TEST - New', role: 'Viewer', expiresAt: EXPIRES, userId: 'ignored' },
  });
  assert.equal(res.status, 201);
  const { args, authorization, fn } = calls[0];
  assert.equal(fn, 'fn_admin_create_invitation');
  assert.equal(authorization, AUTH);
  assert.deepEqual(Object.keys(args).sort(), ['p_email', 'p_expires_at', 'p_full_name', 'p_role', 'p_token_hash']);
  assert.equal(args.p_email, 'New@Example.test');
  assert.match(res.body.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(args.p_token_hash, await hashToken(res.body.token));
  assert.equal(Object.values(args).includes(res.body.token), false);
  assert.deepEqual(Object.keys(res.body).sort(), ['delivery', 'email', 'expiresAt', 'invitationId', 'purpose', 'token']);
  assert.equal(res.body.delivery, 'manual');
  issuedTokens.push(res.body.token, args.p_token_hash);
});

test('POST /invitations validates input before the RPC', async () => {
  const { deps, calls } = setup();
  const valid = { email: 'a@example.test', fullName: 'A', role: 'Viewer', expiresAt: EXPIRES };
  for (const body of [{ ...valid, role: 'Owner' }, { ...valid, email: '' }, { ...valid, fullName: 3 }, { ...valid, expiresAt: 'soon' }]) {
    const res = await call(deps, 'POST', '/invitations', { body });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'invalid_input');
  }
  const bad = await handleAdminUsers(new Request(`${BASE}/invitations`, {
    method: 'POST', headers: { Authorization: AUTH, Origin: ORIGIN }, body: '{not json',
  }), deps);
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 0);
});

test('resend, revoke, role, password link call the right RPC with the right params', async () => {
  const { deps, calls } = setup({
    rpc: {
      fn_admin_resend_invitation: { data: linkRow(), error: null },
      fn_admin_revoke_invitation: { data: null, error: null },
      fn_admin_change_user_role: { data: userRow({ role: 'Viewer' }), error: null },
      fn_admin_create_password_reset_link: { data: linkRow({ purpose: 'password_reset', email: 'user@example.test' }), error: null },
    },
  });

  const resent = await call(deps, 'POST', `/invitations/${INV_ID}/resend`, { body: { expiresAt: EXPIRES } });
  assert.equal(resent.status, 200);
  assert.equal(calls[0].fn, 'fn_admin_resend_invitation');
  assert.deepEqual({ ...calls[0].args, p_token_hash: undefined }, { p_invitation_id: INV_ID, p_expires_at: EXPIRES, p_token_hash: undefined });
  assert.equal(calls[0].args.p_token_hash, await hashToken(resent.body.token));

  const revoked = await call(deps, 'DELETE', `/invitations/${INV_ID}`);
  assert.equal(revoked.status, 204);
  assert.equal(revoked.text, '');
  assert.deepEqual(calls[1].args, { p_invitation_id: INV_ID });

  const role = await call(deps, 'PATCH', `/users/${USER_ID}/role`, { body: { role: 'Viewer' } });
  assert.equal(role.status, 200);
  assert.equal(role.body.role, 'Viewer');
  assert.deepEqual(calls[2], { kind: 'rpc', authorization: AUTH, fn: 'fn_admin_change_user_role', args: { p_user_id: USER_ID, p_role: 'Viewer' } });

  const link = await call(deps, 'POST', `/users/${USER_ID}/password-links`, { body: { expiresAt: EXPIRES } });
  assert.equal(link.status, 201);
  assert.equal(link.body.purpose, 'password_reset');
  assert.equal(calls[3].fn, 'fn_admin_create_password_reset_link');
  assert.equal(calls[3].args.p_user_id, USER_ID);
  assert.equal(calls[3].args.p_token_hash, await hashToken(link.body.token));
  assert.ok(calls.every(c => c.authorization === AUTH));
  issuedTokens.push(resent.body.token, link.body.token, calls[0].args.p_token_hash, calls[3].args.p_token_hash);
});

test('bad ids and roles -> 400 without RPC', async () => {
  const { deps, calls } = setup();
  assert.equal((await call(deps, 'POST', '/users/not-a-uuid/disable')).status, 400);
  assert.equal((await call(deps, 'DELETE', '/invitations/123')).status, 400);
  assert.equal((await call(deps, 'PATCH', `/users/${USER_ID}/role`, { body: { role: 'root' } })).status, 400);
  assert.equal(calls.length, 0);
});

test('database errors map to status, message and suggestion', async () => {
  const hint = JSON.stringify({ action: 'resend_invitation', invitationId: INV_ID });
  const { deps } = setup({
    rpc: {
      fn_admin_create_invitation: { data: null, error: { code: 'P0001', message: 'invitation_exists', details: 'Resend it instead.', hint } },
      fn_admin_change_user_role: { data: null, error: { code: 'P0001', message: 'self_action', details: null, hint: null } },
      fn_admin_list_users: { data: null, error: { code: '42883', message: 'function does not exist', details: null, hint: null } },
    },
  });
  const conflict = await call(deps, 'POST', '/invitations', { body: { email: 'a@example.test', fullName: 'A', role: 'Viewer', expiresAt: EXPIRES } });
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.body, { error: { code: 'invitation_exists', message: 'Resend it instead.', suggestion: { action: 'resend_invitation', invitationId: INV_ID } } });

  const self = await call(deps, 'PATCH', `/users/${USER_ID}/role`, { body: { role: 'Viewer' } });
  assert.equal(self.status, 409);
  assert.equal(self.body.error.code, 'self_action');

  const unknown = await call(deps, 'GET', '/users');
  assert.equal(unknown.status, 500);
  assert.equal(unknown.body.error.code, 'unknown');
  assert.doesNotMatch(unknown.text, /does not exist/);
});

test('disable bans and enable unbans after the database step', async () => {
  const { deps, calls } = setup({
    rpc: {
      fn_admin_disable_user: { data: userRow({ status: 'Disabled' }), error: null },
      fn_admin_enable_user: { data: userRow(), error: null },
    },
  });
  const disabled = await call(deps, 'POST', `/users/${USER_ID}/disable`);
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.status, 'Disabled');
  assert.deepEqual(calls.slice(0, 2).map(c => c.kind === 'rpc' ? c.fn : `ban:${c.banned}`), ['fn_admin_disable_user', 'ban:true']);

  const enabled = await call(deps, 'POST', `/users/${USER_ID}/enable`);
  assert.equal(enabled.status, 200);
  assert.deepEqual(calls.slice(2).map(c => c.kind === 'rpc' ? c.fn : `ban:${c.banned}`), ['fn_admin_enable_user', 'ban:false']);
});

test('disable blocked by the database -> no ban call', async () => {
  const { deps, calls } = setup({
    rpc: { fn_admin_disable_user: { data: null, error: { code: 'P0001', message: 'last_admin', details: null, hint: null } } },
  });
  const res = await call(deps, 'POST', `/users/${USER_ID}/disable`);
  assert.equal(res.status, 409);
  assert.equal(calls.filter(c => c.kind === 'ban').length, 0);
});

test('ban failure rolls the database step back and reports it', async () => {
  const { deps, calls } = setup({
    rpc: {
      fn_admin_disable_user: { data: userRow({ status: 'Disabled' }), error: null },
      fn_admin_enable_user: { data: userRow(), error: null },
    },
    ban: () => ({ error: { message: 'auth down', status: 503 } }),
  });
  const res = await call(deps, 'POST', `/users/${USER_ID}/disable`);
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'unknown');
  assert.match(res.body.error.message, /was not disabled/);
  assert.deepEqual(calls.map(c => c.kind === 'rpc' ? c.fn : 'ban'), ['fn_admin_disable_user', 'ban', 'fn_admin_enable_user']);
  assert.equal(calls[2].authorization, AUTH);
});

test('ban failure with failed rollback says so', async () => {
  const { deps } = setup({
    rpc: {
      fn_admin_disable_user: { data: userRow({ status: 'Disabled' }), error: null },
      fn_admin_enable_user: { data: null, error: { code: 'P0001', message: 'forbidden', details: null, hint: null } },
    },
    ban: () => { throw new Error('network'); },
  });
  const res = await call(deps, 'POST', `/users/${USER_ID}/disable`);
  assert.equal(res.status, 500);
  assert.match(res.body.error.message, /disabled in the app, but sign-in could not be blocked/);
});

test('unban failure rolls enable back', async () => {
  const { deps, calls } = setup({
    rpc: {
      fn_admin_enable_user: { data: userRow(), error: null },
      fn_admin_disable_user: { data: userRow({ status: 'Disabled' }), error: null },
    },
    ban: () => ({ error: { message: 'auth down' } }),
  });
  const res = await call(deps, 'POST', `/users/${USER_ID}/enable`);
  assert.equal(res.status, 500);
  assert.match(res.body.error.message, /still disabled/);
  assert.deepEqual(calls.map(c => c.kind === 'rpc' ? c.fn : 'ban'), ['fn_admin_enable_user', 'ban', 'fn_admin_disable_user']);
  assert.ok(logged.some(line => line.includes('auth_sync_failed step=unban')));
});

test('caller check: the JWT is verified with Supabase Auth and the active Admin role before any admin RPC', async () => {
  const { deps, calls, authCalls } = setup({
    rpc: { fn_admin_list_users: { data: { users: [], invitations: [] }, error: null } },
  });
  const res = await call(deps, 'GET', '/users');
  assert.equal(res.status, 200);
  assert.deepEqual(authCalls, [
    { kind: 'getUser', jwt: 'caller.jwt.value' },
    { kind: 'checkAdmin', authorization: AUTH },
  ]);
  assert.deepEqual(calls.map(c => c.fn), ['fn_admin_list_users']);
});

test('caller check: missing Authorization -> 401 without Auth or RPC call', async () => {
  const { deps, calls, authCalls } = setup();
  const res = await call(deps, 'POST', `/users/${USER_ID}/disable`, { auth: null });
  assert.equal(res.status, 401);
  assert.equal(authCalls.length + calls.length, 0);
});

test('caller check: JWT rejected by Supabase Auth -> 401 unauthenticated, no admin check, no RPC', async () => {
  for (const getUser of [
    () => ({ userId: null, error: { message: 'invalid JWT', code: 'bad_jwt', status: 401 } }),
    () => ({ userId: null, error: { message: 'User from sub claim in JWT does not exist', status: 403 } }),
    () => ({ userId: null, error: null }),
  ]) {
    const { deps, calls, authCalls } = setup({ getUser });
    const res = await call(deps, 'POST', `/users/${USER_ID}/disable`);
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'unauthenticated');
    assert.deepEqual(authCalls.map(c => c.kind), ['getUser']);
    assert.equal(calls.length, 0);
  }
});

test('caller check: not an active Admin -> 403 forbidden, no RPC, no ban', async () => {
  const forbidden = { data: null, error: { code: 'P0001', message: 'forbidden', details: 'Permission denied. Only active Admins can manage users.', hint: null } };
  const { deps, calls } = setup({ checkAdmin: () => forbidden });
  const res = await call(deps, 'POST', `/users/${USER_ID}/disable`);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'forbidden');
  assert.equal(calls.length, 0);
});

test('caller check: database says unauthenticated -> 401; other user id -> 401', async () => {
  const unauth = setup({ checkAdmin: () => ({ data: null, error: { code: 'P0001', message: 'unauthenticated', details: null, hint: null } }) });
  assert.equal((await call(unauth.deps, 'GET', '/users')).status, 401);
  const mismatch = setup({ checkAdmin: () => ({ data: { user_id: USER_ID }, error: null }) });
  const res = await call(mismatch.deps, 'GET', '/users');
  assert.equal(res.status, 401);
  assert.equal(unauth.calls.length + mismatch.calls.length, 0);
  assert.ok(logged.some(line => line.includes('caller_mismatch step=admin')));
});

test('caller check: Auth server or database unreachable -> 500 unknown, no RPC', async () => {
  for (const over of [
    { getUser: () => { throw new Error('network'); } },
    { getUser: () => ({ userId: null, error: { message: 'fetch failed', status: 0 } }) },
    { getUser: () => ({ userId: null, error: { message: 'bad gateway', status: 502 } }) },
    { checkAdmin: () => { throw new Error('network'); } },
    { checkAdmin: () => ({ data: null, error: { code: '08006', message: 'connection failure' } }) },
  ]) {
    const { deps, calls } = setup(over);
    const res = await call(deps, 'GET', '/users');
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'unknown');
    assert.equal(calls.length, 0);
  }
});

test('responses never contain token_hash or keys; logs never contain tokens, hashes or keys', () => {
  const all = bodies.join('\n');
  assert.doesNotMatch(all, /token_hash/);
  assert.equal(all.includes(SECRET), false);
  assert.equal(all.includes(PUBLISHABLE), false);
  const log = logged.join('\n');
  assert.ok(issuedTokens.length >= 6);
  for (const secret of [...issuedTokens, SECRET, PUBLISHABLE, AUTH, 'caller.jwt.value']) {
    assert.equal(log.includes(secret), false, 'a secret value was logged');
  }
});
