import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importTs, importTranspiled } from './helpers/transpile.mjs';

const state = await importTs('src/pages/activateAccountState.ts', 'activate-account-state');
const { AdminUserError } = await importTranspiled('src/services/adminUserService.ts', 'activate-account-state');
const { initialView, viewFromInfo, viewFromLookupError, viewFromSubmitError, viewFromResult, DEAD_LINK_HELP } = state;

const info = purpose => ({ purpose, status: 'Pending', email: 'new@example.test', fullName: 'TEST - New', role: 'Viewer', expiresAt: '2026-10-09T10:00:00.000Z' });

test('missing token -> invalid link (no lookup needed); token -> loading', () => {
  assert.deepEqual(initialView(null), { kind: 'invalid', message: 'This link is not valid.', help: DEAD_LINK_HELP });
  assert.equal(DEAD_LINK_HELP, 'Ask your Admin for a new link.');
  assert.deepEqual(initialView('abc'), { kind: 'loading' });
});

test('form texts depend on the link purpose', () => {
  const invite = viewFromInfo(info('invitation'));
  assert.deepEqual(invite, {
    kind: 'form', purpose: 'invitation', heading: 'Activate your account', intro: 'Set your password to activate your account.',
    email: 'new@example.test', fullName: 'TEST - New', role: 'Viewer', error: '',
  });
  const reset = viewFromInfo(info('password_reset'));
  assert.equal(reset.heading, 'Reset your password');
  assert.equal(reset.intro, 'Choose a new password.');
});

test('dead link codes -> dead state with help; other errors -> retryable error', () => {
  for (const code of ['token_invalid', 'token_expired', 'token_used', 'token_revoked']) {
    const v = viewFromLookupError(new AdminUserError(code));
    assert.equal(v.kind, 'dead');
    assert.equal(v.message, new AdminUserError(code).message);
    assert.equal(v.help, DEAD_LINK_HELP);
  }
  assert.deepEqual(viewFromLookupError(new AdminUserError('network')),
    { kind: 'error', message: 'Could not reach the server. Check your connection and try again.' });
  assert.deepEqual(viewFromLookupError('x'), { kind: 'error', message: 'Something went wrong. Please try again.' });
});

test('submit errors: dead link -> dead state; others stay on the form with a message', () => {
  const form = viewFromInfo(info('invitation'));
  assert.equal(viewFromSubmitError(form, new AdminUserError('token_used')).kind, 'dead');
  const stay = viewFromSubmitError(form, new AdminUserError('invalid_input', 'Password must be at least 8 characters.'));
  assert.equal(stay.kind, 'form');
  assert.equal(stay.error, 'Password must be at least 8 characters.');
  assert.equal(stay.email, form.email);
});

test('link_busy and rate_limited keep the link usable: form stays / lookup can be retried', () => {
  const form = viewFromInfo(info('password_reset'));
  for (const code of ['link_busy', 'rate_limited']) {
    const stay = viewFromSubmitError(form, new AdminUserError(code));
    assert.equal(stay.kind, 'form', code);
    assert.equal(stay.error, new AdminUserError(code).message);
  }
  assert.deepEqual(viewFromLookupError(new AdminUserError('rate_limited')),
    { kind: 'error', message: 'Too many attempts. Please wait a few minutes and try again.' });
  // A password rejected by the Supabase policy: the form stays so the user can choose another one.
  const weak = viewFromSubmitError(form, new AdminUserError('invalid_input', 'This password does not meet the password policy. Choose a stronger password.'));
  assert.equal(weak.kind, 'form');
});

test('success -> done with the sign-in text', () => {
  assert.deepEqual(viewFromResult({ purpose: 'invitation', email: 'new@example.test' }), {
    kind: 'done', message: 'Your password is set. Sign in with your email and new password.', email: 'new@example.test',
  });
});
