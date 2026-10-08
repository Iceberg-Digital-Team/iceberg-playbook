import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { importTs, importTranspiled } from './helpers/transpile.mjs';

const { handleAuthLinks } = await importTs('supabase/functions/auth-links/handler.ts', 'auth-links-function');
const { hashToken, generateToken } = await importTranspiled('supabase/functions/_shared/tokens.ts', 'auth-links-function');

const BASE = 'https://project.supabase.co/functions/v1/auth-links';
const ORIGIN = 'https://app.example.test';
const SECRET = 'sb_secret_TEST_SECRET_VALUE';
const PASSWORD = 'correct horse battery';
const NEW_ID = '11111111-2222-4333-8444-555555555555';
const ORPHAN_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const PROFILE_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const EMAIL = 'new@example.test';

const logged = [];
const originalConsole = {};
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  originalConsole[level] = console[level];
  console[level] = (...args) => logged.push(args.map(String).join(' '));
}
after(() => Object.assign(console, originalConsole));

const usedTokens = [];
const bodies = [];

const linkInfo = (purpose = 'invitation', email = EMAIL) =>
  ({ purpose, status: 'Pending', email, full_name: 'TEST - New', role: 'Viewer', expires_at: '2026-10-09T10:00:00+00:00' });
const ok = data => ({ data, error: null });
const dbError = code => ({ data: null, error: { code: 'P0001', message: code, details: null, hint: null } });

function setup(over = {}) {
  const calls = [];
  let lookups = 0;
  const deps = {
    keys: { publishableKey: null, secretKey: SECRET, source: 'new' },
    allowedOrigins: [ORIGIN],
    async serviceRpc(fn, args) {
      calls.push({ kind: 'rpc', fn, args });
      if (fn === 'fn_find_auth_user_by_email' && Array.isArray(over.found)) {
        return ok(over.found[Math.min(lookups++, over.found.length - 1)]);
      }
      const result = over.rpc?.[fn];
      if (typeof result === 'function') return result(args);
      return result ?? ok(null);
    },
    async createAuthUser(email, password) {
      calls.push({ kind: 'create', email, password });
      return over.create ? over.create() : { userId: NEW_ID, error: null };
    },
    async updateAuthUser(userId, attributes) {
      calls.push({ kind: 'update', userId, attributes });
      return over.update ? over.update() : { error: null };
    },
    ...over.deps,
  };
  return { deps, calls };
}

async function post(deps, path, body, { origin = ORIGIN, method = 'POST' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  const response = await handleAuthLinks(
    new Request(`${BASE}${path}`, { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined }),
    deps,
  );
  const text = await response.text();
  bodies.push(text);
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null, text };
}

function newToken() {
  const token = generateToken();
  usedTokens.push(token);
  return token;
}

const kinds = calls => calls.map(c => (c.kind === 'rpc' ? c.fn : c.kind));

test('routing: OPTIONS, 404, 405, CORS fail closed', async () => {
  const { deps, calls } = setup();
  const pre = await handleAuthLinks(new Request(`${BASE}/activate`, { method: 'OPTIONS', headers: { Origin: ORIGIN } }), deps);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal((await post(deps, '/nope', {})).status, 404);
  const wrong = await post(deps, '/activate', null, { method: 'GET' });
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('Allow'), 'POST, OPTIONS');
  const closed = setup({ deps: { allowedOrigins: [] } });
  assert.equal((await post(closed.deps, '/invitations/lookup', { token: newToken() })).status, 403);
  assert.equal(calls.length + closed.calls.length, 0);
});

test('missing secret key -> 500 unknown before any call', async () => {
  const { deps, calls } = setup({ deps: { keys: { publishableKey: 'p', secretKey: null, source: 'mixed' } } });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'unknown');
  assert.equal(calls.length, 0);
  assert.ok(logged.some(line => line.includes('config_missing step=auth-links')));
});

test('lookup reads the token from the POST body and sends only its hash', async () => {
  const token = newToken();
  const { deps, calls } = setup({ rpc: { fn_get_activation_link: ok({ ...linkInfo(), id: 'x', user_id: 'y' }) } });
  const res = await post(deps, '/invitations/lookup', { token: `  ${token}  ` });
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [{ kind: 'rpc', fn: 'fn_get_activation_link', args: { p_token_hash: await hashToken(token) } }]);
  assert.deepEqual(Object.keys(res.body).sort(), ['email', 'expiresAt', 'fullName', 'purpose', 'role', 'status']);
});

test('bad token format -> 400 token_invalid without any call', async () => {
  const { deps, calls } = setup();
  for (const token of [undefined, '', 'short', `${generateToken().slice(1)}+`]) {
    const res = await post(deps, '/invitations/lookup', { token });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'token_invalid');
  }
  assert.equal((await post(deps, '/activate', { token: 'nope', password: PASSWORD })).body.error.code, 'token_invalid');
  assert.equal(calls.length, 0);
});

test('dead links map to 410 token_* codes', async () => {
  for (const code of ['token_expired', 'token_used', 'token_revoked']) {
    const { deps } = setup({ rpc: { fn_get_activation_link: dbError(code) } });
    const res = await post(deps, '/invitations/lookup', { token: newToken() });
    assert.equal(res.status, 410);
    assert.equal(res.body.error.code, code);
  }
});

test('weak password -> 400 invalid_input without any call', async () => {
  const { deps, calls } = setup();
  const res = await post(deps, '/activate', { token: newToken(), password: 'short' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_input');
  assert.equal(calls.length, 0);
});

test('new user: create the auth user, then accept; no later password update', async () => {
  const token = newToken();
  const { deps, calls } = setup({
    found: [null],
    rpc: { fn_get_activation_link: ok(linkInfo()), fn_accept_invitation: ok({ purpose: 'invitation', email: EMAIL }) },
  });
  const res = await post(deps, '/activate', { token, password: PASSWORD });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { purpose: 'invitation', email: EMAIL });
  assert.deepEqual(kinds(calls), ['fn_get_activation_link', 'fn_find_auth_user_by_email', 'create', 'fn_accept_invitation']);
  assert.deepEqual(calls[1].args, { p_email: EMAIL });
  assert.deepEqual(calls[2], { kind: 'create', email: EMAIL, password: PASSWORD });
  assert.deepEqual(calls[3].args, { p_token_hash: await hashToken(token), p_auth_user_id: NEW_ID });
});

test('new user: accept fails -> error, link stays (no delete, no password update)', async () => {
  const { deps, calls } = setup({
    found: [null],
    rpc: { fn_get_activation_link: ok(linkInfo()), fn_accept_invitation: dbError('token_used') },
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 410);
  assert.deepEqual(kinds(calls), ['fn_get_activation_link', 'fn_find_auth_user_by_email', 'create', 'fn_accept_invitation']);
});

test('orphan: accept FIRST, then set the password', async () => {
  const token = newToken();
  const { deps, calls } = setup({
    found: [{ user_id: ORPHAN_ID, has_profile: false }],
    rpc: { fn_get_activation_link: ok(linkInfo()), fn_accept_invitation: ok({ purpose: 'invitation', email: EMAIL }) },
  });
  const res = await post(deps, '/activate', { token, password: PASSWORD });
  assert.equal(res.status, 200);
  assert.deepEqual(kinds(calls), ['fn_get_activation_link', 'fn_find_auth_user_by_email', 'fn_accept_invitation', 'update']);
  assert.deepEqual(calls[2].args, { p_token_hash: await hashToken(token), p_auth_user_id: ORPHAN_ID });
  assert.deepEqual(calls[3], { kind: 'update', userId: ORPHAN_ID, attributes: { password: PASSWORD, emailConfirm: true } });
});

test('orphan: a concurrent request that loses the accept never touches the password', async () => {
  const { deps, calls } = setup({
    found: [{ user_id: ORPHAN_ID, has_profile: false }],
    rpc: { fn_get_activation_link: ok(linkInfo()), fn_accept_invitation: dbError('token_used') },
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 410);
  assert.equal(calls.some(c => c.kind === 'update' || c.kind === 'create'), false);
});

test('orphan: password update fails after accept -> clear 500 message', async () => {
  const { deps } = setup({
    found: [{ user_id: ORPHAN_ID, has_profile: false }],
    rpc: { fn_get_activation_link: ok(linkInfo()), fn_accept_invitation: ok({ purpose: 'invitation', email: EMAIL }) },
    update: () => ({ error: { message: 'auth down' } }),
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 500);
  assert.match(res.body.error.message, /account was created, but the password could not be saved/);
});

test('existing account with a profile -> 409 email_in_use; no create, no password change', async () => {
  const { deps, calls } = setup({
    found: [{ user_id: PROFILE_ID, has_profile: true }],
    rpc: { fn_get_activation_link: ok(linkInfo()) },
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'email_in_use');
  assert.deepEqual(kinds(calls), ['fn_get_activation_link', 'fn_find_auth_user_by_email']);
});

test('createUser race "email exists" -> look up again and continue as orphan', async () => {
  const { deps, calls } = setup({
    found: [null, { user_id: ORPHAN_ID, has_profile: false }],
    rpc: { fn_get_activation_link: ok(linkInfo()), fn_accept_invitation: ok({ purpose: 'invitation', email: EMAIL }) },
    create: () => ({ userId: null, error: { message: 'A user with this email address has already been registered', code: 'email_exists', status: 422 } }),
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 200);
  assert.deepEqual(kinds(calls),
    ['fn_get_activation_link', 'fn_find_auth_user_by_email', 'create', 'fn_find_auth_user_by_email', 'fn_accept_invitation', 'update']);
});

test('createUser race where the other request already finished -> email_in_use, no password change', async () => {
  const { deps, calls } = setup({
    found: [null, { user_id: ORPHAN_ID, has_profile: true }],
    rpc: { fn_get_activation_link: ok(linkInfo()) },
    create: () => ({ userId: null, error: { message: 'exists', code: 'email_exists' } }),
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 409);
  assert.equal(calls.some(c => c.kind === 'update'), false);
});

test('other createUser failure -> 500 unknown with a safe log', async () => {
  const { deps } = setup({
    found: [null],
    rpc: { fn_get_activation_link: ok(linkInfo()) },
    create: () => ({ userId: null, error: { message: `database error saving ${PASSWORD}`, code: 'unexpected_failure' } }),
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 500);
  assert.ok(logged.some(line => line.includes('create_user_failed code=unexpected_failure step=invitation')));
});

test('new user: Supabase weak password -> 400 invalid_input and the link is not used', async () => {
  for (const error of [
    { message: 'Password should be at least 10 characters.', code: 'weak_password', status: 422 },
    { message: 'Password is known to be weak and easy to guess, please choose a different one.' },
  ]) {
    const { deps, calls } = setup({
      found: [null],
      rpc: { fn_get_activation_link: ok(linkInfo()) },
      create: () => ({ userId: null, error }),
    });
    const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error, {
      code: 'invalid_input',
      message: 'This password does not meet the password policy. Choose a stronger password.',
      suggestion: null,
    });
    assert.deepEqual(kinds(calls), ['fn_get_activation_link', 'fn_find_auth_user_by_email', 'create']);
  }
});

test('orphan: Supabase weak password after accept -> 400 with the "too weak" message', async () => {
  const { deps } = setup({
    found: [{ user_id: ORPHAN_ID, has_profile: false }],
    rpc: { fn_get_activation_link: ok(linkInfo()), fn_accept_invitation: ok({ purpose: 'invitation', email: EMAIL }) },
    update: () => ({ error: { message: 'Password should contain at least one character of each', code: 'weak_password' } }),
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_input');
  assert.equal(res.body.error.message,
    'Your account was created, but the password was too weak for the password policy and could not be saved. Ask your Admin for a password link.');
});

test('password reset: Supabase weak password after the claim -> 400 with the "too weak" message', async () => {
  const { deps } = setup({
    rpc: {
      fn_get_activation_link: ok(linkInfo('password_reset')),
      fn_accept_password_reset: ok({ purpose: 'password_reset', email: EMAIL, user_id: PROFILE_ID }),
    },
    update: () => ({ error: { message: 'weak_password', code: 'weak_password', status: 422 } }),
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_input');
  assert.equal(res.body.error.message,
    'Your link was used, but the new password was too weak for the password policy and could not be saved. Ask your Admin for a new password link.');
  assert.ok(logged.some(line => line.includes('password_update_failed code=weak_password step=password_reset')));
});

test('password reset: claim the link first, then set the password; no user_id in the response', async () => {
  const token = newToken();
  const { deps, calls } = setup({
    rpc: {
      fn_get_activation_link: ok(linkInfo('password_reset', 'user@example.test')),
      fn_accept_password_reset: ok({ purpose: 'password_reset', email: 'user@example.test', user_id: PROFILE_ID }),
    },
  });
  const res = await post(deps, '/activate', { token, password: PASSWORD });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { purpose: 'password_reset', email: 'user@example.test' });
  assert.deepEqual(kinds(calls), ['fn_get_activation_link', 'fn_accept_password_reset', 'update']);
  assert.deepEqual(calls[1].args, { p_token_hash: await hashToken(token) });
  assert.deepEqual(calls[2], { kind: 'update', userId: PROFILE_ID, attributes: { password: PASSWORD, emailConfirm: false } });
  assert.equal(res.text.includes(PROFILE_ID), false);
});

test('password reset: update fails after the claim -> 500 with a clear message', async () => {
  const { deps } = setup({
    rpc: {
      fn_get_activation_link: ok(linkInfo('password_reset')),
      fn_accept_password_reset: ok({ purpose: 'password_reset', email: EMAIL, user_id: PROFILE_ID }),
    },
    update: () => { throw new Error('network'); },
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 500);
  assert.match(res.body.error.message, /link was used, but the new password could not be saved/);
});

test('password reset: claim fails -> no password change', async () => {
  const { deps, calls } = setup({
    rpc: { fn_get_activation_link: ok(linkInfo('password_reset')), fn_accept_password_reset: dbError('token_revoked') },
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 410);
  assert.equal(calls.some(c => c.kind === 'update'), false);
});

test('nothing secret is ever logged or returned', async () => {
  const hashes = await Promise.all(usedTokens.map(hashToken));
  const log = logged.join('\n');
  for (const secret of [...usedTokens, ...hashes, PASSWORD, SECRET]) {
    assert.equal(log.includes(secret), false, 'a secret value was logged');
  }
  const all = bodies.join('\n');
  for (const secret of [...usedTokens, ...hashes, PASSWORD, SECRET, 'token_hash']) {
    assert.equal(all.includes(secret), false, 'a secret value was returned');
  }
});
