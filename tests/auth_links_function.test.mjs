import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { importTs, importTranspiled } from './helpers/transpile.mjs';

const { handleAuthLinks } = await importTs('supabase/functions/auth-links/handler.ts', 'auth-links-function');
const { hashToken, generateToken } = await importTranspiled('supabase/functions/_shared/tokens.ts', 'auth-links-function');
const { rateLimitKey } = await importTranspiled('supabase/functions/_shared/rateLimit.ts', 'auth-links-function');

const BASE = 'https://project.supabase.co/functions/v1/auth-links';
const ORIGIN = 'https://app.example.test';
const SECRET = 'sb_secret_TEST_SECRET_VALUE';
const PASSWORD = 'correct horse battery';
const NEW_ID = '11111111-2222-4333-8444-555555555555';
const ORPHAN_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const PROFILE_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const EMAIL = 'new@example.test';
const CLAIM_ID = '99999999-8888-4777-8666-555555555555';
const CLIENT_IP = '203.0.113.7';
const WEAK_MESSAGE = 'This password does not meet the password policy. Choose a stronger password.';
const NOT_SAVED_MESSAGE = 'Your password could not be saved. Please try again.';
const TIMEOUT_MESSAGE = 'Your password could not be saved. Please wait a minute and try again.';

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
// fn_claim_activation_link result (server-only data: never sent to the browser).
const claimRow = (purpose = 'invitation', email = EMAIL, userId = null) =>
  ({ claim_id: CLAIM_ID, purpose, email, user_id: userId });
const never = () => new Promise(() => {});

function setup(over = {}) {
  const calls = [];
  // Rate limit hits are logged separately so the RPC call lists stay exact.
  const limits = [];
  let lookups = 0;
  const deps = {
    keys: { publishableKey: null, secretKey: SECRET, source: 'new' },
    allowedOrigins: [ORIGIN],
    async rateLimitHit(keyHash, limit, windowSeconds) {
      limits.push({ keyHash, limit, windowSeconds });
      return over.limit ? over.limit(limits.length, { keyHash, limit, windowSeconds }) : ok([{ allowed: true, retry_after_seconds: 600 }]);
    },
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
  return { deps, calls, limits };
}

async function post(deps, path, body, { origin = ORIGIN, method = 'POST', headers: extra = { 'cf-connecting-ip': CLIENT_IP } } = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
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

// ---- Activation: claim (60 s lease) -> password in Supabase Auth -> accept with the claim id ----

const released = calls => calls.filter(c => c.kind === 'rpc' && c.fn === 'fn_release_activation_link');

test('new user: claim, create the auth user, then accept with the claim id', async () => {
  const token = newToken();
  const { deps, calls } = setup({
    found: [null],
    rpc: { fn_claim_activation_link: ok(claimRow()), fn_accept_invitation: ok({ purpose: 'invitation', email: EMAIL }) },
  });
  const res = await post(deps, '/activate', { token, password: PASSWORD });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { purpose: 'invitation', email: EMAIL });
  assert.deepEqual(kinds(calls), ['fn_claim_activation_link', 'fn_find_auth_user_by_email', 'create', 'fn_accept_invitation']);
  assert.deepEqual(calls[0].args, { p_token_hash: await hashToken(token) });
  assert.deepEqual(calls[1].args, { p_email: EMAIL });
  assert.deepEqual(calls[2], { kind: 'create', email: EMAIL, password: PASSWORD });
  assert.deepEqual(calls[3].args, { p_claim_id: CLAIM_ID, p_auth_user_id: NEW_ID });
  assert.equal(res.text.includes(CLAIM_ID), false);
});

test('new user: accept fails -> error, lease released (no delete, no password update)', async () => {
  const { deps, calls } = setup({
    found: [null],
    rpc: { fn_claim_activation_link: ok(claimRow()), fn_accept_invitation: dbError('email_in_use') },
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 409);
  assert.deepEqual(kinds(calls),
    ['fn_claim_activation_link', 'fn_find_auth_user_by_email', 'create', 'fn_accept_invitation', 'fn_release_activation_link']);
  assert.deepEqual(calls[4].args, { p_claim_id: CLAIM_ID });
});

test('orphan: set the password while holding the claim, then accept', async () => {
  const { deps, calls } = setup({
    found: [{ user_id: ORPHAN_ID, has_profile: false }],
    rpc: { fn_claim_activation_link: ok(claimRow()), fn_accept_invitation: ok({ purpose: 'invitation', email: EMAIL }) },
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 200);
  assert.deepEqual(kinds(calls), ['fn_claim_activation_link', 'fn_find_auth_user_by_email', 'update', 'fn_accept_invitation']);
  assert.deepEqual(calls[2], { kind: 'update', userId: ORPHAN_ID, attributes: { password: PASSWORD, emailConfirm: true } });
  assert.deepEqual(calls[3].args, { p_claim_id: CLAIM_ID, p_auth_user_id: ORPHAN_ID });
});

test('a concurrent request that does not get the claim (link_busy) never touches a password', async () => {
  for (const purpose of ['invitation', 'password_reset']) {
    const { deps, calls } = setup({
      found: [{ user_id: ORPHAN_ID, has_profile: false }],
      rpc: { fn_claim_activation_link: dbError('link_busy') },
    });
    const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
    assert.equal(res.status, 409, purpose);
    assert.equal(res.body.error.code, 'link_busy');
    assert.equal(res.body.error.message, 'This link is being used right now. Please try again in a moment.');
    assert.deepEqual(kinds(calls), ['fn_claim_activation_link']);
  }
});

test('orphan: password update fails -> 500 "try again", lease released, no accept', async () => {
  const { deps, calls } = setup({
    found: [{ user_id: ORPHAN_ID, has_profile: false }],
    rpc: { fn_claim_activation_link: ok(claimRow()) },
    update: () => ({ error: { message: 'auth down', status: 500 } }),
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 500);
  assert.equal(res.body.error.message, NOT_SAVED_MESSAGE);
  assert.deepEqual(kinds(calls), ['fn_claim_activation_link', 'fn_find_auth_user_by_email', 'update', 'fn_release_activation_link']);
});

test('existing account with a profile -> 409 email_in_use; no create, no password change, lease released', async () => {
  const { deps, calls } = setup({
    found: [{ user_id: PROFILE_ID, has_profile: true }],
    rpc: { fn_claim_activation_link: ok(claimRow()) },
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'email_in_use');
  assert.deepEqual(kinds(calls), ['fn_claim_activation_link', 'fn_find_auth_user_by_email', 'fn_release_activation_link']);
});

test('createUser "email exists" -> look up again and continue as orphan', async () => {
  const { deps, calls } = setup({
    found: [null, { user_id: ORPHAN_ID, has_profile: false }],
    rpc: { fn_claim_activation_link: ok(claimRow()), fn_accept_invitation: ok({ purpose: 'invitation', email: EMAIL }) },
    create: () => ({ userId: null, error: { message: 'A user with this email address has already been registered', code: 'email_exists', status: 422 } }),
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 200);
  assert.deepEqual(kinds(calls),
    ['fn_claim_activation_link', 'fn_find_auth_user_by_email', 'create', 'fn_find_auth_user_by_email', 'update', 'fn_accept_invitation']);
});

test('createUser "email exists" and the account already has a profile -> email_in_use, no password change', async () => {
  const { deps, calls } = setup({
    found: [null, { user_id: ORPHAN_ID, has_profile: true }],
    rpc: { fn_claim_activation_link: ok(claimRow()) },
    create: () => ({ userId: null, error: { message: 'exists', code: 'email_exists' } }),
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 409);
  assert.equal(calls.some(c => c.kind === 'update'), false);
  assert.equal(released(calls).length, 1);
});

test('other createUser failure -> 500 unknown with a safe log, lease released', async () => {
  const { deps, calls } = setup({
    found: [null],
    rpc: { fn_claim_activation_link: ok(claimRow()) },
    create: () => ({ userId: null, error: { message: `database error saving ${PASSWORD}`, code: 'unexpected_failure' } }),
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 500);
  assert.ok(logged.some(line => line.includes('create_user_failed code=unexpected_failure step=invitation')));
  assert.equal(released(calls).length, 1);
});

test('new user: Supabase weak / leaked password -> 400, lease released, the link is not used', async () => {
  for (const error of [
    { message: 'Password should be at least 10 characters.', code: 'weak_password', status: 422 },
    { message: 'Password is known to be weak and easy to guess, please choose a different one.' },
  ]) {
    const { deps, calls } = setup({
      found: [null],
      rpc: { fn_claim_activation_link: ok(claimRow()) },
      create: () => ({ userId: null, error }),
    });
    const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error, { code: 'invalid_input', message: WEAK_MESSAGE, suggestion: null });
    assert.deepEqual(kinds(calls), ['fn_claim_activation_link', 'fn_find_auth_user_by_email', 'create', 'fn_release_activation_link']);
  }
});

test('orphan: Supabase weak password -> 400, lease released, no accept (the link is not used)', async () => {
  const { deps, calls } = setup({
    found: [{ user_id: ORPHAN_ID, has_profile: false }],
    rpc: { fn_claim_activation_link: ok(claimRow()) },
    update: () => ({ error: { message: 'Password should contain at least one character of each', code: 'weak_password' } }),
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.error, { code: 'invalid_input', message: WEAK_MESSAGE, suggestion: null });
  assert.deepEqual(kinds(calls), ['fn_claim_activation_link', 'fn_find_auth_user_by_email', 'update', 'fn_release_activation_link']);
});

test('password reset: Supabase weak password -> 400, lease released, the link is not used', async () => {
  const { deps, calls } = setup({
    rpc: { fn_claim_activation_link: ok(claimRow('password_reset', EMAIL, PROFILE_ID)) },
    update: () => ({ error: { message: 'weak_password', code: 'weak_password', status: 422 } }),
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.error, { code: 'invalid_input', message: WEAK_MESSAGE, suggestion: null });
  assert.deepEqual(kinds(calls), ['fn_claim_activation_link', 'update', 'fn_release_activation_link']);
  assert.ok(logged.some(line => line.includes('password_update_failed code=weak_password step=password_reset')));
});

test('password reset: claim, set the password, then accept; no user_id or claim id in the response', async () => {
  const token = newToken();
  const { deps, calls } = setup({
    rpc: {
      fn_claim_activation_link: ok(claimRow('password_reset', 'user@example.test', PROFILE_ID)),
      fn_accept_password_reset: ok({ purpose: 'password_reset', email: 'user@example.test' }),
    },
  });
  const res = await post(deps, '/activate', { token, password: PASSWORD });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { purpose: 'password_reset', email: 'user@example.test' });
  assert.deepEqual(kinds(calls), ['fn_claim_activation_link', 'update', 'fn_accept_password_reset']);
  assert.deepEqual(calls[0].args, { p_token_hash: await hashToken(token) });
  assert.deepEqual(calls[1], { kind: 'update', userId: PROFILE_ID, attributes: { password: PASSWORD, emailConfirm: false } });
  assert.deepEqual(calls[2].args, { p_claim_id: CLAIM_ID });
  assert.equal(res.text.includes(PROFILE_ID), false);
  assert.equal(res.text.includes(CLAIM_ID), false);
});

test('password reset: update fails -> 500 "try again", lease released, no accept', async () => {
  const { deps, calls } = setup({
    rpc: { fn_claim_activation_link: ok(claimRow('password_reset', EMAIL, PROFILE_ID)) },
    update: () => { throw new Error('network'); },
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 500);
  assert.equal(res.body.error.message, NOT_SAVED_MESSAGE);
  assert.deepEqual(kinds(calls), ['fn_claim_activation_link', 'update', 'fn_release_activation_link']);
});

test('password reset: claim fails -> no password change', async () => {
  const { deps, calls } = setup({ rpc: { fn_claim_activation_link: dbError('token_revoked') } });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 410);
  assert.deepEqual(kinds(calls), ['fn_claim_activation_link']);
});

test('password reset: accept fails after the password step -> error, lease released, safe log', async () => {
  const revoked = setup({
    rpc: { fn_claim_activation_link: ok(claimRow('password_reset', EMAIL, PROFILE_ID)), fn_accept_password_reset: dbError('token_revoked') },
  });
  const res = await post(revoked.deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 410);
  assert.deepEqual(kinds(revoked.calls), ['fn_claim_activation_link', 'update', 'fn_accept_password_reset', 'fn_release_activation_link']);
  assert.ok(logged.some(line => line.includes('accept_after_password_failed step=password_reset')));

  const broken = setup({
    rpc: {
      fn_claim_activation_link: ok(claimRow('password_reset', EMAIL, PROFILE_ID)),
      fn_accept_password_reset: { data: null, error: { code: '08006', message: 'connection failure' } },
    },
  });
  const unknown = await post(broken.deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(unknown.status, 500);
  assert.match(unknown.body.error.message, /may already work, but the link could not be closed/);
});

test('release failure is logged and the original error is still returned', async () => {
  const { deps } = setup({
    found: [null],
    rpc: { fn_claim_activation_link: ok(claimRow()), fn_release_activation_link: { data: null, error: { message: 'down' } } },
    create: () => ({ userId: null, error: { message: 'weak', code: 'weak_password' } }),
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.message, WEAK_MESSAGE);
  assert.ok(logged.some(line => line.includes('release_failed step=activate')));
});

test('unexpected claim response -> 500 unknown, no password change', async () => {
  const { deps, calls } = setup({ rpc: { fn_claim_activation_link: ok({ purpose: 'invitation' }) } });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 500);
  assert.deepEqual(kinds(calls), ['fn_claim_activation_link']);
});

// ---- Supabase Auth call timeout: the lease is KEPT (a late write may still land) ----

test('Auth call that never answers -> 500 "wait a minute", lease kept (no release), no accept', async () => {
  const cases = [
    { name: 'new user', found: [null], claim: claimRow(), create: never, expected: ['fn_claim_activation_link', 'fn_find_auth_user_by_email', 'create'] },
    { name: 'orphan', found: [{ user_id: ORPHAN_ID, has_profile: false }], claim: claimRow(), update: never,
      expected: ['fn_claim_activation_link', 'fn_find_auth_user_by_email', 'update'] },
    { name: 'reset', claim: claimRow('password_reset', EMAIL, PROFILE_ID), update: never, expected: ['fn_claim_activation_link', 'update'] },
  ];
  for (const item of cases) {
    const { deps, calls } = setup({
      found: item.found,
      rpc: { fn_claim_activation_link: ok(item.claim), fn_accept_invitation: ok({ purpose: 'invitation', email: EMAIL }) },
      create: item.create,
      update: item.update,
      deps: { authTimeoutMs: 20 },
    });
    const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
    assert.equal(res.status, 500, item.name);
    assert.equal(res.body.error.code, 'unknown');
    assert.equal(res.body.error.message, TIMEOUT_MESSAGE);
    assert.deepEqual(kinds(calls), item.expected, item.name);
  }
  assert.ok(logged.some(line => line.includes('auth_call_timeout step=create')));
  assert.ok(logged.some(line => line.includes('auth_call_timeout step=update')));
});

test('the Auth timeout is well below the 60 second lease', async () => {
  const { AUTH_CALL_TIMEOUT_MS } = await importTranspiled('supabase/functions/auth-links/handler.ts', 'auth-links-function');
  assert.equal(AUTH_CALL_TIMEOUT_MS, 20_000);
  assert.ok(AUTH_CALL_TIMEOUT_MS <= 30_000);
});

// ---- Rate limiting (database-backed, keys are HMACs) ----

test('rate limits: lookup counts per IP (20 / 10 min) and per token (10 / hour) with HMAC keys', async () => {
  const token = newToken();
  const { deps, limits } = setup({ rpc: { fn_get_activation_link: ok(linkInfo()) } });
  const res = await post(deps, '/invitations/lookup', { token });
  assert.equal(res.status, 200);
  const tokenHash = await hashToken(token);
  assert.deepEqual(limits, [
    { keyHash: await rateLimitKey(SECRET, 'lookup-ip', CLIENT_IP), limit: 20, windowSeconds: 600 },
    { keyHash: await rateLimitKey(SECRET, 'token', tokenHash), limit: 10, windowSeconds: 3600 },
  ]);
  for (const { keyHash } of limits) {
    assert.match(keyHash, /^[0-9a-f]{64}$/);
    assert.notEqual(keyHash, tokenHash);
  }
});

test('rate limits: activate counts per IP (10 / 10 min) before the claim', async () => {
  const { deps, limits, calls } = setup({
    found: [null],
    rpc: { fn_claim_activation_link: ok(claimRow()), fn_accept_invitation: ok({ purpose: 'invitation', email: EMAIL }) },
  });
  await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.deepEqual(limits.map(l => [l.limit, l.windowSeconds]), [[10, 600], [10, 3600]]);
  assert.equal(limits[0].keyHash, await rateLimitKey(SECRET, 'activate-ip', CLIENT_IP));
  assert.equal(calls[0].fn, 'fn_claim_activation_link');
});

test('rate limits: over the IP limit -> 429 rate_limited with Retry-After and no other work', async () => {
  const { deps, calls, limits } = setup({ limit: () => ok([{ allowed: false, retry_after_seconds: 120 }]) });
  for (const [path, body] of [['/invitations/lookup', { token: newToken() }], ['/activate', { token: newToken(), password: PASSWORD }]]) {
    const res = await post(deps, path, body);
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, 'rate_limited');
    assert.equal(res.body.error.message, 'Too many attempts. Please wait a few minutes and try again.');
    assert.equal(res.headers.get('Retry-After'), '120');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  }
  assert.equal(calls.length, 0);
  assert.equal(limits.length, 2, 'the token counter is not reached');
  assert.ok(logged.some(line => line.includes('rate_limited step=lookup-ip')));
  assert.ok(logged.some(line => line.includes('rate_limited step=activate-ip')));
});

test('rate limits: over the token limit -> 429 and no database work', async () => {
  const { deps, calls } = setup({
    limit: count => ok([{ allowed: count === 1, retry_after_seconds: 3000 }]),
  });
  const res = await post(deps, '/activate', { token: newToken(), password: PASSWORD });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '3000');
  assert.equal(calls.length, 0);
  assert.ok(logged.some(line => line.includes('rate_limited step=token')));
});

test('rate limits: counter failure -> 500 unknown (fail closed), no other work', async () => {
  for (const limit of [
    () => ({ data: null, error: { message: 'db down' } }),
    () => ok([]),
    () => { throw new Error('network'); },
  ]) {
    const { deps, calls } = setup({ limit });
    const res = await post(deps, '/invitations/lookup', { token: newToken() });
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'unknown');
    assert.equal(calls.length, 0);
  }
  assert.ok(logged.some(line => line.includes('rate_limit_failed step=lookup-ip')));
});

test('rate limits: malformed requests are rejected before the counter (no database call)', async () => {
  const { deps, limits } = setup();
  await post(deps, '/invitations/lookup', { token: 'short' });
  await post(deps, '/activate', { token: newToken(), password: 'short' });
  assert.equal(limits.length, 0);
});

test('client IP: cf-connecting-ip first, then the right-most X-Forwarded-For; a forged left-most value is ignored', async () => {
  const keyFor = async headers => {
    const { deps, limits } = setup({ rpc: { fn_get_activation_link: ok(linkInfo()) } });
    await post(deps, '/invitations/lookup', { token: newToken() }, { headers });
    return limits[0].keyHash;
  };
  const real = await rateLimitKey(SECRET, 'lookup-ip', CLIENT_IP);
  assert.equal(await keyFor({ 'cf-connecting-ip': CLIENT_IP, 'x-forwarded-for': '198.51.100.1' }), real);
  assert.equal(await keyFor({ 'x-forwarded-for': `198.51.100.1, ${CLIENT_IP}` }), real);
  assert.equal(await keyFor({ 'x-forwarded-for': `10.9.9.9, ${CLIENT_IP}` }), real);
  // No platform header -> one shared bucket, logged.
  assert.equal(await keyFor({}), await rateLimitKey(SECRET, 'lookup-ip', 'unknown'));
  assert.ok(logged.some(line => line.includes('client_ip_missing step=lookup')));
});

test('nothing secret is ever logged or returned', async () => {
  const hashes = await Promise.all(usedTokens.map(hashToken));
  const log = logged.join('\n');
  for (const secret of [...usedTokens, ...hashes, PASSWORD, SECRET, CLIENT_IP, CLAIM_ID]) {
    assert.equal(log.includes(secret), false, 'a secret value was logged');
  }
  const all = bodies.join('\n');
  for (const secret of [...usedTokens, ...hashes, PASSWORD, SECRET, 'token_hash']) {
    assert.equal(all.includes(secret), false, 'a secret value was returned');
  }
});
