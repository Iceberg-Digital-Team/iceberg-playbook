import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const servicePath = join(srcDir, 'services', 'adminUserService.ts');
const rulesPath = join(srcDir, 'services', 'adminUserRules.ts');

function getAllFiles(dir) {
  if (!existsSync(dir)) return [];
  let results = [];
  for (const name of readdirSync(dir)) {
    const filePath = join(dir, name);
    if (statSync(filePath).isDirectory()) results = results.concat(getAllFiles(filePath));
    else if (/\.(ts|tsx)$/.test(name)) results.push(filePath);
  }
  return results;
}

// Every module specifier used by static imports, re-exports and dynamic imports.
function importSpecifiers(source) {
  const specs = [];
  const patterns = [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specs.push(match[1]);
  }
  return specs;
}

const isSupabaseSpec = spec => spec === '@supabase/supabase-js' || /(^|\/)lib\/supabase(\.ts)?$/.test(spec) || /supabase/i.test(spec);

test('no page or component imports Supabase', () => {
  const files = [...getAllFiles(join(srcDir, 'pages')), ...getAllFiles(join(srcDir, 'components'))];
  assert.ok(files.length > 0);
  for (const file of files) {
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      assert.ok(!isSupabaseSpec(spec), `${file} must not import "${spec}"`);
    }
  }
});

test('admin service and rules have no Supabase or React imports', () => {
  for (const file of [servicePath, rulesPath]) {
    const specs = importSpecifiers(readFileSync(file, 'utf8'));
    assert.ok(specs.length > 0, `${file} should have imports to check`);
    for (const spec of specs) {
      assert.ok(!isSupabaseSpec(spec), `${file} must not import "${spec}"`);
      assert.ok(!/^react(-dom)?(\/|$)/.test(spec), `${file} must not import "${spec}"`);
    }
  }
});

test('admin rules never read the clock', () => {
  const source = readFileSync(rulesPath, 'utf8');
  assert.ok(!source.includes('Date.now('), 'adminUserRules.ts must not call Date.now()');
  assert.ok(!/new Date\(\s*\)/.test(source), 'adminUserRules.ts must not call new Date() without arguments');
});

test('admin rules import only types from the admin service', () => {
  const source = readFileSync(rulesPath, 'utf8');
  const imports = [...source.matchAll(/\bimport\s+([^;]*?)\s+from\s*['"]\.\/adminUserService(\.ts)?['"]/g)];
  assert.ok(imports.length > 0, 'expected a type import from ./adminUserService');
  for (const [statement, clause] of imports) {
    assert.ok(/^type\s/.test(clause), `non-type import from ./adminUserService: ${statement}`);
  }
  assert.ok(!/\bimport\s*\(\s*['"]\.\/adminUserService/.test(source), 'no dynamic import of ./adminUserService');
  assert.ok(!/\bexport\s+[^;]*from\s*['"]\.\/adminUserService/.test(source), 'no re-export from ./adminUserService');
});

test('among the admin files only src/services/admin/ imports Supabase', () => {
  const adminDir = join(srcDir, 'services', 'admin');
  const adminFiles = getAllFiles(adminDir);
  assert.ok(adminFiles.length > 0, 'src/services/admin/ has the adapter');
  for (const file of [servicePath, rulesPath, ...adminFiles]) {
    const usesSupabase = importSpecifiers(readFileSync(file, 'utf8')).some(isSupabaseSpec);
    if (!file.startsWith(adminDir)) {
      assert.ok(!usesSupabase, `${file} must not import Supabase`);
    }
  }
});

test('the Supabase admin adapter only invokes Edge Functions and keeps no secrets', () => {
  const source = readFileSync(join(srcDir, 'services', 'admin', 'supabaseAdminUserAdapter.ts'), 'utf8');
  assert.match(source, /functions\.invoke\(/);
  for (const forbidden of [/\.from\(/, /\.rpc\(/, /auth\.admin/, /\.storage\b/, /localStorage/, /sessionStorage/, /\bconsole\./,
    /SERVICE_ROLE/i, /SECRET/i, /VITE_/]) {
    assert.ok(!forbidden.test(source), `adapter must not contain ${forbidden}`);
  }
});
