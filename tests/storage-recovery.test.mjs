import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'node_modules', '.cache', 'storage-recovery-test');

function resolveTs(fromDir, spec) {
  const base = path.resolve(fromDir, spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  throw new Error(`Cannot resolve TS module "${spec}" from ${fromDir}`);
}

function outPath(file) {
  return path.join(outDir, path.relative(root, file)).replace(/\.tsx?$/, '.mjs');
}

function transpileTree(entry) {
  const done = new Set();
  const visit = file => {
    if (done.has(file)) return;
    done.add(file);
    const source = readFileSync(file, 'utf8');
    let js = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    js = js.replace(/(from\s*|import\s*\(\s*|import\s+)(['"])(\.{1,2}\/[^'"]+)\2/g, (_m, pre, q, spec) => {
      const target = resolveTs(path.dirname(file), spec);
      visit(target);
      return `${pre}${q}${pathToFileURL(outPath(target)).href}${q}`;
    });
    mkdirSync(path.dirname(outPath(file)), { recursive: true });
    writeFileSync(outPath(file), js);
  };
  visit(entry);
  return outPath(entry);
}

class MemoryStorage {
  constructor() {
    this.map = new Map();
    this.failGet = () => false;
    this.failSet = () => false;
  }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) {
    if (this.failGet(k)) throw new Error('SecurityError: storage access denied');
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    if (this.failSet(k)) {
      const e = new Error('QuotaExceededError: storage full');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.map.set(k, String(v));
  }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });

rmSync(outDir, { recursive: true, force: true });
const data = await import(pathToFileURL(transpileTree(path.join(root, 'src', 'data.ts'))).href);

const KNOWLEDGE = 'ib_playbook_knowledge_v3';
const V2 = 'ib_playbook_knowledge_v2';
const PLAYBOOKS = 'ib_playbook_playbooks';
const SOPS = 'ib_playbook_sops';
const MANIFEST = 'ib_playbook_corrupt_manifest';
const BACKUP_PREFIX = 'ib_playbook_corrupt_backup_';

const raw = k => storage.map.get(k);
const backupKeys = (prefix = BACKUP_PREFIX) => [...storage.map.keys()].filter(k => k.startsWith(prefix));
const isCorruptedError = key => err => err?.name === 'StorageCorruptedError' && err.key === key;

const EMPTY_V3 = JSON.stringify({ version: 3, issues: [], guides: [], guideVersions: [] });
const VALID_PLAYBOOKS = JSON.stringify([{ id: 'a', slug: 'a', name: 'A', code: 'A' }]);
const VALID_SOPS = JSON.stringify([{ id: 's1', playbookId: 'a', title: 'T' }]);
const DUPLICATE_ISSUES_WITH_HISTORY = JSON.stringify({
  version: 3,
  issues: [{ id: 'X-001' }, { id: 'X-001' }],
  guides: [],
  guideVersions: [{ guideId: 'G1', versionNumber: 1, note: 'history must survive byte-for-byte' }],
});

const issueInput = playbookId => ({
  playbookId, title: 'Login fails', summary: 'Users cannot log in', status: 'Draft', difficulty: 'Medium',
  estimatedTime: '', symptoms: ['Error shown'], errorMessage: '', context: '', affectedArea: '',
  informationToCollect: [], attachments: [], internalNotes: '',
});
const playbookInput = {
  id: 'newpb', slug: 'newpb', name: 'New PB', code: 'NPB', description: 'desc',
  icon: 'Globe', owner: 'Support Team', visibility: 'Internal',
};

function seedMigratedKnowledge() {
  data.getIssues();
  assert.ok(raw(KNOWLEDGE), 'precondition: reading empty storage must produce a v3 envelope');
  const playbookId = data.getPlaybooks()[0]?.id;
  assert.ok(playbookId, 'precondition: at least one playbook must be available');
  return playbookId;
}

beforeEach(() => {
  storage.clear();
  storage.failGet = () => false;
  storage.failSet = () => false;
});

// (e)1
test('checkStorageIntegrity does not throw on malformed JSON and reports the key', () => {
  storage.setItem(KNOWLEDGE, '{not json');
  const result = data.checkStorageIntegrity();
  assert.equal(result.status, 'corrupted');
  assert.deepEqual(result.affectedKeys, [KNOWLEDGE]);
});

// (e)2
test('empty storage is healthy and creates no backup or manifest', () => {
  const result = data.checkStorageIntegrity();
  assert.equal(result.status, 'healthy');
  assert.equal(storage.length, 0);
});

test('valid v3 envelope is not flagged as corrupted', () => {
  storage.setItem(KNOWLEDGE, EMPTY_V3);
  storage.setItem(PLAYBOOKS, VALID_PLAYBOOKS);
  storage.setItem(SOPS, VALID_SOPS);
  const result = data.checkStorageIntegrity();
  assert.equal(result.status, 'healthy');
  assert.deepEqual(backupKeys(), []);
});

test('valid legacy v2 envelope without v3 is not flagged as corrupted', () => {
  storage.setItem(V2, JSON.stringify({ version: 2, issues: [], guides: [] }));
  const result = data.checkStorageIntegrity();
  assert.equal(result.status, 'healthy');
  assert.deepEqual(backupKeys(), []);
});

// (e)3
test('a record violating validateKnowledge marks the whole knowledge key corrupted', () => {
  storage.setItem(KNOWLEDGE, DUPLICATE_ISSUES_WITH_HISTORY);
  const result = data.checkStorageIntegrity();
  assert.equal(result.status, 'corrupted');
  assert.ok(result.affectedKeys.includes(KNOWLEDGE));
  assert.equal(result.canReset, true);
});

// (e)4
test('three corrupted keys get three distinct backups, each holding its own raw value', () => {
  storage.setItem(KNOWLEDGE, 'broken-knowledge');
  storage.setItem(PLAYBOOKS, '{}');
  storage.setItem(SOPS, '"not-an-array"');
  data.checkStorageIntegrity();
  const k = backupKeys(`${BACKUP_PREFIX}knowledge_v3_`);
  const p = backupKeys(`${BACKUP_PREFIX}playbooks_`);
  const s = backupKeys(`${BACKUP_PREFIX}sops_`);
  assert.equal(k.length, 1);
  assert.equal(p.length, 1);
  assert.equal(s.length, 1);
  assert.equal(raw(k[0]), 'broken-knowledge');
  assert.equal(raw(p[0]), '{}');
  assert.equal(raw(s[0]), '"not-an-array"');
});

// (e)5
test('corrupted envelope with guideVersions is backed up byte-for-byte and the original is untouched', () => {
  storage.setItem(KNOWLEDGE, DUPLICATE_ISSUES_WITH_HISTORY);
  const result = data.checkStorageIntegrity();
  const backupKey = result.details[KNOWLEDGE].backupKey;
  assert.ok(backupKey);
  assert.equal(raw(backupKey), DUPLICATE_ISSUES_WITH_HISTORY);
  assert.equal(raw(KNOWLEDGE), DUPLICATE_ISSUES_WITH_HISTORY);
});

test('repeated integrity checks on the same raw value create exactly one backup', () => {
  storage.setItem(SOPS, '{}');
  data.checkStorageIntegrity();
  data.checkStorageIntegrity();
  data.checkStorageIntegrity();
  assert.equal(backupKeys(`${BACKUP_PREFIX}sops_`).length, 1);
});

// (e)6
test('when backup fails, reset is refused and the original value stays in place', () => {
  storage.setItem(SOPS, '{}');
  storage.failSet = k => k.startsWith(BACKUP_PREFIX);
  const result = data.checkStorageIntegrity();
  assert.equal(result.details[SOPS].backupFailed, true);
  assert.equal(result.canReset, false);
  assert.throws(() => data.resetCorruptedStorage());
  assert.equal(raw(SOPS), '{}');
});

test('when backup fails, download data is served from the original key', () => {
  storage.setItem(SOPS, '{}');
  storage.failSet = k => k.startsWith(BACKUP_PREFIX);
  assert.equal(data.getCorruptedBackupData()[SOPS], '{}');
});

test('withoutBackup reset only touches keys whose backup failed', () => {
  storage.setItem(KNOWLEDGE, 'broken-knowledge');
  storage.setItem(SOPS, '{}');
  storage.failSet = k => k.startsWith(`${BACKUP_PREFIX}sops_`);
  data.resetCorruptedStorage({ withoutBackup: true });
  assert.equal(raw(SOPS), '[]');
  assert.equal(raw(KNOWLEDGE), 'broken-knowledge');
});

// (e)7 + §2 mandatory R-03
test('resetting a corrupted SOP key leaves knowledge (with its version history) and playbooks byte-identical', () => {
  seedMigratedKnowledge();
  storage.setItem(PLAYBOOKS, VALID_PLAYBOOKS);
  assert.equal(data.checkStorageIntegrity().status, 'healthy', 'precondition: seeded storage must be healthy');
  const knowledgeBefore = raw(KNOWLEDGE);
  assert.ok(JSON.parse(knowledgeBefore).guideVersions.length > 0, 'precondition: version history must be non-empty');
  storage.setItem(SOPS, '{}');

  data.resetCorruptedStorage();

  assert.equal(raw(KNOWLEDGE), knowledgeBefore);
  assert.equal(raw(PLAYBOOKS), VALID_PLAYBOOKS);
  assert.equal(raw(SOPS), '[]');
  assert.equal(data.checkStorageIntegrity().status, 'healthy');
});

test('after reset the corrupted value still exists in its backup key', () => {
  storage.setItem(SOPS, '{"lost":false}');
  data.resetCorruptedStorage();
  const [backup] = backupKeys(`${BACKUP_PREFIX}sops_`);
  assert.equal(raw(backup), '{"lost":false}');
});

// Round-1 finding 3
test('inaccessible storage yields status unavailable instead of throwing', () => {
  storage.failGet = () => true;
  const result = data.checkStorageIntegrity();
  assert.equal(result.status, 'unavailable');
});

test('a manifest holding "null" does not crash the integrity check', () => {
  storage.setItem(MANIFEST, 'null');
  storage.setItem(SOPS, '{}');
  const result = data.checkStorageIntegrity();
  assert.equal(result.status, 'corrupted');
  assert.ok(result.details[SOPS].backupKey);
});

// Round-1 finding 2
test('loadData returns defaults only when the key is absent', () => {
  const defaults = [{ id: 'd' }];
  assert.deepEqual(data.loadData('x', defaults), defaults);
});

test('loadData throws StorageCorruptedError for a non-array value', () => {
  storage.setItem('ib_playbook_x', '{}');
  assert.throws(() => data.loadData('x', []), isCorruptedError('ib_playbook_x'));
});

test('getIssues throws StorageCorruptedError instead of returning an empty list', () => {
  storage.setItem(KNOWLEDGE, DUPLICATE_ISSUES_WITH_HISTORY);
  assert.throws(() => data.getIssues(), isCorruptedError(KNOWLEDGE));
});

test('addIssue on corrupted knowledge is refused and does not overwrite the stored value', () => {
  storage.setItem(PLAYBOOKS, VALID_PLAYBOOKS);
  storage.setItem(KNOWLEDGE, DUPLICATE_ISSUES_WITH_HISTORY);
  assert.throws(() => data.addIssue(issueInput('a')), isCorruptedError(KNOWLEDGE));
  assert.equal(raw(KNOWLEDGE), DUPLICATE_ISSUES_WITH_HISTORY);
});

test('addPlaybook on corrupted playbooks is refused and does not inject defaults', () => {
  storage.setItem(PLAYBOOKS, '{}');
  assert.throws(() => data.addPlaybook(playbookInput), isCorruptedError(PLAYBOOKS));
  assert.equal(raw(PLAYBOOKS), '{}');
});

// (e)8
test('control: addIssue with this input succeeds when storage is writable', () => {
  const playbookId = seedMigratedKnowledge();
  const issue = data.addIssue(issueInput(playbookId));
  assert.ok(issue?.id);
  assert.ok(data.getIssues().some(i => i.id === issue.id));
});

test('knowledge write failure throws and leaves the stored envelope unchanged', () => {
  const playbookId = seedMigratedKnowledge();
  const before = raw(KNOWLEDGE);
  storage.failSet = k => k === KNOWLEDGE;
  let caught;
  try { data.addIssue(issueInput(playbookId)); } catch (e) { caught = e; }
  assert.ok(caught, 'addIssue must throw when the write fails');
  assert.match(data.formatStorageError(caught), /could not save/i);
  assert.equal(raw(KNOWLEDGE), before);
});

test('saveData write failure throws and leaves the stored value unchanged', () => {
  storage.setItem(PLAYBOOKS, VALID_PLAYBOOKS);
  storage.failSet = k => k === PLAYBOOKS;
  assert.throws(() => data.saveData('playbooks', []), /could not save/i);
  assert.equal(raw(PLAYBOOKS), VALID_PLAYBOOKS);
});

// (e)9
test('formatStorageError uses the error message when present', () => {
  assert.equal(data.formatStorageError(new Error('Storage full.')), 'Storage full.');
});

test('formatStorageError trims string errors', () => {
  assert.equal(data.formatStorageError('  quota  '), 'quota');
});

test('formatStorageError falls back for empty or unknown errors', () => {
  assert.equal(data.formatStorageError(new Error(''), 'Fallback.'), 'Fallback.');
  assert.equal(data.formatStorageError(undefined, 'Fallback.'), 'Fallback.');
  assert.equal(data.formatStorageError({}), 'Could not save changes.');
});
