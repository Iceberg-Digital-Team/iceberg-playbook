import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { importTs, importTranspiled } from './helpers/transpile.mjs';

// The default adapter instance uses src/lib/supabase.ts: dummy config, never contacted.
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dummy.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key-for-unit-tests';

const logged = [];
const originalConsole = {};
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  originalConsole[level] = console[level];
  console[level] = (...args) => logged.push(args.map(String).join(' '));
}
after(() => Object.assign(console, originalConsole));

const adapterModule = await importTs('src/services/admin/supabaseAdminUserAdapter.ts', 'supabase-admin-adapter');
const service = await importTranspiled('src/services/adminUserService.ts', 'supabase-admin-adapter');
const { createSupabaseAdminUserAdapter, supabaseAdminUserAdapter, ADMIN_USERS_FUNCTION, AUTH_LINKS_FUNCTION } = adapterModule;
const { AdminUserError, configureAdminUserService, inviteUser } = service;

const USER_ID = '11111111-2222-4333-8444-555555555555';
const INV_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const EXPIRES = '2026-10-09T10:00:00.000Z';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const PASSWORD = 'correct horse battery';
const NOW = new Date('2026-10-08T10:00:00.000Z');

const adminUser = { id: USER_ID, email: 'user@example.test', fullName: 'TEST - User', role: 'Support', status: 'Active', createdAt: '2026-01-01T00:00:00+00:00' };
const invitation = {
  id: INV_ID, purpose: 'invitation', email: 'new@example.test', fullName: 'TEST - New', role: 'Viewer', userId: null,
  status: 'Pending', expiresAt: EXPIRES, acceptedAt: null, revokedAt: null, invitedBy: USER_ID, createdAt: '2026-10-08T09:00:00+00:00',
};
const issued = { invitationId: INV_ID, purpose: 'invitation', email: 'new@example.test', expiresAt: EXPIRES, delivery: 'manual', token: TOKEN };
const linkInfo = { purpose: 'invitation', status: 'Pending', email: 'new@example.test', fullName: 'TEST - New', role: 'Viewer', expiresAt: EXPIRES };

function fakeClient({ session = { access_token: 'session.jwt' }, sessionError = null, results = {} } = {}) {
  const calls = [];
  let sessionChecks = 0;
  const client = {
    auth: {
      async getSession() {
        sessionChecks += 1;
        return { data: { session }, error: sessionError };
      },
    },
    functions: {
      async invoke(name, options) {
        calls.push({ name, options });
        const result = results[name];
        if (typeof result === 'function') return result();
        return result ?? { data: null, error: null };
      },
    },
  };
  return { client, calls, sessionChecks: () => sessionChecks };
}

const ok = data => ({ data, error: null });
const httpError = (status, body) => ({
  data: null,
  error: new FunctionsHttpError(new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })),
});

async function rejectsWith(promise, code) {
  await assert.rejects(promise, err => {
    assert.ok(err instanceof AdminUserError, `expected AdminUserError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

test('function names are the two Edge Functions of task C', () => {
  assert.equal(ADMIN_USERS_FUNCTION, 'admin-users');
  assert.equal(AUTH_LINKS_FUNCTION, 'auth-links');
  assert.equal(typeof supabaseAdminUserAdapter.listUsers, 'function');
});

test('every operation calls the right function path, method and body', async () => {
  const { client, calls } = fakeClient({
    results: {
      'admin-users/users': ok({ users: [adminUser], invitations: [invitation] }),
      'admin-users/invitations': ok(issued),
      [`admin-users/invitations/${INV_ID}/resend`]: ok(issued),
      [`admin-users/invitations/${INV_ID}`]: ok(''),
      [`admin-users/users/${USER_ID}/role`]: ok({ ...adminUser, role: 'Viewer' }),
      [`admin-users/users/${USER_ID}/disable`]: ok({ ...adminUser, status: 'Disabled' }),
      [`admin-users/users/${USER_ID}/enable`]: ok(adminUser),
      [`admin-users/users/${USER_ID}/password-links`]: ok({ ...issued, purpose: 'password_reset' }),
      'auth-links/invitations/lookup': ok(linkInfo),
      'auth-links/activate': ok({ purpose: 'invitation', email: 'new@example.test' }),
    },
  });
  const adapter = createSupabaseAdminUserAdapter(client);

  await adapter.listUsers();
  await adapter.createInvitation({ email: 'new@example.test', fullName: 'TEST - New', role: 'Viewer', expiresAt: EXPIRES });
  await adapter.resendInvitation(INV_ID, EXPIRES);
  await adapter.revokeInvitation(INV_ID);
  await adapter.changeUserRole(USER_ID, 'Viewer');
  await adapter.disableUser(USER_ID);
  await adapter.enableUser(USER_ID);
  await adapter.createPasswordResetLink(USER_ID, EXPIRES);
  await adapter.getInvitation(TOKEN);
  await adapter.activateAccount({ token: TOKEN, password: PASSWORD });

  assert.deepEqual(calls, [
    { name: 'admin-users/users', options: { method: 'GET' } },
    { name: 'admin-users/invitations', options: { method: 'POST', body: { email: 'new@example.test', fullName: 'TEST - New', role: 'Viewer', expiresAt: EXPIRES } } },
    { name: `admin-users/invitations/${INV_ID}/resend`, options: { method: 'POST', body: { expiresAt: EXPIRES } } },
    { name: `admin-users/invitations/${INV_ID}`, options: { method: 'DELETE' } },
    { name: `admin-users/users/${USER_ID}/role`, options: { method: 'PATCH', body: { role: 'Viewer' } } },
    { name: `admin-users/users/${USER_ID}/disable`, options: { method: 'POST' } },
    { name: `admin-users/users/${USER_ID}/enable`, options: { method: 'POST' } },
    { name: `admin-users/users/${USER_ID}/password-links`, options: { method: 'POST', body: { expiresAt: EXPIRES } } },
    { name: 'auth-links/invitations/lookup', options: { method: 'POST', body: { token: TOKEN } } },
    { name: 'auth-links/activate', options: { method: 'POST', body: { token: TOKEN, password: PASSWORD } } },
  ]);
  assert.ok(calls.every(call => !call.name.includes(TOKEN)), 'the token is never in a path');
});

test('ids are encoded in the path', async () => {
  const { client, calls } = fakeClient();
  await createSupabaseAdminUserAdapter(client).revokeInvitation('a/b c');
  assert.equal(calls[0].name, 'admin-users/invitations/a%2Fb%20c');
});

test('admin call without a session -> unauthenticated, no invoke', async () => {
  for (const options of [{ session: null }, { session: { access_token: '' } }, { session: null, sessionError: new Error('refresh failed') }]) {
    const { client, calls } = fakeClient(options);
    await rejectsWith(createSupabaseAdminUserAdapter(client).listUsers(), 'unauthenticated');
    assert.equal(calls.length, 0);
  }
  const throwing = fakeClient();
  throwing.client.auth.getSession = async () => { throw new Error('storage'); };
  await rejectsWith(createSupabaseAdminUserAdapter(throwing.client).disableUser(USER_ID), 'unauthenticated');
  assert.equal(throwing.calls.length, 0);
});

test('auth-links calls work without a session and never check it', async () => {
  const fake = fakeClient({
    session: null,
    results: {
      'auth-links/invitations/lookup': ok(linkInfo),
      'auth-links/activate': ok({ purpose: 'password_reset', email: 'user@example.test' }),
    },
  });
  const adapter = createSupabaseAdminUserAdapter(fake.client);
  assert.deepEqual(await adapter.getInvitation(TOKEN), linkInfo);
  assert.deepEqual(await adapter.activateAccount({ token: TOKEN, password: PASSWORD }), { purpose: 'password_reset', email: 'user@example.test' });
  assert.equal(fake.sessionChecks(), 0);
});

test('Edge Function error bodies pass through with code, message and suggestion', async () => {
  const codes = ['unauthenticated', 'forbidden', 'not_found', 'invalid_input', 'invalid_status', 'email_in_use',
    'invitation_exists', 'last_admin', 'self_action', 'token_invalid', 'token_expired', 'token_used', 'token_revoked', 'unknown',
    'rate_limited', 'link_busy'];
  for (const code of codes) {
    const { client } = fakeClient({ results: { 'admin-users/users': httpError(409, { error: { code, message: `Message ${code}.`, suggestion: null } }) } });
    await assert.rejects(createSupabaseAdminUserAdapter(client).listUsers(), err => {
      assert.ok(err instanceof AdminUserError);
      assert.equal(err.code, code);
      assert.equal(err.message, `Message ${code}.`);
      assert.equal(err.suggestion, null);
      return true;
    });
  }

  const suggestions = [
    { action: 'create_password_link', userId: USER_ID },
    { action: 'enable_user', userId: USER_ID },
    { action: 'resend_invitation', invitationId: INV_ID },
  ];
  for (const suggestion of suggestions) {
    const { client } = fakeClient({
      results: { 'admin-users/invitations': httpError(409, { error: { code: 'email_in_use', message: '', suggestion: { ...suggestion, extra: 1 } } }) },
    });
    await assert.rejects(createSupabaseAdminUserAdapter(client).createInvitation({ email: 'a@example.test', fullName: 'A', role: 'Viewer', expiresAt: EXPIRES }), err => {
      assert.equal(err.code, 'email_in_use');
      assert.equal(err.message, service.ADMIN_ERROR_MESSAGES.email_in_use, 'empty message -> contract default');
      assert.deepEqual(err.suggestion, suggestion);
      return true;
    });
  }

  const { client } = fakeClient({
    results: { 'admin-users/users': httpError(409, { error: { code: 'email_in_use', message: 'x', suggestion: { action: 'delete_user', userId: USER_ID } } }) },
  });
  await assert.rejects(createSupabaseAdminUserAdapter(client).listUsers(), err => err.code === 'email_in_use' && err.suggestion === null);
});

test('unknown codes, bad bodies, relay and network errors are mapped', async () => {
  const cases = [
    [httpError(400, { error: { code: 'teapot', message: 'x' } }), 'unknown'],
    [httpError(401, { code: 401, message: 'Invalid JWT' }), 'unauthenticated'],
    [httpError(500, 'not json'), 'unknown'],
    [httpError(502, { message: 'bad gateway' }), 'unknown'],
    [{ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) }, 'network'],
    [{ data: null, error: new FunctionsRelayError(new Response('', { status: 502 })) }, 'unknown'],
    [{ data: null, error: new SyntaxError('Unexpected token') }, 'unknown'],
    [() => { throw new Error('boom'); }, 'network'],
  ];
  for (const [result, code] of cases) {
    const { client } = fakeClient({ results: { 'admin-users/users': result } });
    await rejectsWith(createSupabaseAdminUserAdapter(client).listUsers(), code);
  }
});

test('response guards: wrong shapes -> unknown', async () => {
  const bad = [
    ['admin-users/users', a => a.listUsers(), { users: [adminUser] }],
    ['admin-users/users', a => a.listUsers(), { users: [{ ...adminUser, role: 'Owner' }], invitations: [] }],
    ['admin-users/users', a => a.listUsers(), { users: [], invitations: [{ ...invitation, status: 'Open' }] }],
    ['admin-users/invitations', a => a.createInvitation({ email: 'a@example.test', fullName: 'A', role: 'Viewer', expiresAt: EXPIRES }), { ...issued, delivery: 'sms' }],
    [`admin-users/users/${USER_ID}/disable`, a => a.disableUser(USER_ID), { ...adminUser, status: 'Gone' }],
    [`admin-users/users/${USER_ID}/enable`, a => a.enableUser(USER_ID), 'ok'],
    ['auth-links/invitations/lookup', a => a.getInvitation(TOKEN), { ...linkInfo, status: 'Expired' }],
    ['auth-links/activate', a => a.activateAccount({ token: TOKEN, password: PASSWORD }), { purpose: 'invitation' }],
    ['auth-links/activate', a => a.activateAccount({ token: TOKEN, password: PASSWORD }), null],
  ];
  for (const [name, run, data] of bad) {
    const { client } = fakeClient({ results: { [name]: ok(data) } });
    await rejectsWith(run(createSupabaseAdminUserAdapter(client)), 'unknown');
  }
});

test('response guards keep only contract fields', async () => {
  const { client } = fakeClient({
    results: {
      'admin-users/users': ok({ users: [{ ...adminUser, password: 'x' }], invitations: [{ ...invitation, tokenHash: 'f'.repeat(64) }], extra: true }),
      'auth-links/activate': ok({ purpose: 'password_reset', email: 'user@example.test', userId: USER_ID }),
      'auth-links/invitations/lookup': ok({ ...linkInfo, id: INV_ID }),
    },
  });
  const adapter = createSupabaseAdminUserAdapter(client);
  const list = await adapter.listUsers();
  assert.deepEqual(list, { users: [adminUser], invitations: [invitation] });
  assert.deepEqual(await adapter.activateAccount({ token: TOKEN, password: PASSWORD }), { purpose: 'password_reset', email: 'user@example.test' });
  assert.deepEqual(await adapter.getInvitation(TOKEN), linkInfo);
});

test('end to end with the real service: activation URL carries only the token', async () => {
  const { client, calls } = fakeClient({ results: { 'admin-users/invitations': ok(issued) } });
  configureAdminUserService(createSupabaseAdminUserAdapter(client), { activationBaseUrl: 'https://app.example.test/', now: () => NOW });
  try {
    const link = await inviteUser({ email: ' New@Example.test ', fullName: ' TEST - New ', role: 'Viewer', expiresAt: EXPIRES });
    assert.equal(link.activationUrl, `https://app.example.test/#/activate?token=${TOKEN}`);
    assert.equal('token' in link, false);
    assert.deepEqual(calls[0].options.body, { email: 'new@example.test', fullName: 'TEST - New', role: 'Viewer', expiresAt: EXPIRES });
  } finally {
    configureAdminUserService(null);
  }
});

test('no token, password or session JWT is ever logged', () => {
  const log = logged.join('\n');
  for (const secret of [TOKEN, PASSWORD, 'session.jwt']) {
    assert.equal(log.includes(secret), false, 'a secret value was logged');
  }
});
