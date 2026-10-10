import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const m13 = read('supabase/migrations/13_auth_user_lookup.sql');
const sqlTests = read('supabase/tests/auth_user_lookup_tests.sql');
const SIGNATURE = /public\.fn_find_auth_user_by_email\(TEXT\)/;

test('migration 13 uses the PROPOSED header', () => {
  assert.match(m13, /ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS/);
  assert.match(m13, /Migration 13:/);
  assert.match(m13, /Mode: PROPOSED/);
});

test('fn_find_auth_user_by_email is locked down to the server role', () => {
  const header = m13.slice(m13.indexOf('CREATE OR REPLACE FUNCTION public.fn_find_auth_user_by_email'), m13.indexOf('AS $$'));
  assert.match(header, /SECURITY DEFINER/);
  assert.match(header, /SET search_path = ''/);
  assert.match(header, /RETURNS TABLE \(user_id UUID, has_profile BOOLEAN\)/);
  assert.match(m13, new RegExp(`REVOKE EXECUTE ON FUNCTION ${SIGNATURE.source} FROM PUBLIC, anon, authenticated;`));
  assert.match(m13, new RegExp(`GRANT EXECUTE ON FUNCTION ${SIGNATURE.source} TO service_role;`));
  assert.match(m13, new RegExp(`COMMENT ON FUNCTION ${SIGNATURE.source} IS`));
  assert.doesNotMatch(m13, /GRANT[^;]*TO[^;]*\b(anon|authenticated)\b/);
});

test('email is compared with lower(btrim()) on both sides and not returned', () => {
  assert.match(m13, /lower\(btrim\(u\.email\)\) = lower\(btrim\(p_email\)\)/);
  const body = m13.slice(m13.indexOf('AS $$'), m13.lastIndexOf('$$;'));
  const selectList = body.slice(body.indexOf('SELECT'), body.indexOf('FROM auth.users'));
  assert.doesNotMatch(selectList, /email/);
});

test('migration 13 has no delete, drop or truncate', () => {
  assert.doesNotMatch(m13, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(m13, /\bDROP\s+(TABLE|FUNCTION)\b/i);
  assert.doesNotMatch(m13, /\bTRUNCATE\b/i);
});

test('the lookup SQL tests run inside BEGIN ... ROLLBACK', () => {
  const statements = sqlTests.split('\n').filter(line => !/^\s*--/.test(line) && line.trim() !== '');
  assert.equal(statements[0].trim(), 'BEGIN;');
  assert.equal(statements[statements.length - 1].trim(), 'ROLLBACK;');
  assert.doesNotMatch(sqlTests, /\bCOMMIT\b/i);
});
