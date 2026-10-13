import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importTs, importTranspiled } from './helpers/transpile.mjs';

const view = await importTs('src/pages/adminUsersView.ts', 'admin-users-view');
const { AdminUserError } = await importTranspiled('src/services/adminUserService.ts', 'admin-users-view');
const {
  STATUS_BADGES, ACTION_LABELS, countActiveAdmins, buildRowView, formatDateTime, confirmationFor, presentError,
  EXPIRY_OPTIONS, DEFAULT_EXPIRY_FORM, expiryFromForm, expiryDateBounds, validateInviteForm, linkResultView, LINK_NOTICE,
} = view;

const NOW = new Date(2026, 9, 8, 10, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const ME = 'me-id';
const row = over => ({
  kind: 'user', id: 'u1', email: 'u1@example.test', fullName: 'TEST - U1', role: 'Support', status: 'Active',
  createdAt: '2026-01-01T00:00:00.000Z', expiresAt: null, ...over,
});
const actions = r => r.actions.map(a => [a.action, a.disabledReason]);

test('status badges have a text label and a kind for every status', () => {
  assert.deepEqual(STATUS_BADGES, {
    'Active': { label: 'Active', kind: 'active' },
    'Disabled': { label: 'Disabled', kind: 'disabled' },
    'Pending Invite': { label: 'Pending Invite', kind: 'pending' },
    'Invite Expired': { label: 'Invite Expired', kind: 'expired' },
  });
  assert.equal(ACTION_LABELS.create_password_link, 'Create password link');
});

test('active Admin count ignores disabled admins and invitations', () => {
  assert.equal(countActiveAdmins([
    row({ id: 'a', role: 'Admin' }),
    row({ id: 'b', role: 'Admin', status: 'Disabled' }),
    row({ id: 'c', kind: 'invitation', role: 'Admin', status: 'Pending Invite' }),
    row({ id: 'd' }),
  ]), 1);
});

test('own Admin row: disable and role change are blocked with a reason', () => {
  const v = buildRowView(row({ id: ME, role: 'Admin' }), { currentUserId: ME, activeAdminCount: 2 });
  assert.deepEqual(actions(v), [
    ['disable_user', 'You cannot disable your own account.'],
    ['change_role', 'You cannot change your own role.'],
    ['create_password_link', null],
  ]);
  assert.equal(v.key, `user-${ME}`);
  assert.equal(v.expiresText, '—');
});

test('last active Admin (another user) is blocked with a reason', () => {
  const v = buildRowView(row({ role: 'Admin' }), { currentUserId: ME, activeAdminCount: 1 });
  assert.deepEqual(actions(v).slice(0, 2), [
    ['disable_user', 'This is the last active Admin.'],
    ['change_role', 'This is the last active Admin.'],
  ]);
});

test('actions per status', () => {
  const ctx = { currentUserId: ME, activeAdminCount: 2 };
  const pending = buildRowView(row({ kind: 'invitation', id: 'i1', status: 'Pending Invite', expiresAt: '2026-10-09T10:00:00.000Z' }), ctx);
  assert.deepEqual(actions(pending), [['resend_invitation', null], ['revoke_invitation', null]]);
  assert.equal(pending.key, 'invitation-i1');
  assert.equal(pending.expiresText, formatDateTime('2026-10-09T10:00:00.000Z'));
  assert.deepEqual(actions(buildRowView(row({ kind: 'invitation', status: 'Invite Expired', expiresAt: '2026-10-07T10:00:00.000Z' }), ctx)),
    [['resend_invitation', null]]);
  assert.deepEqual(actions(buildRowView(row({ status: 'Disabled' }), ctx)), [['enable_user', null]]);
  assert.deepEqual(actions(buildRowView(row(), ctx)),
    [['disable_user', null], ['change_role', null], ['create_password_link', null]]);
});

test('dates use the fixed English format of Guide dates, not the browser locale', () => {
  const iso = '2026-10-09T10:00:00.000Z';
  const expected = new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  assert.equal(formatDateTime(iso), expected);
  assert.match(formatDateTime(iso), /Oct 2026/);
});

test('confirmations: disable and revoke always; role change only when Admin is involved', () => {
  const r = row();
  assert.equal(confirmationFor('disable_user', r).confirmLabel, 'Disable user');
  assert.match(confirmationFor('disable_user', r).title, /TEST - U1/);
  assert.equal(confirmationFor('revoke_invitation', r).confirmLabel, 'Revoke invitation');
  assert.equal(confirmationFor('change_role', r, 'Viewer'), null);
  assert.equal(confirmationFor('change_role', r, 'Admin').body, 'This gives full admin rights.');
  assert.equal(confirmationFor('change_role', row({ role: 'Admin' }), 'Support').body, 'This removes full admin rights.');
  assert.equal(confirmationFor('enable_user', r), null);
  assert.equal(confirmationFor('resend_invitation', r), null);
});

test('errors: message and suggestion button', () => {
  assert.deepEqual(presentError(new AdminUserError('email_in_use', 'This email already has an account.', { action: 'create_password_link', userId: 'u9' })),
    { message: 'This email already has an account.', suggestion: { label: 'Create password link instead', action: 'create_password_link', targetId: 'u9' } });
  assert.deepEqual(presentError(new AdminUserError('email_in_use', undefined, { action: 'enable_user', userId: 'u8' })).suggestion,
    { label: 'Enable user', action: 'enable_user', targetId: 'u8' });
  assert.deepEqual(presentError(new AdminUserError('invitation_exists', undefined, { action: 'resend_invitation', invitationId: 'i7' })).suggestion,
    { label: 'Resend invitation', action: 'resend_invitation', targetId: 'i7' });
  assert.deepEqual(presentError(new AdminUserError('last_admin')), { message: 'The last active Admin cannot be disabled or demoted.', suggestion: null });
  assert.deepEqual(presentError(new Error('Plain failure.')), { message: 'Plain failure.', suggestion: null });
  assert.equal(presentError('weird').message, 'Something went wrong. Please try again.');
});

test('expiry form: default 24 hours, presets, custom date bounds and errors', () => {
  assert.deepEqual(EXPIRY_OPTIONS.map(o => o.label), ['24 hours', '3 days', '7 days', 'Pick a date']);
  assert.deepEqual(DEFAULT_EXPIRY_FORM, { preset: '24h', customDate: '' });
  assert.deepEqual(expiryFromForm(DEFAULT_EXPIRY_FORM, NOW), { expiresAt: new Date(NOW.getTime() + DAY).toISOString(), error: '' });
  assert.equal(expiryFromForm({ preset: '7d', customDate: '' }, NOW).expiresAt, new Date(NOW.getTime() + 7 * DAY).toISOString());
  assert.equal(expiryFromForm({ preset: 'custom', customDate: '2026-10-10' }, NOW).expiresAt, new Date(2026, 9, 10, 23, 59, 59, 999).toISOString());
  assert.deepEqual(expiryFromForm({ preset: 'custom', customDate: '' }, NOW), { expiresAt: null, error: 'Choose a date.' });
  assert.ok(expiryFromForm({ preset: 'custom', customDate: '2026-10-01' }, NOW).error);
  assert.deepEqual(expiryDateBounds(NOW), { min: '2026-10-08', max: '2026-10-15' });
});

test('invite form: field errors and normalized input', () => {
  const bad = validateInviteForm({ email: 'nope', fullName: ' ', role: 'Viewer', expiry: { preset: 'custom', customDate: '' } }, NOW);
  assert.equal(bad.input, null);
  assert.ok(bad.errors.email);
  assert.ok(bad.errors.fullName);
  assert.equal(bad.errors.role, '');
  assert.equal(bad.errors.expiry, 'Choose a date.');
  const ok = validateInviteForm({ email: ' New@Example.TEST ', fullName: ' TEST - New ', role: 'Viewer', expiry: DEFAULT_EXPIRY_FORM }, NOW);
  assert.deepEqual(ok.input, { email: 'new@example.test', fullName: 'TEST - New', role: 'Viewer', expiresAt: new Date(NOW.getTime() + DAY).toISOString() });
});

test('link result: manual link with notice, or "sent by email"', () => {
  const base = { invitationId: 'i1', purpose: 'invitation', email: 'new@example.test', expiresAt: '2026-10-09T10:00:00.000Z' };
  const manual = linkResultView({ ...base, delivery: 'manual', activationUrl: 'https://app.example.test/#/activate?token=t' });
  assert.equal(manual.mode, 'manual');
  assert.equal(manual.title, 'Invitation link');
  assert.equal(manual.url, 'https://app.example.test/#/activate?token=t');
  assert.equal(manual.notice, LINK_NOTICE);
  assert.equal(LINK_NOTICE, 'This link is shown only once. Send it to the user yourself.');
  assert.match(manual.expiresText, /^Valid until /);
  const email = linkResultView({ ...base, purpose: 'password_reset', delivery: 'email', activationUrl: null });
  assert.deepEqual([email.mode, email.title, email.url, email.notice], ['email', 'Password link', null, 'Sent by email to new@example.test.']);
});

test('UI files use only the service, never Supabase, the adapter, storage or console', () => {
  for (const file of ['src/pages/AdminUsers.tsx', 'src/pages/adminUsers/AdminDialogs.tsx', 'src/pages/ActivateAccount.tsx',
    'src/pages/adminUsersView.ts', 'src/pages/activateAccountState.ts', 'src/appAccess.ts']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const forbidden of [/supabase/i, /services\/admin\//, /localStorage/, /sessionStorage/, /\bconsole\./, /key=\{(i|index)\}/]) {
      assert.ok(!forbidden.test(source), `${file} must not contain ${forbidden}`);
    }
  }
});
