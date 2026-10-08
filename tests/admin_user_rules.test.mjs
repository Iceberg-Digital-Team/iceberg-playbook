import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importTs } from './helpers/transpile.mjs';

const rules = await importTs('src/services/adminUserRules.ts', 'admin-user-rules');
const {
  ROLES, isRole, getEffectiveInvitationStatus, buildUserListRows, tokenErrorForStatus,
  ADMIN_ACTIONS, ALLOWED_ACTIONS, isActionAllowed, checkAdminAction, getRowActions, findInviteConflict,
  resolveExpiry, customDateBounds, validateExpiresAt, DEFAULT_EXPIRY_PRESET, MAX_EXPIRY_MS, EXPIRY_CLOCK_TOLERANCE_MS,
  normalizeEmail, validateInviteInput, validatePassword, validatePasswordForm,
  buildActivationUrl, readActivationToken,
} = rules;

const NOW = new Date('2026-10-08T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = ms => new Date(NOW.getTime() + ms).toISOString();

const user = (over = {}) => ({
  id: 'u1', email: 'ada@example.test', fullName: 'Ada', role: 'Support', status: 'Active',
  createdAt: '2026-01-01T00:00:00.000Z', ...over,
});
const invitation = (over = {}) => ({
  id: 'i1', purpose: 'invitation', email: 'new@example.test', fullName: 'New Person', role: 'Viewer',
  userId: null, status: 'Pending', expiresAt: iso(DAY), acceptedAt: null, revokedAt: null,
  invitedBy: 'u1', createdAt: '2026-10-08T09:00:00.000Z', ...over,
});
const row = (over = {}) => ({
  kind: 'user', id: 'u2', email: 'b@example.test', fullName: 'B', role: 'Support', status: 'Active',
  createdAt: '2026-01-01T00:00:00.000Z', expiresAt: null, ...over,
});
const ctx = { currentUserId: 'me', activeAdminCount: 2 };

test('roles reuse the auth Role values', () => {
  assert.deepEqual([...ROLES], ['Admin', 'Support', 'Viewer']);
  assert.equal(isRole('Admin'), true);
  assert.equal(isRole('admin'), false);
  assert.equal(isRole(undefined), false);
});

test('effective invitation status treats an expired Pending link as Expired', () => {
  assert.equal(getEffectiveInvitationStatus({ status: 'Pending', expiresAt: iso(HOUR) }, NOW), 'Pending');
  assert.equal(getEffectiveInvitationStatus({ status: 'Pending', expiresAt: NOW.toISOString() }, NOW), 'Expired');
  assert.equal(getEffectiveInvitationStatus({ status: 'Pending', expiresAt: iso(-HOUR) }, NOW), 'Expired');
  assert.equal(getEffectiveInvitationStatus({ status: 'Pending', expiresAt: 'not a date' }, NOW), 'Expired');
});

test('Accepted and Revoked invitations are final even after expiry', () => {
  assert.equal(getEffectiveInvitationStatus({ status: 'Accepted', expiresAt: iso(-DAY) }, NOW), 'Accepted');
  assert.equal(getEffectiveInvitationStatus({ status: 'Revoked', expiresAt: iso(-DAY) }, NOW), 'Revoked');
  assert.equal(getEffectiveInvitationStatus({ status: 'Revoked', expiresAt: iso(DAY) }, NOW), 'Revoked');
});

test('user list rows combine users with open invitations only', () => {
  const rows = buildUserListRows(
    [user({ id: 'u1', fullName: 'Zed', status: 'Active' }), user({ id: 'u2', email: 'c@example.test', fullName: 'Cem', status: 'Disabled' })],
    [
      invitation({ id: 'p', fullName: 'Pia', status: 'Pending' }),
      invitation({ id: 'e', fullName: 'Eve', expiresAt: iso(-HOUR) }),
      invitation({ id: 'a', fullName: 'Acc', status: 'Accepted' }),
      invitation({ id: 'r', fullName: 'Rev', status: 'Revoked' }),
      invitation({ id: 'pw', fullName: 'Reset', purpose: 'password_reset', userId: 'u1' }),
    ],
    NOW,
  );
  assert.deepEqual(rows.map(r => [r.kind, r.id, r.status]), [
    ['user', 'u2', 'Disabled'],
    ['invitation', 'e', 'Invite Expired'],
    ['invitation', 'p', 'Pending Invite'],
    ['user', 'u1', 'Active'],
  ]);
  assert.equal(rows[0].expiresAt, null);
  assert.equal(rows[2].expiresAt, iso(DAY));
});

test('user list rows with the same name are sorted by email', () => {
  const rows = buildUserListRows([user({ id: 'x', email: 'b@example.test' }), user({ id: 'y', email: 'a@example.test' })], [], NOW);
  assert.deepEqual(rows.map(r => r.id), ['y', 'x']);
});

test('allowed-actions table covers all 24 status x action combinations', () => {
  const expected = {
    'Active': { resend_invitation: false, revoke_invitation: false, disable_user: true, enable_user: false, change_role: true, create_password_link: true },
    'Disabled': { resend_invitation: false, revoke_invitation: false, disable_user: false, enable_user: true, change_role: false, create_password_link: false },
    'Pending Invite': { resend_invitation: true, revoke_invitation: true, disable_user: false, enable_user: false, change_role: false, create_password_link: false },
    'Invite Expired': { resend_invitation: true, revoke_invitation: false, disable_user: false, enable_user: false, change_role: false, create_password_link: false },
  };
  assert.deepEqual(Object.keys(ALLOWED_ACTIONS).sort(), Object.keys(expected).sort());
  assert.equal(ADMIN_ACTIONS.length, 6);
  let checked = 0;
  for (const [status, actions] of Object.entries(expected)) {
    assert.deepEqual(Object.keys(actions).sort(), [...ADMIN_ACTIONS].sort());
    for (const [action, allowed] of Object.entries(actions)) {
      assert.equal(isActionAllowed(status, action), allowed, `${status} / ${action}`);
      checked += 1;
    }
  }
  assert.equal(checked, 24);
});

test('admin cannot disable themselves or change their own role', () => {
  const self = row({ id: 'me', role: 'Admin' });
  assert.equal(checkAdminAction(self, 'disable_user', ctx), 'self_action');
  assert.equal(checkAdminAction(self, 'change_role', ctx, 'Support'), 'self_action');
  assert.equal(checkAdminAction(self, 'create_password_link', ctx), null);
});

test('the last active Admin cannot be disabled or demoted', () => {
  const lastAdmin = row({ id: 'other', role: 'Admin' });
  const one = { currentUserId: 'me', activeAdminCount: 1 };
  assert.equal(checkAdminAction(lastAdmin, 'disable_user', one), 'last_admin');
  assert.equal(checkAdminAction(lastAdmin, 'change_role', one, 'Viewer'), 'last_admin');
  assert.equal(checkAdminAction(lastAdmin, 'change_role', one), 'last_admin');
  assert.equal(checkAdminAction(lastAdmin, 'change_role', one, 'Admin'), 'invalid_input');
  assert.equal(checkAdminAction(lastAdmin, 'disable_user', ctx), null);
  assert.equal(checkAdminAction(lastAdmin, 'change_role', ctx, 'Viewer'), null);
});

test('promoting to Admin is allowed when there is only one Admin', () => {
  const one = { currentUserId: 'me', activeAdminCount: 1 };
  assert.equal(checkAdminAction(row({ role: 'Support' }), 'change_role', one, 'Admin'), null);
  assert.equal(checkAdminAction(row({ role: 'Support' }), 'disable_user', one), null);
});

test('changing to the same role is invalid input', () => {
  assert.equal(checkAdminAction(row({ role: 'Viewer' }), 'change_role', ctx, 'Viewer'), 'invalid_input');
});

test('actions outside the table are blocked with invalid_status', () => {
  assert.equal(checkAdminAction(row({ status: 'Disabled' }), 'disable_user', ctx), 'invalid_status');
  assert.equal(checkAdminAction(row({ kind: 'invitation', id: 'i', status: 'Invite Expired' }), 'revoke_invitation', ctx), 'invalid_status');
  assert.equal(checkAdminAction(row({ kind: 'invitation', id: 'i', status: 'Pending Invite' }), 'revoke_invitation', ctx), null);
});

test('getRowActions lists each allowed action with its blocker', () => {
  assert.deepEqual(getRowActions(row({ id: 'me', role: 'Admin' }), ctx), [
    { action: 'disable_user', blockedBy: 'self_action' },
    { action: 'change_role', blockedBy: 'self_action' },
    { action: 'create_password_link', blockedBy: null },
  ]);
  assert.deepEqual(getRowActions(row({ status: 'Disabled' }), ctx), [{ action: 'enable_user', blockedBy: null }]);
});

test('token error codes per invitation status', () => {
  assert.equal(tokenErrorForStatus('Pending'), null);
  assert.equal(tokenErrorForStatus('Expired'), 'token_expired');
  assert.equal(tokenErrorForStatus('Accepted'), 'token_used');
  assert.equal(tokenErrorForStatus('Revoked'), 'token_revoked');
});

test('invite conflict with an existing user suggests by user status', () => {
  const users = [user({ id: 'act', email: 'act@example.test' }), user({ id: 'dis', email: 'dis@example.test', status: 'Disabled' })];
  assert.deepEqual(findInviteConflict(' ACT@Example.test ', users, [], NOW), {
    code: 'email_in_use', suggestion: { action: 'create_password_link', userId: 'act' },
  });
  assert.deepEqual(findInviteConflict('dis@example.test', users, [], NOW), {
    code: 'email_in_use', suggestion: { action: 'enable_user', userId: 'dis' },
  });
});

test('invite conflict with an open invitation suggests resend', () => {
  assert.deepEqual(findInviteConflict('NEW@example.test', [], [invitation({ id: 'p' })], NOW), {
    code: 'invitation_exists', suggestion: { action: 'resend_invitation', invitationId: 'p' },
  });
  assert.equal(findInviteConflict('new@example.test', [], [invitation({ id: 'e', expiresAt: iso(-HOUR) })], NOW).code, 'invitation_exists');
  assert.equal(findInviteConflict('new@example.test', [], [invitation({ status: 'Revoked' }), invitation({ status: 'Accepted' })], NOW), null);
  assert.equal(findInviteConflict('new@example.test', [], [invitation({ purpose: 'password_reset' })], NOW), null);
  assert.equal(findInviteConflict('other@example.test', [user()], [invitation()], NOW), null);
});

test('expiry presets add exact time and default is 24 hours', () => {
  assert.equal(DEFAULT_EXPIRY_PRESET, '24h');
  assert.equal(MAX_EXPIRY_MS, 7 * DAY);
  assert.equal(resolveExpiry({ preset: '24h' }, NOW), iso(DAY));
  assert.equal(resolveExpiry({ preset: '3d' }, NOW), iso(3 * DAY));
  assert.equal(resolveExpiry({ preset: '7d' }, NOW), iso(7 * DAY));
});

test('custom expiry date means end of that local day, capped at 7 days', () => {
  const now = new Date(2026, 9, 8, 10, 0, 0);
  assert.equal(resolveExpiry({ preset: 'custom', date: '2026-10-10' }, now), new Date(2026, 9, 10, 23, 59, 59, 999).toISOString());
  assert.equal(resolveExpiry({ preset: 'custom', date: '2026-10-08' }, now), new Date(2026, 9, 8, 23, 59, 59, 999).toISOString());
  assert.equal(resolveExpiry({ preset: 'custom', date: '2026-10-15' }, now), new Date(now.getTime() + 7 * DAY).toISOString());
  assert.equal(resolveExpiry({ preset: 'custom', date: '2026-10-07' }, now), null);
  assert.equal(resolveExpiry({ preset: 'custom', date: '2026-02-30' }, now), null);
  assert.equal(resolveExpiry({ preset: 'custom', date: '10/10/2026' }, now), null);
  assert.equal(resolveExpiry({ preset: 'custom', date: '' }, now), null);
});

test('custom date bounds run from today to 7 days ahead', () => {
  assert.deepEqual(customDateBounds(new Date(2026, 9, 8, 10, 0, 0)), { min: '2026-10-08', max: '2026-10-15' });
  assert.deepEqual(customDateBounds(new Date(2026, 11, 28, 9, 0, 0)), { min: '2026-12-28', max: '2027-01-04' });
});

test('validateExpiresAt requires a future date within 7 days', () => {
  assert.equal(validateExpiresAt(iso(DAY), NOW), '');
  assert.equal(validateExpiresAt(iso(7 * DAY), NOW), '');
  assert.equal(validateExpiresAt(iso(7 * DAY + EXPIRY_CLOCK_TOLERANCE_MS), NOW), '');
  assert.ok(validateExpiresAt(iso(7 * DAY + EXPIRY_CLOCK_TOLERANCE_MS + 1), NOW));
  assert.ok(validateExpiresAt(iso(8 * DAY), NOW));
  assert.ok(validateExpiresAt(NOW.toISOString(), NOW));
  assert.ok(validateExpiresAt(iso(-HOUR), NOW));
  assert.ok(validateExpiresAt('tomorrow', NOW));
  assert.ok(validateExpiresAt('', NOW));
});

test('invite input is trimmed, lowercased and validated', () => {
  const ok = validateInviteInput({ email: '  New.Person@Example.TEST ', fullName: '  New Person ', role: 'Viewer' });
  assert.deepEqual(ok.value, { email: 'new.person@example.test', fullName: 'New Person', role: 'Viewer' });
  assert.deepEqual(ok.errors, { email: '', fullName: '', role: '' });
  assert.equal(normalizeEmail(' A@B.Co '), 'a@b.co');

  const bad = validateInviteInput({ email: 'not-an-email', fullName: '   ', role: 'Owner' });
  assert.equal(bad.value, null);
  assert.ok(bad.errors.email);
  assert.ok(bad.errors.fullName);
  assert.ok(bad.errors.role);

  assert.ok(validateInviteInput({ email: '', fullName: 'X', role: 'Admin' }).errors.email);
  assert.ok(validateInviteInput({ email: `${'a'.repeat(250)}@b.co`, fullName: 'X', role: 'Admin' }).errors.email);
  assert.ok(validateInviteInput({ email: 'a@b.co', fullName: 'x'.repeat(101), role: 'Admin' }).errors.fullName);
  assert.equal(validateInviteInput({ email: 'a@b.co', fullName: 'x'.repeat(100), role: 'Admin' }).errors.fullName, '');
});

test('password needs 8 characters and at most 72 bytes', () => {
  assert.ok(validatePassword(''));
  assert.ok(validatePassword('1234567'));
  assert.equal(validatePassword('12345678'), '');
  assert.equal(validatePassword('a'.repeat(72)), '');
  assert.ok(validatePassword('a'.repeat(73)));
  assert.ok(validatePassword('ğ'.repeat(37)), '74 bytes in UTF-8');
  assert.equal(validatePassword('ğ'.repeat(36)), '');
  assert.ok(validatePassword('          '));
  assert.equal(validatePassword(' abc def '), '', 'password is not trimmed');
});

test('password form checks the confirmation', () => {
  assert.deepEqual(validatePasswordForm('correct horse', 'correct horse'), { password: '', confirm: '' });
  assert.ok(validatePasswordForm('correct horse', 'correct horse ').confirm);
  assert.ok(validatePasswordForm('correct horse', '').confirm);
  assert.ok(validatePasswordForm('short', 'short').password);
});

test('activation URL carries only the encoded token', () => {
  assert.equal(buildActivationUrl('https://app.example.test/', 'abc_DEF-123'), 'https://app.example.test/#/activate?token=abc_DEF-123');
  assert.equal(buildActivationUrl('https://app.example.test/playbook/#/admin/users', 'tok'), 'https://app.example.test/playbook/#/activate?token=tok');
  assert.equal(buildActivationUrl('http://localhost:5173', ' tok '), 'http://localhost:5173#/activate?token=tok');

  const tricky = 'a+b/c=d&e f?#%';
  const url = buildActivationUrl('https://app.example.test/', tricky);
  const [, hash] = url.split('#');
  assert.ok(hash.startsWith('/activate?'));
  const params = new URLSearchParams(hash.split('?')[1]);
  assert.deepEqual([...params.keys()], ['token']);
  assert.equal(params.get('token'), tricky);
  assert.ok(!url.includes('@'));
});

test('activation URL needs a token and a base URL (plain Error)', () => {
  assert.throws(() => buildActivationUrl('https://app.example.test/', ''), err => err instanceof Error && err.name === 'Error');
  assert.throws(() => buildActivationUrl('https://app.example.test/', '   '), Error);
  assert.throws(() => buildActivationUrl('', 'tok'), Error);
});

test('activation token is read from route params and trimmed', () => {
  assert.equal(readActivationToken({ token: ' abc ' }), 'abc');
  assert.equal(readActivationToken({ token: '' }), null);
  assert.equal(readActivationToken({ token: '   ' }), null);
  assert.equal(readActivationToken({}), null);
});
