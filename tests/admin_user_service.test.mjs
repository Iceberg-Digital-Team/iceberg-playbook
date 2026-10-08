import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { importTs } from './helpers/transpile.mjs';

const service = await importTs('src/services/adminUserService.ts', 'admin-user-service');
const {
  configureAdminUserService, AdminUserError, isAdminUserError, ADMIN_ERROR_MESSAGES,
  listUsers, inviteUser, changeUserRole, disableUser, enableUser, resendInvitation,
  revokeInvitation, getInvitation, activateAccount, createPasswordResetLink,
} = service;

const NOW = new Date('2026-10-08T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const inOneDay = new Date(NOW.getTime() + DAY).toISOString();
const BASE = 'https://app.example.test/';

const adminUser = { id: 'u1', email: 'ada@example.test', fullName: 'Ada', role: 'Admin', status: 'Active', createdAt: '2026-01-01T00:00:00.000Z' };
const issued = (over = {}) => ({
  invitationId: 'inv-1', purpose: 'invitation', email: 'new@example.test', expiresAt: inOneDay,
  delivery: 'manual', token: 'raw-token_123', ...over,
});

function fakeAdapter(over = {}) {
  const calls = [];
  const record = (name, result) => async (...args) => {
    calls.push([name, ...args]);
    return typeof result === 'function' ? result(...args) : result;
  };
  const adapter = {
    listUsers: record('listUsers', {
      users: [adminUser],
      invitations: [{
        id: 'inv-old', purpose: 'invitation', email: 'old@example.test', fullName: 'Old', role: 'Viewer', userId: null,
        status: 'Pending', expiresAt: '2026-10-07T00:00:00.000Z', acceptedAt: null, revokedAt: null, invitedBy: 'u1', createdAt: '2026-10-01T00:00:00.000Z',
      }],
    }),
    createInvitation: record('createInvitation', issued()),
    resendInvitation: record('resendInvitation', issued({ token: 'new-token' })),
    revokeInvitation: record('revokeInvitation', undefined),
    changeUserRole: record('changeUserRole', (id, role) => ({ ...adminUser, id, role })),
    disableUser: record('disableUser', id => ({ ...adminUser, id, status: 'Disabled' })),
    enableUser: record('enableUser', id => ({ ...adminUser, id, status: 'Active' })),
    createPasswordResetLink: record('createPasswordResetLink', issued({ purpose: 'password_reset', token: 'reset-token' })),
    getInvitation: record('getInvitation', { purpose: 'invitation', status: 'Pending', email: 'new@example.test', fullName: 'New', role: 'Viewer', expiresAt: inOneDay }),
    activateAccount: record('activateAccount', { purpose: 'invitation', email: 'new@example.test', password: 'leak', token: 'leak' }),
    ...over,
  };
  return { adapter, calls };
}

function setup(over) {
  const fake = fakeAdapter(over);
  configureAdminUserService(fake.adapter, { activationBaseUrl: BASE, now: () => NOW });
  return fake;
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, err => {
    assert.ok(err instanceof AdminUserError, `expected AdminUserError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

beforeEach(() => configureAdminUserService(null));

test('every operation fails with not_configured when no adapter is set', async () => {
  const ops = [
    () => listUsers(),
    () => inviteUser({ email: 'a@b.co', fullName: 'A', role: 'Viewer', expiresAt: inOneDay }),
    () => changeUserRole('u1', 'Viewer'),
    () => disableUser('u1'),
    () => enableUser('u1'),
    () => resendInvitation('i1', inOneDay),
    () => revokeInvitation('i1'),
    () => getInvitation('tok'),
    () => activateAccount({ token: 'tok', password: 'long enough' }),
    () => createPasswordResetLink('u1', inOneDay),
  ];
  assert.equal(ops.length, 10);
  for (const op of ops) await rejectsWith(op(), 'not_configured');
});

test('configureAdminUserService(null) resets the adapter', async () => {
  setup();
  await listUsers();
  configureAdminUserService(null);
  await rejectsWith(listUsers(), 'not_configured');
});

test('listUsers builds rows with effective statuses', async () => {
  setup();
  const rows = await listUsers();
  assert.deepEqual(rows.map(r => [r.kind, r.id, r.status]), [
    ['user', 'u1', 'Active'],
    ['invitation', 'inv-old', 'Invite Expired'],
  ]);
});

test('inviteUser normalizes input and returns a copyable link without the raw token', async () => {
  const { calls } = setup();
  const link = await inviteUser({ email: '  New@Example.TEST ', fullName: ' New Person ', role: 'Viewer', expiresAt: inOneDay });
  assert.deepEqual(calls, [['createInvitation', { email: 'new@example.test', fullName: 'New Person', role: 'Viewer', expiresAt: inOneDay }]]);
  assert.deepEqual(link, {
    invitationId: 'inv-1', purpose: 'invitation', email: 'new@example.test', expiresAt: inOneDay,
    delivery: 'manual', activationUrl: 'https://app.example.test/#/activate?token=raw-token_123',
  });
  assert.equal('token' in link, false);
});

test('inviteUser rejects invalid input or expiry without calling the adapter', async () => {
  const { calls } = setup();
  await rejectsWith(inviteUser({ email: 'bad', fullName: 'X', role: 'Viewer', expiresAt: inOneDay }), 'invalid_input');
  await rejectsWith(inviteUser({ email: 'a@b.co', fullName: '  ', role: 'Viewer', expiresAt: inOneDay }), 'invalid_input');
  await rejectsWith(inviteUser({ email: 'a@b.co', fullName: 'X', role: 'Owner', expiresAt: inOneDay }), 'invalid_input');
  await rejectsWith(inviteUser({ email: 'a@b.co', fullName: 'X', role: 'Viewer', expiresAt: NOW.toISOString() }), 'invalid_input');
  await rejectsWith(inviteUser({ email: 'a@b.co', fullName: 'X', role: 'Viewer', expiresAt: new Date(NOW.getTime() + 8 * DAY).toISOString() }), 'invalid_input');
  assert.equal(calls.length, 0);
});

test('resendInvitation and createPasswordResetLink return new links', async () => {
  const { calls } = setup();
  const resent = await resendInvitation(' inv-1 ', inOneDay);
  assert.equal(resent.activationUrl, 'https://app.example.test/#/activate?token=new-token');
  const reset = await createPasswordResetLink('u2', inOneDay);
  assert.equal(reset.purpose, 'password_reset');
  assert.equal(reset.activationUrl, 'https://app.example.test/#/activate?token=reset-token');
  assert.deepEqual(calls, [['resendInvitation', 'inv-1', inOneDay], ['createPasswordResetLink', 'u2', inOneDay]]);
  await rejectsWith(createPasswordResetLink('u2', 'never'), 'invalid_input');
  await rejectsWith(resendInvitation('', inOneDay), 'invalid_input');
});

test('email delivery returns no link; manual delivery without token is an error', async () => {
  setup({ createInvitation: async () => issued({ delivery: 'email', token: null }) });
  const link = await inviteUser({ email: 'a@b.co', fullName: 'A', role: 'Viewer', expiresAt: inOneDay });
  assert.equal(link.delivery, 'email');
  assert.equal(link.activationUrl, null);

  setup({ createInvitation: async () => issued({ token: '  ' }) });
  await rejectsWith(inviteUser({ email: 'a@b.co', fullName: 'A', role: 'Viewer', expiresAt: inOneDay }), 'unknown');
  setup({ createInvitation: async () => issued({ token: null }) });
  await rejectsWith(inviteUser({ email: 'a@b.co', fullName: 'A', role: 'Viewer', expiresAt: inOneDay }), 'unknown');
});

test('adapter domain errors pass through unchanged', async () => {
  const conflict = new AdminUserError('email_in_use', undefined, { action: 'create_password_link', userId: 'u9' });
  setup({
    createInvitation: async () => { throw conflict; },
    disableUser: async () => { throw new AdminUserError('last_admin'); },
  });
  await assert.rejects(inviteUser({ email: 'a@b.co', fullName: 'A', role: 'Viewer', expiresAt: inOneDay }), err => err === conflict);
  assert.deepEqual(conflict.suggestion, { action: 'create_password_link', userId: 'u9' });
  await rejectsWith(disableUser('u2'), 'last_admin');
});

test('user status and role operations validate ids and roles', async () => {
  const { calls } = setup();
  assert.equal((await disableUser('u2')).status, 'Disabled');
  assert.equal((await enableUser('u2')).status, 'Active');
  assert.equal((await changeUserRole('u2', 'Viewer')).role, 'Viewer');
  await revokeInvitation('inv-1');
  await rejectsWith(changeUserRole('u2', 'Owner'), 'invalid_input');
  await rejectsWith(changeUserRole(' ', 'Viewer'), 'invalid_input');
  await rejectsWith(disableUser(''), 'invalid_input');
  await rejectsWith(enableUser(''), 'invalid_input');
  await rejectsWith(revokeInvitation(''), 'invalid_input');
  assert.deepEqual(calls.map(c => c[0]), ['disableUser', 'enableUser', 'changeUserRole', 'revokeInvitation']);
});

test('getInvitation trims the token and rejects an empty one locally', async () => {
  const { calls } = setup();
  await rejectsWith(getInvitation(''), 'token_invalid');
  await rejectsWith(getInvitation('   '), 'token_invalid');
  assert.equal(calls.length, 0);
  const info = await getInvitation('  tok  ');
  assert.deepEqual(calls, [['getInvitation', 'tok']]);
  assert.deepEqual(Object.keys(info).sort(), ['email', 'expiresAt', 'fullName', 'purpose', 'role', 'status']);
});

test('getInvitation returns only the contract fields', async () => {
  setup({
    getInvitation: async () => ({
      id: 'inv-1', userId: 'u9', token: 'raw', invitedBy: 'u1',
      purpose: 'password_reset', status: 'Pending', email: 'ada@example.test', fullName: 'Ada', role: 'Support', expiresAt: inOneDay,
    }),
  });
  assert.deepEqual(await getInvitation('tok'), {
    purpose: 'password_reset', status: 'Pending', email: 'ada@example.test', fullName: 'Ada', role: 'Support', expiresAt: inOneDay,
  });
});

test('activateAccount validates the password and returns no secrets', async () => {
  const { calls } = setup();
  await rejectsWith(activateAccount({ token: 'tok', password: 'short' }), 'invalid_input');
  await rejectsWith(activateAccount({ token: ' ', password: 'long enough' }), 'token_invalid');
  assert.equal(calls.length, 0);
  const result = await activateAccount({ token: ' tok ', password: 'long enough' });
  assert.deepEqual(result, { purpose: 'invitation', email: 'new@example.test' });
  assert.deepEqual(calls, [['activateAccount', { token: 'tok', password: 'long enough' }]]);
});

test('AdminUserError has a code, default message and optional suggestion', () => {
  const err = new AdminUserError('forbidden');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'AdminUserError');
  assert.equal(err.message, ADMIN_ERROR_MESSAGES.forbidden);
  assert.equal(err.suggestion, null);
  assert.equal(new AdminUserError('unknown', 'Custom text').message, 'Custom text');
  assert.equal(isAdminUserError(err), true);
  assert.equal(isAdminUserError(new Error('x')), false);
  for (const [code, message] of Object.entries(ADMIN_ERROR_MESSAGES)) {
    assert.ok(message.length > 0, `${code} has a message`);
  }
  assert.equal(Object.keys(ADMIN_ERROR_MESSAGES).length, 16);
});
