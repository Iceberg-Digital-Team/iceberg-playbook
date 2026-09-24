import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importTs } from './helpers/transpile.mjs';

// Test the real frontend data layer with isolated storage, never the user's records.
const storage = new Map();
let failWrites = false;
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => { if (failWrites) throw Error('quota'); storage.set(key, value); },
};
const data = await importTs('src/data.ts', 'relationships');
const issueInput = { playbookId: 'whatsapp', title: 'QA problem', summary: 'Customer cannot complete signup.', status: 'Draft', difficulty: 'Medium', estimatedTime: '10 min', symptoms: ['Blank screen'], errorMessage: 'E-QA', context: 'During signup', affectedArea: 'Signup', informationToCollect: ['WABA ID'], attachments: [], internalNotes: 'Investigate' };
const guideInput = { playbookId: 'whatsapp', issueId: '', title: 'QA solution', summary: 'Restore signup', status: 'Verified', difficulty: 'Medium', estimatedTime: '5 min', requirements: [], beforeYouStart: [], importantInformation: '', steps: [{ number: 1, title: 'Check setup', description: 'Review the setup.' }], commonProblems: [], faq: [], relatedItems: [], internalNotes: '', revisionHistory: [] };

test('migration preserves all legacy solution content and old Guide links', () => {
  storage.clear();
  const issues = data.getIssues(); const guides = data.getGuides();
  assert.equal(new Set(guides.map(g => g.issueId)).size, guides.length);
  for (const g of guides) assert.equal(issues.find(i => i.id === g.issueId)?.playbookId, g.playbookId);
  const guide = data.getPrimaryGuide('WA-001');
  assert.equal(guide.steps.length, 4); assert.equal(guide.faq.length, 2);
  assert.equal(guide.commonProblems.length, 2);
  assert.ok(guides.find(g => g.id === 'WA-G02'));
  assert.ok(!('steps' in issues.find(i => i.id === 'WA-001')));
  const first = JSON.stringify({ issues, guides });
  assert.equal(JSON.stringify({ issues: data.getIssues(), guides: data.getGuides() }), first);
});
test('complete Issue to primary Guide flow persists and derives availability', () => {
  const issue = data.addIssue(issueInput);
  assert.equal(data.getSolutionState(issue.id), 'Guide Needed');
  const guide = data.addGuide({ ...guideInput, issueId: issue.id });
  assert.equal(data.getSolutionState(issue.id), 'Solution Available');
  assert.equal(data.getGuides().find(g => g.id === guide.id).issueId, issue.id);
  assert.equal(data.getIssues().find(i => i.id === issue.id).errorMessage, 'E-QA');
  assert.ok(data.getIssues().find(i => i.id === issue.id).createdAt);
});
test('rejects orphan, cross-Playbook, duplicate and incomplete Guides', () => {
  assert.throws(() => data.addGuide(guideInput), /Related Issue/);
  const issue = data.addIssue(issueInput);
  assert.throws(() => data.addGuide({ ...guideInput, issueId: issue.id, playbookId: 'zoom' }), /Playbook/);
  assert.throws(() => data.addGuide({ ...guideInput, issueId: issue.id, steps: [] }), /steps/);
  data.addGuide({ ...guideInput, issueId: issue.id });
  assert.throws(() => data.addGuide({ ...guideInput, issueId: issue.id }), /primary Guide/);
  assert.throws(() => data.saveGuides([...data.getGuides(), { ...guideInput, id: 'BAD', issueId: 'missing' }]), /Related Issue/);
  assert.throws(() => data.saveIssues(data.getIssues().filter(i => i.id !== issue.id)), /Related Issue/);
});
test('new Issue IDs do not collide with sparse legacy codes', () => {
  const issue = data.addIssue({ ...issueInput, playbookId: 'meta-business' });
  assert.equal(issue.id, 'META-007');
});
test('storage failure does not report success or partially create a record', () => {
  const before = JSON.stringify(data.getIssues()); failWrites = true;
  assert.throws(() => data.addIssue(issueInput), /Could not save/);
  failWrites = false; assert.equal(JSON.stringify(data.getIssues()), before);
});
test('SOPs remain independent and their existing references survive', () => {
  const sops = data.getSOPs();
  assert.ok(!('issueId' in sops[0]));
  assert.ok(sops[0].relatedGuides.every(id => data.getGuides().some(g => g.id === id)));
});
