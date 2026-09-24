import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { importTs, importTranspiled } from './helpers/transpile.mjs';

// Sample content runs against isolated in-memory storage, never the user's records.
const storage = new Map();
let failSet = () => false;
let failRemove = () => false;
globalThis.localStorage = {
  getItem: k => storage.get(k) ?? null,
  setItem: (k, v) => { if (failSet(k)) throw Error('quota'); storage.set(k, String(v)); },
  removeItem: k => { if (failRemove(k)) throw Error('denied'); storage.delete(k); },
};

const data = await importTs('src/data.ts', 'sample-data');
const sample = await importTranspiled('src/sampleData.ts', 'sample-data');

const KNOWLEDGE = 'ib_playbook_knowledge_v3';
const PLAYBOOKS = 'ib_playbook_playbooks';
const SOPS = 'ib_playbook_sops';
const MARKER = 'ib_playbook_explicit_defaults';
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

const snapshot = () => JSON.stringify([...storage.entries()].sort());
const playbookInput = { id: 'newpb', slug: 'newpb', name: 'New PB', code: 'NPB', description: 'd', icon: 'Globe' };
const sopInput = {
  playbookId: 'whatsapp', title: 'New SOP', status: 'Draft', estimatedTime: '', purpose: 'p', whenToUse: 'w',
  requirements: [], responsibleTeam: '', checklist: [], steps: [], escalationRules: '', completionCriteria: '',
  relatedIssues: [], relatedGuides: [], internalNotes: '', revisionHistory: [],
};

beforeEach(() => {
  storage.clear();
  failSet = () => false;
  failRemove = () => false;
});

test('empty storage opens empty and writes no key', () => {
  assert.deepEqual(data.getIssues(), []);
  assert.deepEqual(data.getGuides(), []);
  assert.deepEqual(data.getSOPs(), []);
  assert.deepEqual(data.getPlaybooks(), []);
  assert.equal(data.hasAnyContent(), false);
  assert.equal(data.checkStorageIntegrity().status, 'healthy');
  assert.equal(storage.size, 0);
});

test('loadSampleData writes exactly the sample content', () => {
  data.loadSampleData();
  assert.deepEqual(JSON.parse(storage.get(KNOWLEDGE)), {
    version: 3, issues: sample.sampleIssues, guides: sample.sampleGuides, guideVersions: sample.sampleGuideVersions,
  });
  assert.deepEqual(JSON.parse(storage.get(PLAYBOOKS)), sample.samplePlaybooks);
  assert.deepEqual(JSON.parse(storage.get(SOPS)), sample.sampleSOPs);
  assert.deepEqual(data.getSOPs(), sample.sampleSOPs);
  assert.deepEqual(data.getPlaybooks().map(p => p.id), sample.samplePlaybooks.map(p => p.id));
  assert.equal(data.hasAnyContent(), true);
  assert.equal(data.checkStorageIntegrity().status, 'healthy');
});

test('loadSampleData throws and changes nothing when any content exists', () => {
  const v3 = (o) => JSON.stringify({ version: 3, issues: [], guides: [], guideVersions: [], ...o });
  const version = { id: 'G:v1', guideId: 'G', versionNumber: 1 };
  const setups = {
    playbook: () => data.addPlaybook(playbookInput),
    sop: () => data.addSOP(sopInput),
    issue: () => { data.addPlaybook(playbookInput); data.addIssue({ playbookId: 'newpb', title: 'T', summary: 'S', status: 'Draft', difficulty: 'Easy', estimatedTime: '', symptoms: [], errorMessage: '', context: '', affectedArea: '', informationToCollect: [], attachments: [], internalNotes: '' }); },
    sample: () => data.loadSampleData(),
    // Guide history is never overwritten, even when no Guide references it any more.
    guideVersionsOnly: () => { storage.set(KNOWLEDGE, v3({ guideVersions: [version] })); storage.set(MARKER, 'true'); },
  };
  for (const [name, setup] of Object.entries(setups)) {
    storage.clear();
    setup();
    const before = snapshot();
    assert.equal(data.hasAnyContent(), true, name);
    assert.throws(() => data.loadSampleData(), /only be loaded when there is no content/, name);
    assert.equal(snapshot(), before, name);
  }
});

test('a write failing midway through loadSampleData restores every key already written', () => {
  for (const failing of [KNOWLEDGE, PLAYBOOKS, SOPS]) {
    storage.clear();
    failSet = k => k === failing;
    assert.throws(() => data.loadSampleData(), /Nothing was changed/, failing);
    failSet = () => false;
    assert.equal(storage.size, 0, failing);
    assert.equal(data.hasAnyContent(), false, failing);
  }
});

test('a failed undo after a failed load is reported as possibly inconsistent', () => {
  failSet = k => k === SOPS;
  failRemove = () => true;
  assert.throws(() => data.loadSampleData(), /may now be inconsistent/);
});

test('an existing install with Knowledge but no Playbook or SOP list gets the samples written once', () => {
  const knowledge = JSON.stringify({ version: 3, issues: sample.sampleIssues, guides: sample.sampleGuides, guideVersions: sample.sampleGuideVersions });
  storage.set(KNOWLEDGE, knowledge);
  assert.deepEqual(data.getPlaybooks().map(p => p.id), sample.samplePlaybooks.map(p => p.id));
  assert.deepEqual(JSON.parse(storage.get(PLAYBOOKS)), sample.samplePlaybooks);
  assert.deepEqual(JSON.parse(storage.get(SOPS)), sample.sampleSOPs);
  assert.equal(storage.get(KNOWLEDGE), knowledge);
  // Once settled, a list the user empties stays empty.
  data.savePlaybooks([]);
  storage.delete(SOPS);
  assert.deepEqual(data.getPlaybooks(), []);
  assert.deepEqual(data.getSOPs(), []);
});

test('an existing install keeps a stored empty Playbook list and only fills the missing SOP list', () => {
  storage.set(KNOWLEDGE, JSON.stringify({ version: 3, issues: [], guides: [], guideVersions: [] }));
  storage.set(PLAYBOOKS, '[]');
  assert.deepEqual(data.getPlaybooks(), []);
  assert.equal(storage.get(PLAYBOOKS), '[]');
  assert.deepEqual(JSON.parse(storage.get(SOPS)), sample.sampleSOPs);
});

test('a new install that saves content never receives implicit samples later', () => {
  data.addPlaybook(playbookInput);
  assert.equal(storage.get(MARKER), 'true');
  data.addIssue({ playbookId: 'newpb', title: 'T', summary: 'S', status: 'Draft', difficulty: 'Easy', estimatedTime: '', symptoms: [], errorMessage: '', context: '', affectedArea: '', informationToCollect: [], attachments: [], internalNotes: '' });
  assert.deepEqual(data.getSOPs(), []);
  assert.equal(storage.has(SOPS), false);
  assert.deepEqual(data.getPlaybooks().map(p => p.id), ['newpb']);
});

test('a save is refused when the marker cannot be written, so a new install is never misread', () => {
  failSet = k => k === MARKER;
  assert.throws(() => data.addPlaybook(playbookInput), /Could not save/);
  assert.equal(storage.size, 0);
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
  data.loadSampleData();
  data.addSOP(sopInput);
  data.addPlaybook(playbookInput);
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
  data.loadSampleData();
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
