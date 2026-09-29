import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const js = ts.transpileModule(readFileSync(new URL('../src/auth/auth.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 }
}).outputText;
const authModule = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const { validateSignIn, getAuthActor } = authModule;

test('empty or malformed sign-in fields give useful errors', () => {
  assert.ok(validateSignIn('', '').email);
  assert.ok(validateSignIn('', '').password);
  assert.ok(validateSignIn('not-an-email', 'test').email);
  assert.deepEqual(validateSignIn(' test@example.test ', 'test'), { email: '', password: '' });
});

test('getAuthActor resolves actor identity cleanly from session', () => {
  const session = {
    user: { id: 'usr-123', email: 'tester@example.test' },
    profile: { user_id: 'usr-123', full_name: 'Test Agent', role: 'Support', department: 'Support Team', avatar_url: null }
  };
  assert.deepEqual(getAuthActor(session), { userId: 'usr-123', name: 'Test Agent' });

  const sessionNoProfile = {
    user: { id: 'usr-456', email: 'fallback@example.test' },
    profile: null
  };
  assert.deepEqual(getAuthActor(sessionNoProfile), { userId: 'usr-456', name: 'fallback@example.test' });
});

test('legacy mockAuthAdapter has been completely removed', () => {
  assert.equal(typeof authModule.mockAuthAdapter, 'undefined', 'mockAuthAdapter must be removed');
});
