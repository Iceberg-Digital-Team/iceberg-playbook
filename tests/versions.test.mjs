import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const storage = new Map(); let fail = false;
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => { if (fail) throw Error('quota'); storage.set(k,v); } };
const js = ts.transpileModule(readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText;
const d = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('two updates and restore retain exact snapshots, identity and current-only records', () => {
  const original = d.getPrimaryGuide('WA-001'); const count = d.getGuides().length;
  const first = d.getGuideVersion(original.id, original.currentVersionId);
  const content = d.guideContent(original); content.steps[1].description = 'New Meta interface'; content.steps[1].screenshot = 'https://example.com/new.png'; content.faq[0].answer = 'New answer';
  const second = d.publishGuideUpdate(original.id, content, original.currentVersionId, 'Updated Step 2 with the new Meta interface.');
  assert.equal(second.versionNumber, 2); assert.notEqual(second.updatedAt, original.updatedAt); assert.equal(second.updatedBy, 'Tarik Deniz');
  content.steps[1].description = 'Mutated caller';
  assert.equal(d.getGuideVersion(original.id, second.currentVersionId).steps[1].description, 'New Meta interface');
  assert.deepEqual(d.getGuideVersion(original.id, first.id), first);
  const third = d.publishGuideUpdate(original.id, { ...d.guideContent(second), title: 'Second update', issueId: 'bad', playbookId: 'bad' }, second.currentVersionId);
  assert.equal(third.issueId, original.issueId); assert.equal(third.playbookId, original.playbookId);
  const beforeRestore = d.getGuideVersions(original.id);
  const fourth = d.restoreGuideVersion(original.id, first.id, third.currentVersionId);
  assert.equal(d.formatGuideVersion(fourth.versionNumber), '1.3');
  assert.deepEqual(d.guideContent(fourth), d.guideContent(original));
  assert.deepEqual(d.getGuideVersions(original.id).slice(1), beforeRestore);
  assert.equal(d.getGuideVersions(original.id)[0].changeSummary, 'Restored from version 1.0');
  assert.equal(d.getGuideVersions(original.id)[0].restoredFromVersionId, first.id);
  assert.equal(d.getGuides().length, count); assert.equal(d.getPrimaryGuide(original.issueId).id, original.id);
  assert.equal(d.getPrimaryGuide(original.issueId).currentVersionId, fourth.currentVersionId);
  assert.equal(fourth.createdAt, original.createdAt); assert.equal(fourth.createdBy, original.createdBy);
});
test('no-op, stale editor, invalid restore and failed storage cannot damage history', () => {
  const g = d.getPrimaryGuide('WA-001'); const before = storage.get('ib_playbook_knowledge_v3');
  assert.throws(() => d.publishGuideUpdate(g.id, d.guideContent(g), g.currentVersionId), /No content/);
  assert.throws(() => d.publishGuideUpdate(g.id, {...d.guideContent(g), title:'x'}, `${g.id}:v1`), /updated elsewhere/);
  assert.throws(() => d.restoreGuideVersion(g.id, 'missing', g.currentVersionId), /not found/);
  assert.throws(() => d.restoreGuideVersion(g.id, g.currentVersionId, g.currentVersionId), /already current/);
  fail = true;
  assert.throws(() => d.publishGuideUpdate(g.id, {...d.guideContent(g), title:'x'}, g.currentVersionId), /Could not save/);
  fail = false; assert.equal(storage.get('ib_playbook_knowledge_v3'), before);
});
test('v2 migration retains original content, links and legacy notes without fabricated snapshots', () => {
  const issues = d.getIssues(); const guides = d.getGuides();
  const legacy = JSON.stringify({version:2, issues, guides}); storage.clear(); storage.set('ib_playbook_knowledge_v2', legacy);
  const migrated = d.getGuides();
  assert.equal(storage.get('ib_playbook_knowledge_v2'), legacy);
  for (const g of migrated) { const old = guides.find(x => x.id === g.id); assert.equal(g.issueId, old.issueId); assert.deepEqual(d.guideContent(g), d.guideContent(old)); assert.deepEqual(g.revisionHistory, old.revisionHistory); assert.equal(d.getGuideVersions(g.id).length, 1); }
});
