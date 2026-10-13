import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
// Migration 10 is the team lead's 10_restore_playbook.sql; ours are 11 and 12.
const m11 = read('supabase/migrations/11_user_management.sql');
const m12 = read('supabase/migrations/12_user_invitation_security.sql');
const sqlTests = read('supabase/tests/user_management_tests.sql');
const migrations = `${m11}\n${m12}`;

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every function created in migrations 11/12: name, header (before the body) and full text.
function functions() {
  const list = [];
  const re = /CREATE OR REPLACE FUNCTION\s+public\.(\w+)\s*\(/g;
  for (const match of migrations.matchAll(re)) {
    const start = match.index;
    const bodyStart = migrations.indexOf('AS $$', start);
    assert.ok(bodyStart > start, `function ${match[1]} has an AS $$ body`);
    list.push({ name: match[1], header: migrations.slice(start, bodyStart) });
  }
  return list;
}

function invitationColumns() {
  const block = /CREATE TABLE IF NOT EXISTS public\.user_invitations \(([\s\S]*?)\n\);/.exec(m11);
  assert.ok(block, 'user_invitations table definition found');
  return block[1]
    .split('\n')
    .map(line => line.replace(/--.*$/, '').trim())
    .filter(Boolean)
    .map(line => line.split(/\s+/)[0]);
}

test('both migrations use the PROPOSED header', () => {
  for (const sql of [m11, m12]) {
    assert.match(sql, /ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS/);
    assert.match(sql, /Mode: PROPOSED/);
  }
});

test('user_invitations has RLS enabled and no direct access for API roles', () => {
  assert.match(m12, /ALTER TABLE public\.user_invitations ENABLE ROW LEVEL SECURITY;/);
  assert.match(m12, /REVOKE ALL ON TABLE public\.user_invitations FROM PUBLIC, anon, authenticated;/);
  assert.doesNotMatch(migrations, /CREATE POLICY[^;]*ON public\.user_invitations/);
  assert.doesNotMatch(migrations, /GRANT[^;]*DELETE[^;]*ON TABLE public\.user_invitations/);
});

test('only a token hash is stored, never a plaintext token column', () => {
  const columns = invitationColumns();
  assert.ok(columns.includes('token_hash'));
  for (const name of ['token', 'raw_token', 'plain_token', 'plaintext_token']) {
    assert.ok(!columns.includes(name), `user_invitations must not have a "${name}" column`);
  }
  assert.doesNotMatch(migrations, /(^|[\s,(])(raw_token|plain_token|token)\s+(TEXT|VARCHAR|CHAR|UUID|BYTEA)\b/im);
  assert.match(m11, /CHECK \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
});

test('every new function is locked down and documented', () => {
  const list = functions();
  assert.ok(list.length >= 15, `expected the full function list, found ${list.length}`);
  for (const { name, header } of list) {
    assert.match(header, /SET search_path = ''/, `${name} sets search_path = ''`);
    if (/RETURNS TRIGGER/.test(header)) {
      assert.match(header, /SECURITY INVOKER/, `${name} (trigger) is SECURITY INVOKER`);
    } else {
      assert.match(header, /SECURITY DEFINER/, `${name} is SECURITY DEFINER`);
    }
    const fn = `public\\.${escape(name)}\\([^)]*\\)`;
    assert.match(migrations, new RegExp(`REVOKE EXECUTE ON FUNCTION ${fn} FROM PUBLIC, anon`), `${name} revokes EXECUTE from PUBLIC, anon`);
    assert.match(migrations, new RegExp(`COMMENT ON FUNCTION ${fn} IS`), `${name} has a COMMENT ON FUNCTION`);
  }
});

test('link holder functions are server-only and admin functions are not for anon', () => {
  for (const name of ['fn_get_activation_link', 'fn_accept_invitation', 'fn_accept_password_reset']) {
    assert.match(m12, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
    assert.match(m12, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO service_role;`));
  }
  for (const { name } of functions().filter(f => f.name.startsWith('fn_admin_'))) {
    assert.match(m12, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO authenticated;`), `${name} granted to authenticated only`);
  }
});

test('no hard delete, drop or truncate in the migrations', () => {
  assert.doesNotMatch(migrations, /DELETE\s+FROM\s+public\.(profiles|user_invitations)\b/i);
  assert.doesNotMatch(migrations, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(migrations, /\bTRUNCATE\b/i);
  assert.match(m12, /DROP POLICY IF EXISTS "profiles_delete_admin_only" ON public\.profiles;/);
  assert.match(m12, /REVOKE DELETE ON TABLE public\.profiles FROM anon, authenticated;/);
  assert.match(m12, /BEFORE DELETE ON public\.user_invitations/);
});

test('every column, constraint, index and trigger has a COMMENT ON', () => {
  for (const column of invitationColumns()) {
    assert.match(m11, new RegExp(`COMMENT ON COLUMN public\\.user_invitations\\.${column} IS`), `column ${column} is commented`);
  }
  assert.match(m11, /COMMENT ON COLUMN public\.profiles\.status IS/);
  assert.match(m11, /COMMENT ON TABLE public\.user_invitations IS/);
  for (const [, name] of migrations.matchAll(/ADD CONSTRAINT (\w+)/g)) {
    assert.match(migrations, new RegExp(`COMMENT ON CONSTRAINT ${name} ON`), `constraint ${name} is commented`);
  }
  for (const [, name] of migrations.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/g)) {
    assert.match(migrations, new RegExp(`COMMENT ON INDEX public\\.${name} IS`), `index ${name} is commented`);
  }
  for (const [, name] of migrations.matchAll(/CREATE TRIGGER (\w+)/g)) {
    assert.match(migrations, new RegExp(`COMMENT ON TRIGGER ${name} ON`), `trigger ${name} is commented`);
  }
});

test('error codes raised by the migrations are contract AdminUserErrorCodes', () => {
  const allowed = new Set([
    'unauthenticated', 'forbidden', 'not_found', 'invalid_input', 'invalid_status', 'email_in_use',
    'invitation_exists', 'last_admin', 'self_action', 'token_invalid', 'token_expired', 'token_used', 'token_revoked',
    'link_busy',
  ]);
  const codes = [...m12.matchAll(/MESSAGE = '(\w+)'/g)].map(m => m[1]);
  assert.ok(codes.length > 0);
  for (const code of codes) assert.ok(allowed.has(code), `unknown error code "${code}"`);
});

test('direct profile insert is closed (profiles are created only by fn_accept_invitation)', () => {
  assert.match(m12, /DROP POLICY IF EXISTS "profiles_insert_admin_only" ON public\.profiles;/);
  assert.match(m12, /REVOKE INSERT ON TABLE public\.profiles FROM anon, authenticated;/);
  assert.doesNotMatch(migrations, /CREATE POLICY[^;]*ON public\.profiles/);
  assert.doesNotMatch(migrations, /GRANT[^;]*INSERT[^;]*ON TABLE public\.profiles/);
});

test('activation lease: columns, constraint, 60 second lease, server-only functions', () => {
  const columns = invitationColumns();
  assert.ok(columns.includes('claim_id') && columns.includes('claimed_until'));
  assert.match(m11, /ADD CONSTRAINT chk_user_invitations_claim/);
  assert.match(m11, /\(claim_id IS NULL\) = \(claimed_until IS NULL\)/);
  assert.match(m11, /claim_id IS NULL OR status = 'Pending'/);
  assert.match(m12, /claimed_until = NOW\(\) \+ INTERVAL '60 seconds'/);
  for (const name of ['fn_claim_activation_link', 'fn_release_activation_link', 'fn_rate_limit_hit']) {
    assert.match(m12, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
    assert.match(m12, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO service_role;`));
  }
  // Accept functions take the lease id, never the token hash.
  assert.match(m12, /FUNCTION public\.fn_accept_invitation\(p_claim_id UUID, p_auth_user_id UUID\)/);
  assert.match(m12, /FUNCTION public\.fn_accept_password_reset\(p_claim_id UUID\)/);
  // Every UPDATE that ends a link (Accepted / Revoked) also ends its lease.
  for (const [statement] of m12.matchAll(/UPDATE public\.user_invitations\s+SET status = '(?:Accepted|Revoked)'[^;]*;/g)) {
    assert.match(statement, /claim_id = NULL, claimed_until = NULL/, statement);
  }
});

test('rate limit table stores only hashes and is closed to API roles', () => {
  assert.match(m12, /ALTER TABLE public\.auth_link_rate_limits ENABLE ROW LEVEL SECURITY;/);
  assert.match(m12, /REVOKE ALL ON TABLE public\.auth_link_rate_limits FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(m12, /CHECK \(key_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.doesNotMatch(m12, /CREATE POLICY[^;]*ON public\.auth_link_rate_limits/);
  assert.match(m12, /ON CONFLICT \(key_hash\) DO UPDATE/);
  for (const column of ['key_hash', 'window_started_at', 'hits']) {
    assert.match(m12, new RegExp(`COMMENT ON COLUMN public\\.auth_link_rate_limits\\.${column} IS`));
  }
});

test('fn_admin_current_caller is for authenticated callers only', () => {
  assert.match(m12, /REVOKE EXECUTE ON FUNCTION public\.fn_admin_current_caller\(\) FROM PUBLIC, anon, service_role;/);
  assert.match(m12, /GRANT EXECUTE ON FUNCTION public\.fn_admin_current_caller\(\) TO authenticated;/);
});

test('the SQL test suite runs inside BEGIN ... ROLLBACK', () => {
  const statements = sqlTests
    .split('\n')
    .filter(line => !/^\s*--/.test(line) && line.trim() !== '');
  assert.equal(statements[0].trim(), 'BEGIN;');
  assert.equal(statements[statements.length - 1].trim(), 'ROLLBACK;');
  assert.doesNotMatch(sqlTests, /\bCOMMIT\b/i);
});
