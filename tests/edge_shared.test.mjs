import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importTs, importTranspiled } from './helpers/transpile.mjs';

// Emit the whole shared tree once, then load each module from the same output (shared instances).
await importTs('supabase/functions/admin-users/handler.ts', 'edge-shared');
const tokens = await importTranspiled('supabase/functions/_shared/tokens.ts', 'edge-shared');
const errors = await importTranspiled('supabase/functions/_shared/errors.ts', 'edge-shared');
const http = await importTranspiled('supabase/functions/_shared/http.ts', 'edge-shared');
const mappers = await importTranspiled('supabase/functions/_shared/mappers.ts', 'edge-shared');
// env.ts is used only by the Deno entries, so it is not part of the handler tree.
const env = await importTs('supabase/functions/_shared/env.ts', 'edge-shared-env');
const edgeRules = await importTranspiled('supabase/functions/_shared/rules.ts', 'edge-shared');
const srcRules = await importTs('src/services/adminUserRules.ts', 'edge-shared-src-rules');

const ID = '11111111-2222-4333-8444-555555555555';

function captureConsole(fn) {
  const lines = [];
  const original = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    original[level] = console[level];
    console[level] = (...args) => lines.push(args.map(String).join(' '));
  }
  try {
    return { result: fn(), lines };
  } finally {
    Object.assign(console, original);
  }
}

test('generated token is 32 random bytes as base64url (43 chars)', () => {
  const a = tokens.generateToken();
  const b = tokens.generateToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a, 'base64url').length, 32);
  assert.equal(tokens.bytesToBase64Url(new Uint8Array([251, 255, 191])), '-_-_');
});

test('token hash is lower-case hex SHA-256 (known vector)', async () => {
  assert.equal(await tokens.hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.match(await tokens.hashToken(tokens.generateToken()), /^[0-9a-f]{64}$/);
});

test('incoming token is trimmed and must have the token format', () => {
  const token = tokens.generateToken();
  assert.equal(tokens.normalizeIncomingToken(`  ${token} `), token);
  assert.equal(tokens.normalizeIncomingToken(''), null);
  assert.equal(tokens.normalizeIncomingToken(undefined), null);
  assert.equal(tokens.normalizeIncomingToken(token.slice(1)), null);
  assert.equal(tokens.normalizeIncomingToken(`${token.slice(1)}+`), null);
  assert.equal(tokens.normalizeIncomingToken(`${token.slice(1)}=`), null);
});

test('password rules are identical to src/services/adminUserRules.ts', () => {
  const inputs = ['', ' ', '        ', '1234567', '12345678', 'a'.repeat(72), 'a'.repeat(73),
    'ğ'.repeat(36), 'ğ'.repeat(37), ' abc def ', 'correct horse battery staple'];
  for (const input of inputs) {
    assert.equal(edgeRules.validatePassword(input), srcRules.validatePassword(input), JSON.stringify(input));
  }
  assert.deepEqual([...edgeRules.ROLES], [...srcRules.ROLES]);
});

test('every error code maps to its HTTP status', () => {
  const expected = {
    invalid_input: 400, token_invalid: 400, unauthenticated: 401, forbidden: 403, not_found: 404,
    email_in_use: 409, invitation_exists: 409, invalid_status: 409, last_admin: 409, self_action: 409,
    token_expired: 410, token_used: 410, token_revoked: 410,
  };
  for (const [code, status] of Object.entries(expected)) {
    const mapped = errors.mapRpcError({ code: 'P0001', message: code, details: `Detail for ${code}.`, hint: null }, 'fn_x');
    assert.equal(mapped.code, code);
    assert.equal(mapped.status, status);
    assert.equal(mapped.message, `Detail for ${code}.`);
  }
  assert.equal(errors.mapRpcError({ code: 'P0001', message: 'forbidden', details: null }, 'fn_x').message, errors.DEFAULT_MESSAGES.forbidden);
});

test('HINT becomes a checked suggestion', () => {
  const hint = JSON.stringify({ action: 'create_password_link', userId: ID });
  assert.deepEqual(errors.mapRpcError({ code: 'P0001', message: 'email_in_use', hint }, 'fn_x').suggestion,
    { action: 'create_password_link', userId: ID });
  assert.deepEqual(errors.parseSuggestion(JSON.stringify({ action: 'resend_invitation', invitationId: ID })),
    { action: 'resend_invitation', invitationId: ID });
  assert.equal(errors.parseSuggestion('not json'), null);
  assert.equal(errors.parseSuggestion(JSON.stringify({ action: 'delete_user', userId: ID })), null);
  assert.equal(errors.parseSuggestion(JSON.stringify({ action: 'enable_user', userId: 'x' })), null);
});

test('JWT errors -> unauthenticated; other errors -> unknown 500 with a safe log', () => {
  assert.equal(errors.mapRpcError({ code: 'PGRST301', message: 'JWT expired' }, 'fn_x').code, 'unauthenticated');
  assert.equal(errors.mapRpcError({ code: null, message: 'x', status: 401 }, 'fn_x').code, 'unauthenticated');
  const { result, lines } = captureConsole(() =>
    errors.mapRpcError({ code: '23505', message: 'duplicate key value violates "secret detail"', details: 'Key (email)=(a@b.c)' }, 'fn_admin_x'));
  assert.equal(result.code, 'unknown');
  assert.equal(result.status, 500);
  assert.equal(result.message, errors.DEFAULT_MESSAGES.unknown);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /rpc=fn_admin_x sqlstate=23505/);
  assert.doesNotMatch(lines[0], /a@b\.c|secret|duplicate/);
  // 'unknown' sent by the database is not trusted as a known code.
  assert.equal(captureConsole(() => errors.mapRpcError({ code: 'P0001', message: 'not_a_code' }, 'fn_x')).result.code, 'unknown');
});

test('mappers return exactly the contract keys in camelCase', () => {
  const user = { id: ID, email: 'a@example.test', full_name: 'A', role: 'Admin', status: 'Active', created_at: '2026-01-01T00:00:00+00:00', extra: 1 };
  assert.deepEqual(Object.keys(mappers.toAdminUser(user)).sort(), ['createdAt', 'email', 'fullName', 'id', 'role', 'status']);
  const invitation = {
    id: ID, purpose: 'invitation', email: 'b@example.test', full_name: 'B', role: 'Viewer', user_id: null, status: 'Expired',
    expires_at: '2026-10-09T00:00:00+00:00', accepted_at: null, revoked_at: null, invited_by: ID, created_at: '2026-10-08T00:00:00+00:00',
    token_hash: 'f'.repeat(64),
  };
  const mapped = mappers.toInvitation(invitation);
  assert.deepEqual(Object.keys(mapped).sort(),
    ['acceptedAt', 'createdAt', 'email', 'expiresAt', 'fullName', 'id', 'invitedBy', 'purpose', 'revokedAt', 'role', 'status', 'userId']);
  assert.equal(JSON.stringify(mappers.toUserList({ users: [user], invitations: [invitation] })).includes('token_hash'), false);
  assert.deepEqual(mappers.toIssuedLink({ invitation_id: ID, purpose: 'invitation', email: 'b@example.test', expires_at: 'X' }, 'tok'),
    { invitationId: ID, purpose: 'invitation', email: 'b@example.test', expiresAt: 'X', delivery: 'manual', token: 'tok' });
  assert.deepEqual(mappers.toActivationResult({ purpose: 'password_reset', email: 'c@example.test', user_id: ID }),
    { purpose: 'password_reset', email: 'c@example.test' });
  assert.throws(() => mappers.toAdminUser(null), err => err.code === 'unknown');
});

test('CORS: allowed origin echoed, others and unconfigured lists rejected, never *', () => {
  const allowed = ['https://app.example.test'];
  const req = origin => new Request('https://x.test/functions/v1/admin-users/users', { headers: origin ? { Origin: origin } : {} });

  const ok = http.evaluateCors(req('https://app.example.test'), allowed);
  assert.equal(ok.ok, true);
  assert.equal(ok.headers['Access-Control-Allow-Origin'], 'https://app.example.test');
  assert.equal(ok.headers.Vary, 'Origin');
  assert.equal('Access-Control-Allow-Credentials' in ok.headers, false);

  const other = captureConsole(() => http.evaluateCors(req('https://evil.example.test'), allowed));
  assert.equal(other.result.ok, false);
  assert.match(other.lines[0], /cors_origin_rejected/);

  for (const list of [[], env.parseAllowedOriginsEnv(undefined), env.parseAllowedOriginsEnv('  '), env.parseAllowedOriginsEnv('*')]) {
    const closed = captureConsole(() => http.evaluateCors(req('https://app.example.test'), list));
    assert.equal(closed.result.ok, false);
    assert.match(closed.lines[0], /cors_not_configured/);
  }

  const serverToServer = http.evaluateCors(req(null), []);
  assert.deepEqual(serverToServer, { ok: true, headers: {} });
  assert.deepEqual(env.parseAllowedOriginsEnv(' https://a.test/ , http://localhost:5173 ,'), ['https://a.test', 'http://localhost:5173']);
});

test('routing helpers: function prefix, 404, 405 with Allow', () => {
  assert.equal(http.routePath(new URL('https://x.test/functions/v1/admin-users/users/'), 'admin-users'), '/users');
  assert.equal(http.routePath(new URL('https://x.test/admin-users/invitations/abc/resend'), 'admin-users'), '/invitations/abc/resend');
  const routes = [{ pattern: /^\/users$/, methods: { GET: 'list' } }];
  assert.deepEqual(http.matchRoute(routes, 'GET', '/users'), { action: 'list', params: [] });
  assert.throws(() => http.matchRoute(routes, 'GET', '/nope'), err => err.code === 'not_found' && err.status === 404);
  assert.throws(() => http.matchRoute(routes, 'POST', '/users'),
    err => err.code === 'invalid_input' && err.status === 405 && err.headers.Allow === 'GET, OPTIONS');
});

test('JSON body: object only, size limit, empty -> {}', async () => {
  const body = text => new Request('https://x.test/', { method: 'POST', body: text });
  assert.deepEqual(await http.readJsonBody(body('{"a":1}')), { a: 1 });
  assert.deepEqual(await http.readJsonBody(body('')), {});
  await assert.rejects(http.readJsonBody(body('{bad')), err => err.code === 'invalid_input');
  await assert.rejects(http.readJsonBody(body('[1]')), err => err.code === 'invalid_input');
  await assert.rejects(http.readJsonBody(body(`"${'x'.repeat(17000)}"`)), err => err.code === 'invalid_input');
});

test('resolveSupabaseKeys: new keys first, legacy fallback, missing', () => {
  const newKeys = { SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_A"}', SUPABASE_SECRET_KEYS: '{"default":"sb_secret_B"}' };
  assert.deepEqual(env.resolveSupabaseKeys(newKeys), { publishableKey: 'sb_publishable_A', secretKey: 'sb_secret_B', source: 'new' });

  assert.deepEqual(env.resolveSupabaseKeys({
    SUPABASE_PUBLISHABLE_KEYS: '{"default":"P1","web":"P2"}', SUPABASE_SECRET_KEYS: '{"default":"S1","edge":"S2"}',
    SUPABASE_PUBLISHABLE_KEY_NAME: 'web', SUPABASE_SECRET_KEY_NAME: 'edge',
  }), { publishableKey: 'P2', secretKey: 'S2', source: 'new' });

  const legacy = { SUPABASE_ANON_KEY: 'legacy-anon', SUPABASE_SERVICE_ROLE_KEY: 'legacy-service' };
  assert.deepEqual(env.resolveSupabaseKeys(legacy), { publishableKey: 'legacy-anon', secretKey: 'legacy-service', source: 'legacy' });
  assert.deepEqual(env.resolveSupabaseKeys({ ...legacy, SUPABASE_PUBLISHABLE_KEYS: '{bad json', SUPABASE_SECRET_KEYS: '["x"]' }),
    { publishableKey: 'legacy-anon', secretKey: 'legacy-service', source: 'legacy' });
  assert.deepEqual(env.resolveSupabaseKeys({ ...legacy, SUPABASE_SECRET_KEYS: '{"other":"S"}' }).secretKey, 'legacy-service');
  assert.deepEqual(env.resolveSupabaseKeys({ ...legacy, SUPABASE_SECRET_KEYS: '{"default":"S"}' }),
    { publishableKey: 'legacy-anon', secretKey: 'S', source: 'mixed' });
  assert.deepEqual(env.resolveSupabaseKeys({}), { publishableKey: null, secretKey: null, source: 'none' });
  assert.deepEqual(env.resolveSupabaseKeys({ SUPABASE_SECRET_KEYS: '{bad', SUPABASE_ANON_KEY: '  ' }),
    { publishableKey: null, secretKey: null, source: 'none' });

  const { lines } = captureConsole(() => env.resolveSupabaseKeys({ ...newKeys, SUPABASE_SECRET_KEYS: '{bad' }));
  assert.equal(lines.length, 0, 'key parsing never logs');
});
