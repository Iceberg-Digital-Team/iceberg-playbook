import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const m12 = read('supabase/migrations/12_auth_user_lookup.sql');
const sqlTests = read('supabase/tests/auth_user_lookup_tests.sql');
const SIGNATURE = /public\.fn_find_auth_user_by_email\(TEXT\)/;

test('migration 12 uses the PROPOSED header', () => {
  assert.match(m12, /ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS/);
  assert.match(m12, /Migration 12:/);
  assert.match(m12, /Mode: PROPOSED/);
});

test('fn_find_auth_user_by_email is locked down to the server role', () => {
  const header = m12.slice(m12.indexOf('CREATE OR REPLACE FUNCTION public.fn_find_auth_user_by_email'), m12.indexOf('AS $$'));
  assert.match(header, /SECURITY DEFINER/);
  assert.match(header, /SET search_path = ''/);
  assert.match(header, /RETURNS TABLE \(user_id UUID, has_profile BOOLEAN\)/);
  assert.match(m12, new RegExp(`REVOKE EXECUTE ON FUNCTION ${SIGNATURE.source} FROM PUBLIC, anon, authenticated;`));
  assert.match(m12, new RegExp(`GRANT EXECUTE ON FUNCTION ${SIGNATURE.source} TO service_role;`));
  assert.match(m12, new RegExp(`COMMENT ON FUNCTION ${SIGNATURE.source} IS`));
  assert.doesNotMatch(m12, /GRANT[^;]*TO[^;]*\b(anon|authenticated)\b/);
});

test('email is compared with lower(btrim()) on both sides and not returned', () => {
  assert.match(m12, /lower\(btrim\(u\.email\)\) = lower\(btrim\(p_email\)\)/);
  const body = m12.slice(m12.indexOf('AS $$'), m12.lastIndexOf('$$;'));
  const selectList = body.slice(body.indexOf('SELECT'), body.indexOf('FROM auth.users'));
  assert.doesNotMatch(selectList, /email/);
});

test('migration 12 has no delete, drop or truncate', () => {
  assert.doesNotMatch(m12, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(m12, /\bDROP\s+(TABLE|FUNCTION)\b/i);
  assert.doesNotMatch(m12, /\bTRUNCATE\b/i);
});

test('the lookup SQL tests run inside BEGIN ... ROLLBACK', () => {
  const statements = sqlTests.split('\n').filter(line => !/^\s*--/.test(line) && line.trim() !== '');
  assert.equal(statements[0].trim(), 'BEGIN;');
  assert.equal(statements[statements.length - 1].trim(), 'ROLLBACK;');
  assert.doesNotMatch(sqlTests, /\bCOMMIT\b/i);
});
