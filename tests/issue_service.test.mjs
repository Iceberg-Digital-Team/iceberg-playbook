import { test } from 'node:test';
import assert from 'node:assert/strict';

// Provide dummy env for transpiler module loading in test environment
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dummy.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key-for-unit-tests';

import { importTs } from './helpers/transpile.mjs';

test('mapIssueRowToIssue correctly maps database fields to frontend Issue shape', async () => {
  const { mapIssueRowToIssue } = await importTs('src/services/issueService.ts', 'issue-service');
  const dbRow = {
    id: 'WA-001',
    playbook_id: 'whatsapp',
    title: 'Phone Number Already Registered',
    summary: 'Customer unable to register business number',
    symptoms: ['Registration error', 'Code not received'],
    error_message: 'ERR_NUMBER_IN_USE',
    context: 'During onboarding',
    affected_area: 'Account Setup',
    information_to_collect: ['Screenshot of error', 'Phone number'],
    attachments: [{ name: 'error.png', url: 'https://example.com/error.png' }],
    internal_notes: 'Escalate to Tier 2 if needed',
    status: 'Verified',
    difficulty: 'Medium',
    estimated_time: '15 min',
    author: 'Support Team',
    deleted_at: null,
    deleted_by: null,
    created_at: '2026-09-27T00:00:00Z',
    updated_at: '2026-09-27T01:00:00Z',
  };

  const issue = mapIssueRowToIssue(dbRow);
  assert.equal(issue.id, 'WA-001');
  assert.equal(issue.playbookId, 'whatsapp');
  assert.equal(issue.title, 'Phone Number Already Registered');
  assert.equal(issue.summary, 'Customer unable to register business number');
  assert.deepEqual(issue.symptoms, ['Registration error', 'Code not received']);
  assert.equal(issue.errorMessage, 'ERR_NUMBER_IN_USE');
  assert.equal(issue.context, 'During onboarding');
  assert.equal(issue.affectedArea, 'Account Setup');
  assert.deepEqual(issue.informationToCollect, ['Screenshot of error', 'Phone number']);
  assert.deepEqual(issue.attachments, [{ name: 'error.png', url: 'https://example.com/error.png' }]);
  assert.equal(issue.internalNotes, 'Escalate to Tier 2 if needed');
  assert.equal(issue.status, 'Verified');
  assert.equal(issue.difficulty, 'Medium');
  assert.equal(issue.estimatedTime, '15 min');
  assert.equal(issue.author, 'Support Team');
  assert.equal(issue.createdAt, '2026-09-27T00:00:00Z');
  assert.equal(issue.updatedAt, '2026-09-27T01:00:00Z');
});

test('createIssue validates required inputs before sending query', async () => {
  const { createIssue } = await importTs('src/services/issueService.ts', 'issue-service');
  const mockClient = {};

  await assert.rejects(
    () => createIssue({ playbookId: '', title: 'Title', summary: 'Summary' }, mockClient),
    /Select a Playbook for this Issue/
  );

  await assert.rejects(
    () => createIssue({ playbookId: 'whatsapp', title: '', summary: 'Summary' }, mockClient),
    /Enter an Issue title/
  );

  await assert.rejects(
    () => createIssue({ playbookId: 'whatsapp', title: 'Title', summary: '' }, mockClient),
    /Provide a problem summary/
  );
});

test('getIssueById returns null for empty or whitespace id', async () => {
  const { getIssueById } = await importTs('src/services/issueService.ts', 'issue-service');
  const mockClient = {};
  const result = await getIssueById('   ', mockClient);
  assert.equal(result, null);
});

test('listIssuesByPlaybook returns empty array for empty or whitespace playbookId', async () => {
  const { listIssuesByPlaybook } = await importTs('src/services/issueService.ts', 'issue-service');
  const mockClient = {};
  const result = await listIssuesByPlaybook('   ', mockClient);
  assert.deepEqual(result, []);
});

test('softDeleteIssue throws for empty id', async () => {
  const { softDeleteIssue } = await importTs('src/services/issueService.ts', 'issue-service');
  const mockClient = {};
  await assert.rejects(
    () => softDeleteIssue('', mockClient),
    /Invalid Issue ID/
  );
});
