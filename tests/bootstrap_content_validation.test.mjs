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
