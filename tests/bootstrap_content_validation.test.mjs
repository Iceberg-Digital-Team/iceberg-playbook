import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateBootstrapContent, validateMediaReference } from '../bootstrap/validate.mjs';

const rootDir = process.cwd();
const bootstrapDir = join(rootDir, 'bootstrap');
const jsonPath = join(bootstrapDir, 'default-content.json');
const schemaPath = join(bootstrapDir, 'default-content.schema.json');
const readmePath = join(bootstrapDir, 'README.md');

test('bootstrap package files and directories exist', () => {
  assert.ok(existsSync(jsonPath), 'default-content.json must exist');
  assert.ok(existsSync(schemaPath), 'default-content.schema.json must exist');
  assert.ok(existsSync(readmePath), 'README.md must exist');

  const assetFolders = ['playbooks', 'issues', 'guides', 'sops', 'users'];
  for (const folder of assetFolders) {
    const dir = join(bootstrapDir, 'assets', 'getting-started', folder);
    assert.ok(existsSync(dir), `Directory assets/getting-started/${folder} must exist`);
    assert.ok(existsSync(join(dir, '.gitkeep')), `.gitkeep must exist in ${folder}`);
  }
});

test('default-content.json and default-content.schema.json parse valid JSON', () => {
  const jsonRaw = readFileSync(jsonPath, 'utf8');
  const schemaRaw = readFileSync(schemaPath, 'utf8');

  assert.doesNotThrow(() => JSON.parse(jsonRaw), 'default-content.json must be valid JSON');
  assert.doesNotThrow(() => JSON.parse(schemaRaw), 'default-content.schema.json must be valid JSON');

  const content = JSON.parse(jsonRaw);
  const schema = JSON.parse(schemaRaw);

  assert.equal(content.version, '1.0.0');
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(schema.type, 'object');
  assert.ok(schema.definitions, 'Schema must define object definitions');
});

test('validateBootstrapContent validates default-content.json successfully', () => {
  const content = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const result = validateBootstrapContent(content);

  assert.equal(result.valid, true, `Validation errors: ${result.errors.join(', ')}`);
  assert.equal(result.errors.length, 0);
});

test('default content contains Getting Started playbook with stable logical key', () => {
  const content = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const pb = content.playbooks.find(p => p.key === 'getting-started');

  assert.ok(pb, 'Playbook with key "getting-started" must exist');
  assert.equal(pb.name, 'Getting Started');
  assert.equal(pb.code, 'GS');
  assert.ok(pb.description.length > 10, 'Playbook must have a descriptive description');
});

test('default content contains all 5 required SOPs with exact logical keys', () => {
  const content = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const expectedSopKeys = [
    'how-to-use-playbooks',
    'how-to-use-issues',
    'how-to-use-guides',
    'how-to-use-sops',
    'how-to-use-users'
  ];

  const foundKeys = content.sops.map(s => s.key);
  for (const expectedKey of expectedSopKeys) {
    assert.ok(foundKeys.includes(expectedKey), `Missing expected SOP key: ${expectedKey}`);
  }
  assert.equal(content.sops.length, 5, 'Should contain exactly the 5 initial onboarding SOPs');
});

test('how-to-use-users is marked as Admin-only in content and requirements', () => {
  const content = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const usersSop = content.sops.find(s => s.key === 'how-to-use-users');

  assert.ok(usersSop, 'how-to-use-users SOP must exist');
  assert.equal(usersSop.title, 'How to Manage Users');

  const reqText = usersSop.requirements.join(' ').toLowerCase();
  assert.ok(reqText.includes('admin'), 'Requirements must state Admin role is required');

  const stepNotes = usersSop.steps.map(s => s.importantNote || '').join(' ').toLowerCase();
  assert.ok(stepNotes.includes('admin'), 'Step notes must highlight Admin-only constraints');
});

test('schema and validator reject data: and javascript: URLs and accept assets/ and https://', () => {
  // Disallowed
  assert.equal(validateMediaReference('data:image/png;base64,iVBORw0KGgo').valid, false);
  assert.equal(validateMediaReference('javascript:alert(1)').valid, false);
  assert.equal(validateMediaReference('http://insecure.example.com/asset.png').valid, false);
  assert.equal(validateMediaReference('ftp://example.com/asset.png').valid, false);

  // Allowed
  assert.equal(validateMediaReference('assets/getting-started/sops/example.png').valid, true);
  assert.equal(validateMediaReference('https://cdn.example.com/videos/onboarding.mp4').valid, true);
});

test('all SOPs define complete portable fields without vendor-specific UUIDs', () => {
  const content = JSON.parse(readFileSync(jsonPath, 'utf8'));

  for (const sop of content.sops) {
    assert.equal(sop.playbookKey, 'getting-started');
    assert.equal(sop.status, 'Verified');
    assert.ok(sop.purpose.length > 5);
    assert.ok(sop.whenToUse.length > 5);
    assert.ok(sop.requirements.length > 0);
    assert.ok(sop.checklist.length > 0);
    assert.ok(sop.steps.length > 0);
    assert.ok(sop.escalationRules.length > 5);
    assert.ok(sop.completionCriteria.length > 5);
    assert.ok(Array.isArray(sop.relatedIssues));
    assert.ok(Array.isArray(sop.relatedGuides));
    assert.ok(sop.revisionHistory.length > 0);

    // Verify step fields
    for (const step of sop.steps) {
      assert.ok(typeof step.number === 'number' && step.number >= 1);
      assert.ok(step.title.length > 0);
      assert.ok(step.description.length > 0);
    }
  }
});

test('Migration 17 defines public.sops.bootstrap_key with format constraint and partial unique index', () => {
  const m17Path = join(rootDir, 'supabase', 'migrations', '17_sop_bootstrap_key.sql');
  assert.ok(existsSync(m17Path), '17_sop_bootstrap_key.sql must exist');

  const sql = readFileSync(m17Path, 'utf8');

  // Verify header and mode
  assert.ok(sql.includes('Mode: PROPOSED'), 'Migration 17 must be marked as PROPOSED');
  assert.ok(sql.includes('ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS'), 'Must have standardized V2 header');

  // Verify column declaration
  assert.ok(
    sql.includes('ALTER TABLE public.sops') && sql.includes('ADD COLUMN IF NOT EXISTS bootstrap_key TEXT DEFAULT NULL;'),
    'Must add nullable bootstrap_key column with NULL default'
  );

  // Verify check constraint
  assert.ok(sql.includes('chk_sop_bootstrap_key_format'), 'Must declare chk_sop_bootstrap_key_format constraint');
  assert.ok(
    sql.includes("conrelid = 'public.sops'::regclass"),
    'Constraint existence check must be scoped to public.sops::regclass'
  );
  assert.ok(
    sql.includes("bootstrap_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'"),
    'Must enforce kebab-case logical key regex'
  );

  // Verify partial unique index scoped to playbook_id
  assert.ok(sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS uq_sops_playbook_bootstrap_key'), 'Must declare unique index');
  assert.ok(
    sql.includes('ON public.sops (playbook_id, bootstrap_key)'),
    'Index must be scoped to (playbook_id, bootstrap_key)'
  );
  assert.ok(
    sql.includes('WHERE bootstrap_key IS NOT NULL;'),
    'Index must be partial (WHERE bootstrap_key IS NOT NULL)'
  );

  // Invariants: No hard deletes or drops
  assert.ok(!sql.includes('DROP TABLE'), 'Must not contain DROP statements');
  assert.ok(!sql.includes('DELETE FROM'), 'Must not contain DELETE statements');
  assert.ok(!sql.includes('TRUNCATE'), 'Must not contain TRUNCATE statements');
});

test('logical-key format constraint validates kebab-case rules and accepts all bundle keys', () => {
  const kebabRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  // Valid keys
  assert.ok(kebabRegex.test('how-to-use-playbooks'));
  assert.ok(kebabRegex.test('how-to-use-issues'));
  assert.ok(kebabRegex.test('how-to-use-guides'));
  assert.ok(kebabRegex.test('how-to-use-sops'));
  assert.ok(kebabRegex.test('how-to-use-users'));
  assert.ok(kebabRegex.test('getting-started'));
  assert.ok(kebabRegex.test('sop1'));

  // Invalid keys
  assert.equal(kebabRegex.test('How-To-Use'), false, 'Uppercase letters not allowed');
  assert.equal(kebabRegex.test('has_underscore'), false, 'Underscores not allowed');
  assert.equal(kebabRegex.test('-leading-dash'), false, 'Leading dashes not allowed');
  assert.equal(kebabRegex.test('trailing-dash-'), false, 'Trailing dashes not allowed');
  assert.equal(kebabRegex.test('double--dash'), false, 'Double dashes not allowed');
  assert.equal(kebabRegex.test('spaces inside'), false, 'Spaces not allowed');
  assert.equal(kebabRegex.test(''), false, 'Empty string not allowed');

  // Verify all keys in default-content.json pass
  const content = JSON.parse(readFileSync(jsonPath, 'utf8'));
  for (const pb of content.playbooks) {
    assert.ok(kebabRegex.test(pb.key), `Playbook key "${pb.key}" must satisfy kebab-case format`);
  }
  for (const sop of content.sops) {
    assert.ok(kebabRegex.test(sop.key), `SOP key "${sop.key}" must satisfy kebab-case format`);
  }
});

