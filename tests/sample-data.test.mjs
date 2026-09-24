import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { importTs, importTranspiled } from './helpers/transpile.mjs';

// Sample content runs against isolated in-memory storage, never the user's records.
const storage = new Map();
globalThis.localStorage = {
  getItem: k => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)),
};

const data = await importTs('src/data.ts', 'sample-data');
const sample = await importTranspiled('src/sampleData.ts', 'sample-data');

const KNOWLEDGE = 'ib_playbook_knowledge_v3';
const LEGACY_ISSUES = 'ib_playbook_issues';
const LEGACY_GUIDES = 'ib_playbook_guides';
const BACKUP_PREFIX = 'ib_playbook_corrupt_backup_';
const sampleArrays = () => ({
  samplePlaybooks: sample.samplePlaybooks, sampleIssues: sample.sampleIssues, sampleGuides: sample.sampleGuides,
  sampleGuideVersions: sample.sampleGuideVersions, sampleSOPs: sample.sampleSOPs,
});
const isCorruptedError = key => err => err?.name === 'StorageCorruptedError' && err.key === key;
const legacyIssue = {
  id: 'OLD-001', playbookId: 'whatsapp', title: 'Old problem', summary: 'Stored before v2.', status: 'Draft',
  difficulty: 'Easy', estimatedTime: '5 min', author: 'Support Team', updatedAt: '2025-01-01',
  requirements: [], beforeYouStart: [], importantInformation: '',
  steps: [{ number: 1, title: 'Do it', description: 'Do the thing.' }],
  commonProblems: [], faq: [], relatedItems: [], internalNotes: '', revisionHistory: [],
};

beforeEach(() => storage.clear());

test('empty storage is seeded with exactly the sample v3 envelope', () => {
  data.getIssues();
  assert.deepEqual(JSON.parse(storage.get(KNOWLEDGE)), {
    version: 3, issues: sample.sampleIssues, guides: sample.sampleGuides, guideVersions: sample.sampleGuideVersions,
  });
  assert.deepEqual(data.getSOPs(), sample.sampleSOPs);
  assert.deepEqual(data.getPlaybooks().map(p => p.id), sample.samplePlaybooks.map(p => p.id));
  assert.equal(data.checkStorageIntegrity().status, 'healthy');
});

test('sample content passes knowledge validation', () => {
  assert.doesNotThrow(() => data.validateKnowledge({
    version: 3, issues: sample.sampleIssues, guides: sample.sampleGuides, guideVersions: sample.sampleGuideVersions,
  }));
});

test('sample content is plain data that survives a JSON round trip', () => {
  for (const [name, list] of Object.entries(sampleArrays())) {
    assert.ok(Array.isArray(list) && list.length > 0, `${name} must be a non-empty array`);
    assert.deepEqual(JSON.parse(JSON.stringify(list)), list, `${name} must be JSON-safe`);
  }
});

test('adding records never mutates the sample arrays', () => {
  const before = JSON.stringify(sampleArrays());
  data.addSOP({
    playbookId: 'whatsapp', title: 'New SOP', status: 'Draft', estimatedTime: '', purpose: 'p', whenToUse: 'w',
    requirements: [], responsibleTeam: '', checklist: [], steps: [], escalationRules: '', completionCriteria: '',
    relatedIssues: [], relatedGuides: [], internalNotes: '', revisionHistory: [],
  });
  data.addPlaybook({ id: 'newpb', slug: 'newpb', name: 'New PB', code: 'NPB', description: 'd', icon: 'Globe' });
  data.getIssues()[0].title = 'Mutated by caller';
  data.getGuides()[0].steps[0].title = 'Mutated by caller';
  assert.equal(JSON.stringify(sampleArrays()), before);
  assert.equal(sample.sampleSOPs.length, 1);
  assert.equal(data.getSOPs().length, 2);
});

test('loadData returns a copy of the defaults when the key is absent', () => {
  const defaults = [{ id: 'd', tags: ['a'] }];
  const loaded = data.loadData('absent', defaults);
  assert.deepEqual(loaded, defaults);
  loaded.push({ id: 'e', tags: [] });
  loaded[0].tags.push('b');
  assert.deepEqual(defaults, [{ id: 'd', tags: ['a'] }]);
});

test('legacy issue list migrates without merging sample content, and the legacy key is kept', () => {
  const raw = JSON.stringify([legacyIssue]);
  storage.set(LEGACY_ISSUES, raw);
  const issues = data.getIssues();
  assert.deepEqual(issues.map(i => i.id), ['OLD-001']);
  assert.equal(data.getPrimaryGuide('OLD-001').steps[0].title, 'Do it');
  assert.equal(storage.get(LEGACY_ISSUES), raw);
});

test('corrupted legacy issue and guide lists are reported and backed up', () => {
  storage.set(LEGACY_ISSUES, '{}');
  storage.set(LEGACY_GUIDES, JSON.stringify([{ id: 'G', playbookId: 'p', title: 't' }, { id: 'G', playbookId: 'p', title: 't' }]));
  const result = data.checkStorageIntegrity();
  assert.equal(result.status, 'corrupted');
  assert.deepEqual(result.affectedKeys, [LEGACY_ISSUES, LEGACY_GUIDES]);
  assert.equal(storage.get(result.details[LEGACY_ISSUES].backupKey), '{}');
  assert.ok(result.details[LEGACY_GUIDES].backupKey.startsWith(`${BACKUP_PREFIX}guides_`));
  assert.throws(() => data.getIssues(), isCorruptedError(LEGACY_ISSUES));
});

test('a legacy record that is not an object is reported as corrupted', () => {
  storage.set(LEGACY_ISSUES, '[null]');
  assert.deepEqual(data.checkStorageIntegrity().affectedKeys, [LEGACY_ISSUES]);
});

test('legacy lists are not checked once a v3 envelope exists', () => {
  data.getIssues();
  storage.set(LEGACY_ISSUES, '{}');
  assert.equal(data.checkStorageIntegrity().status, 'healthy');
});

test('resetting corrupted legacy lists writes empty lists and does not inject samples', () => {
  storage.set(LEGACY_ISSUES, '{}');
  storage.set(LEGACY_GUIDES, 'not json');
  const result = data.resetCorruptedStorage();
  assert.equal(result.status, 'healthy');
  assert.equal(storage.get(LEGACY_ISSUES), '[]');
  assert.equal(storage.get(LEGACY_GUIDES), '[]');
  assert.deepEqual(data.getIssues(), []);
});
