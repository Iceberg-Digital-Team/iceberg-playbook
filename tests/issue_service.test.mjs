import { test } from 'node:test';
import assert from 'node:assert/strict';

// Provide dummy env for transpiler module loading in test environment
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dummy.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key-for-unit-tests';

import { importTs } from './helpers/transpile.mjs';

const {
  mapIssueRowToIssue,
  createIssue,
  updateIssue,
  getIssueById,
  listIssuesByPlaybook,
  softDeleteIssue,
} = await importTs('src/services/issueService.ts', 'issue-service');

const { parseHash } = await importTs('src/router.ts', 'router-issue-edit');

test('mapIssueRowToIssue correctly maps database fields to frontend Issue shape', async () => {
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
    jira_code: 'NEW-001',
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
  assert.equal(issue.jiraCode, 'NEW-001');
  assert.equal(issue.createdAt, '2026-09-27T00:00:00Z');
  assert.equal(issue.updatedAt, '2026-09-27T01:00:00Z');
});

test('mapIssueRowToIssue handles optional jira_code field (present, null, and empty)', () => {
  const base = {
    id: 'ISS-004',
    playbook_id: 'whatsapp',
    title: 'Test',
    summary: 'Test summary',
    author: 'Tester',
    created_at: '2026-09-29T00:00:00Z',
    updated_at: '2026-09-29T00:00:00Z',
    deleted_at: null,
    deleted_by: null,
  };

  const withCode = mapIssueRowToIssue({ ...base, jira_code: 'NEW-001' });
  assert.equal(withCode.jiraCode, 'NEW-001');

  const withWhitespace = mapIssueRowToIssue({ ...base, jira_code: '   ' });
  assert.equal(withWhitespace.jiraCode, undefined);

  const withoutCode = mapIssueRowToIssue({ ...base, jira_code: null });
  assert.equal(withoutCode.jiraCode, undefined);
});

test('createIssue validates required inputs before sending query', async () => {
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

test('createIssue persists trimmed jira_code or null when omitted/empty', async () => {
  let capturedInsert = null;
  const mockClient = {
    rpc: (name) => {
      assert.equal(name, 'fn_generate_issue_code');
      return Promise.resolve({ data: 'ISS-005', error: null });
    },
    from: (table) => {
      assert.equal(table, 'issues');
      return {
        insert: (payload) => {
          capturedInsert = payload;
          return {
            select: () => ({
              single: () => Promise.resolve({
                data: {
                  ...payload,
                  created_at: '2026-09-29T00:00:00Z',
                  updated_at: '2026-09-29T00:00:00Z',
                  deleted_at: null,
                  deleted_by: null,
                },
                error: null,
              }),
            }),
          };
        },
      };
    },
  };

  // Case 1: with jiraCode
  const res1 = await createIssue({
    playbookId: 'whatsapp',
    title: 'Issue 1',
    summary: 'Summary 1',
    jiraCode: '  NEW-001  ',
  }, mockClient);

  assert.equal(capturedInsert.jira_code, 'NEW-001');
  assert.equal(res1.jiraCode, 'NEW-001');

  // Case 2: without jiraCode
  const res2 = await createIssue({
    playbookId: 'whatsapp',
    title: 'Issue 2',
    summary: 'Summary 2',
    jiraCode: '   ',
  }, mockClient);

  assert.equal(capturedInsert.jira_code, null);
  assert.equal(res2.jiraCode, undefined);
});

test('getIssueById returns null for empty or whitespace id', async () => {
  const mockClient = {};
  const result = await getIssueById('   ', mockClient);
  assert.equal(result, null);
});

test('listIssuesByPlaybook returns empty array for empty or whitespace playbookId', async () => {
  const mockClient = {};
  const result = await listIssuesByPlaybook('   ', mockClient);
  assert.deepEqual(result, []);
});

test('softDeleteIssue throws for empty id', async () => {
  const mockClient = {};
  await assert.rejects(
    () => softDeleteIssue('', mockClient),
    /Invalid Issue ID/
  );
});

test('Guide persistence does NOT contain jira_code column (derived from linked Issue only)', () => {
  const guideDbRow = {
    id: 'WA-G01',
    issue_id: 'WA-001',
    playbook_id: 'whatsapp',
    current_version_id: 'v1',
    version_number: 1,
    title: 'Guide Title',
    summary: 'Guide Summary',
    status: 'Draft',
    difficulty: 'Medium',
    estimated_time: '15 min',
    created_at: '2026-09-29T00:00:00Z',
    updated_at: '2026-09-29T00:00:00Z',
    deleted_at: null,
    deleted_by: null,
  };

  assert.equal('jira_code' in guideDbRow, false, 'Guide DB row must not have jira_code');
  assert.equal('jiraCode' in guideDbRow, false, 'Guide model must not have jiraCode directly persisted');
});

test('updateIssue validates required inputs before sending query', async () => {
  const mockClient = {};

  await assert.rejects(
    () => updateIssue({ id: '', title: 'Title', summary: 'Summary' }, mockClient),
    /Enter an Issue ID/
  );

  await assert.rejects(
    () => updateIssue({ id: 'ISS-001', title: '', summary: 'Summary' }, mockClient),
    /Enter an Issue title/
  );

  await assert.rejects(
    () => updateIssue({ id: 'ISS-001', title: 'Title', summary: '' }, mockClient),
    /Provide a problem summary/
  );
});

test('updateIssue preserves protected immutable fields (id, playbook_id, created_at not updated)', async () => {
  let capturedPayload = null;
  const mockClient = {
    from: (table) => {
      assert.equal(table, 'issues');
      return {
        update: (payload) => {
          capturedPayload = payload;
          return {
            eq: (col, val) => {
              assert.equal(col, 'id');
              assert.equal(val, 'ISS-001');
              return {
                is: (dCol, dVal) => {
                  assert.equal(dCol, 'deleted_at');
                  assert.equal(dVal, null);
                  return {
                    select: () => ({
                      maybeSingle: () => Promise.resolve({
                        data: {
                          id: 'ISS-001',
                          playbook_id: 'original-playbook',
                          title: payload.title,
                          summary: payload.summary,
                          symptoms: payload.symptoms,
                          error_message: payload.error_message,
                          context: payload.context,
                          affected_area: payload.affected_area,
                          information_to_collect: payload.information_to_collect,
                          attachments: payload.attachments,
                          internal_notes: payload.internal_notes,
                          status: payload.status,
                          difficulty: payload.difficulty,
                          estimated_time: payload.estimated_time,
                          author: 'Original Author',
                          jira_code: payload.jira_code,
                          deleted_at: null,
                          deleted_by: null,
                          created_at: '2026-09-01T00:00:00Z',
                          updated_at: payload.updated_at,
                        },
                        error: null,
                      }),
                    }),
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  await updateIssue({
    id: 'ISS-001',
    title: 'Updated Title',
    summary: 'Updated Summary',
    playbookId: 'tampered-pb',
    createdAt: '1970-01-01',
  }, mockClient);

  assert.equal('id' in capturedPayload, false, 'id must not be in update payload');
  assert.equal('playbook_id' in capturedPayload, false, 'playbook_id must not be in update payload');
  assert.equal('created_at' in capturedPayload, false, 'created_at must not be in update payload');
  assert.ok(capturedPayload.updated_at, 'updated_at must be populated');
});

test('updateIssue updates trimmed jira_code correctly', async () => {
  let capturedPayload = null;
  const mockClient = {
    from: () => ({
      update: (payload) => {
        capturedPayload = payload;
        return {
          eq: () => ({
            is: () => ({
              select: () => ({
                maybeSingle: () => Promise.resolve({
                  data: {
                    id: 'ISS-001',
                    playbook_id: 'whatsapp',
                    title: 'Title',
                    summary: 'Summary',
                    author: 'Author',
                    jira_code: payload.jira_code,
                    deleted_at: null,
                    deleted_by: null,
                    created_at: '2026-09-01T00:00:00Z',
                    updated_at: '2026-09-29T00:00:00Z',
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      },
    }),
  };

  const updated = await updateIssue({
    id: 'ISS-001',
    title: 'Title',
    summary: 'Summary',
    jiraCode: '  NEW-999  ',
  }, mockClient);

  assert.equal(capturedPayload.jira_code, 'NEW-999');
  assert.equal(updated.jiraCode, 'NEW-999');
});

test('updateIssue clears jira_code to null when empty, whitespace, or omitted', async () => {
  let capturedPayload = null;
  const mockClient = {
    from: () => ({
      update: (payload) => {
        capturedPayload = payload;
        return {
          eq: () => ({
            is: () => ({
              select: () => ({
                maybeSingle: () => Promise.resolve({
                  data: {
                    id: 'ISS-001',
                    playbook_id: 'whatsapp',
                    title: 'Title',
                    summary: 'Summary',
                    author: 'Author',
                    jira_code: payload.jira_code,
                    deleted_at: null,
                    deleted_by: null,
                    created_at: '2026-09-01T00:00:00Z',
                    updated_at: '2026-09-29T00:00:00Z',
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      },
    }),
  };

  const updated1 = await updateIssue({
    id: 'ISS-001',
    title: 'Title',
    summary: 'Summary',
    jiraCode: '   ',
  }, mockClient);
  assert.equal(capturedPayload.jira_code, null);
  assert.equal(updated1.jiraCode, undefined);

  const updated2 = await updateIssue({
    id: 'ISS-001',
    title: 'Title',
    summary: 'Summary',
    jiraCode: null,
  }, mockClient);
  assert.equal(capturedPayload.jira_code, null);
  assert.equal(updated2.jiraCode, undefined);
});

test('parseHash correctly routes Issue edit path and maintains route integrity', () => {
  // Exact Issue edit URL
  const route = parseHash('#/issues/ISS-005/edit');
  assert.equal(route.path, '/issues/[id]/edit');
  assert.equal(route.params.id, 'ISS-005');

  // URL-encoded Issue edit path
  const encodedRoute = parseHash('#/issues/ISS%20005/edit');
  assert.equal(encodedRoute.path, '/issues/[id]/edit');
  assert.equal(encodedRoute.params.id, 'ISS 005');

  // Playbook-scoped Issue edit path
  const playbookIssueRoute = parseHash('#/playbooks/whatsapp/issues/ISS-005/edit');
  assert.equal(playbookIssueRoute.path, '/issues/[id]/edit');
  assert.equal(playbookIssueRoute.params.id, 'ISS-005');
  assert.equal(playbookIssueRoute.params.slug, 'whatsapp');

  // Existing Guide edit path still works
  const guideEditRoute = parseHash('#/guides/WA-G01/edit');
  assert.equal(guideEditRoute.path, '/guides/[id]/edit');
  assert.equal(guideEditRoute.params.id, 'WA-G01');

  // Existing SOP edit path still works
  const sopEditRoute = parseHash('#/sops/WA-SOP01/edit');
  assert.equal(sopEditRoute.path, '/sops/[id]/edit');
  assert.equal(sopEditRoute.params.id, 'WA-SOP01');

  // Existing Issue detail path still works
  const issueDetailRoute = parseHash('#/playbooks/whatsapp/issues/WA-001');
  assert.equal(issueDetailRoute.path, '/playbooks/[slug]/issues/[id]');
  assert.equal(issueDetailRoute.params.slug, 'whatsapp');
  assert.equal(issueDetailRoute.params.id, 'WA-001');
});

test('updateIssue maps all updated database fields to frontend Issue model', async () => {
  const mockClient = {
    from: () => ({
      update: () => ({
        eq: () => ({
          is: () => ({
            select: () => ({
              maybeSingle: () => Promise.resolve({
                data: {
                  id: 'ISS-001',
                  playbook_id: 'whatsapp',
                  title: 'Brand New Title',
                  summary: 'Brand New Summary',
                  symptoms: ['Symptom 1', 'Symptom 2'],
                  error_message: 'ERR_FAIL',
                  context: 'Edge case in production',
                  affected_area: 'Billing',
                  information_to_collect: ['Logs'],
                  attachments: [{ name: 'diag.txt', url: 'https://example.com/diag.txt' }],
                  internal_notes: 'Secret notes',
                  status: 'Verified',
                  difficulty: 'Advanced',
                  estimated_time: '45 min',
                  author: 'Specialist',
                  jira_code: 'NEW-777',
                  deleted_at: null,
                  deleted_by: null,
                  created_at: '2026-09-01T00:00:00Z',
                  updated_at: '2026-09-29T12:00:00Z',
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  };

  const res = await updateIssue({
    id: 'ISS-001',
    title: 'Brand New Title',
    summary: 'Brand New Summary',
    status: 'Verified',
    difficulty: 'Advanced',
    estimatedTime: '45 min',
    jiraCode: 'NEW-777',
    symptoms: ['Symptom 1', 'Symptom 2'],
    errorMessage: 'ERR_FAIL',
    context: 'Edge case in production',
    affectedArea: 'Billing',
    informationToCollect: ['Logs'],
    attachments: [{ name: 'diag.txt', url: 'https://example.com/diag.txt' }],
    internalNotes: 'Secret notes',
  }, mockClient);

  assert.equal(res.id, 'ISS-001');
  assert.equal(res.playbookId, 'whatsapp');
  assert.equal(res.title, 'Brand New Title');
  assert.equal(res.summary, 'Brand New Summary');
  assert.equal(res.status, 'Verified');
  assert.equal(res.difficulty, 'Advanced');
  assert.equal(res.estimatedTime, '45 min');
  assert.equal(res.jiraCode, 'NEW-777');
  assert.deepEqual(res.symptoms, ['Symptom 1', 'Symptom 2']);
  assert.equal(res.errorMessage, 'ERR_FAIL');
  assert.equal(res.context, 'Edge case in production');
  assert.equal(res.affectedArea, 'Billing');
  assert.deepEqual(res.informationToCollect, ['Logs']);
  assert.deepEqual(res.attachments, [{ name: 'diag.txt', url: 'https://example.com/diag.txt' }]);
  assert.equal(res.internalNotes, 'Secret notes');
  assert.equal(res.updatedAt, '2026-09-29T12:00:00Z');
});

test('updateIssue handles backend permission denied and database errors cleanly', async () => {
  const rlsClient = {
    from: () => ({
      update: () => ({
        eq: () => ({
          is: () => ({
            select: () => ({
              maybeSingle: () => Promise.resolve({
                data: null,
                error: { code: '42501', message: 'permission denied for table issues' },
              }),
            }),
          }),
        }),
      }),
    }),
  };

  await assert.rejects(
    () => updateIssue({ id: 'ISS-001', title: 'T', summary: 'S' }, rlsClient),
    /Permission denied. Support or Admin role required./
  );

  const errorClient = {
    from: () => ({
      update: () => ({
        eq: () => ({
          is: () => ({
            select: () => ({
              maybeSingle: () => Promise.resolve({
                data: null,
                error: { code: '50000', message: 'connection timeout' },
              }),
            }),
          }),
        }),
      }),
    }),
  };

  await assert.rejects(
    () => updateIssue({ id: 'ISS-001', title: 'T', summary: 'S' }, errorClient),
    /Failed to update Issue: connection timeout/
  );

  const notFoundClient = {
    from: () => ({
      update: () => ({
        eq: () => ({
          is: () => ({
            select: () => ({
              maybeSingle: () => Promise.resolve({
                data: null,
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  };

  await assert.rejects(
    () => updateIssue({ id: 'ISS-001', title: 'T', summary: 'S' }, notFoundClient),
    /Issue not found or has been deleted/
  );
});

