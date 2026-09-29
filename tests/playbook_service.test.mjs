import { test } from 'node:test';
import assert from 'node:assert/strict';

// Provide dummy env for transpiler module loading in test environment
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dummy.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key-for-unit-tests';

import { importTs } from './helpers/transpile.mjs';

const {
  mapPlaybookRowToPlaybook,
  createPlaybook,
  getPlaybookBySlug,
  softDeletePlaybook,
  aggregatePlaybookCounts,
  listPlaybooks,
} = await importTs('src/services/playbookService.ts', 'playbook-service');

test('mapPlaybookRowToPlaybook correctly maps database fields to frontend playbook shape', async () => {
  const dbRow = {
    id: 'whatsapp',
    slug: 'whatsapp',
    name: 'WhatsApp',
    code: 'WA',
    description: 'WhatsApp support playbook',
    icon: 'MessageSquare',
    owner: 'Support Team',
    visibility: 'Internal',
    created_at: '2026-09-27T00:00:00Z',
    updated_at: '2026-09-27T00:00:00Z',
    deleted_at: null,
    deleted_by: null,
  };

  const playbook = mapPlaybookRowToPlaybook(dbRow);
  assert.equal(playbook.id, 'whatsapp');
  assert.equal(playbook.slug, 'whatsapp');
  assert.equal(playbook.name, 'WhatsApp');
  assert.equal(playbook.code, 'WA');
  assert.equal(playbook.description, 'WhatsApp support playbook');
  assert.equal(playbook.icon, 'MessageSquare');
  assert.equal(playbook.owner, 'Support Team');
  assert.equal(playbook.visibility, 'Internal');
  assert.equal(playbook.updatedAt, '2026-09-27T00:00:00Z');
  assert.equal(playbook.issueCount, 0);
  assert.equal(playbook.guideCount, 0);
  assert.equal(playbook.sopCount, 0);
});

test('createPlaybook validates required inputs before sending query', async () => {
  const mockClient = {};

  await assert.rejects(
    () => createPlaybook({ name: '', code: 'WA', description: 'Desc' }, mockClient),
    /Enter a valid Playbook name/
  );

  await assert.rejects(
    () => createPlaybook({ name: 'Test', code: '', description: 'Desc' }, mockClient),
    /Enter a code prefix/
  );

  await assert.rejects(
    () => createPlaybook({ name: 'Test', code: 'W', description: 'Desc' }, mockClient),
    /Code prefix must be 2 to 5 alphanumeric characters/
  );

  await assert.rejects(
    () => createPlaybook({ name: 'Test', code: 'TOOLONGPREFIX', description: 'Desc' }, mockClient),
    /Code prefix must be 2 to 5 alphanumeric characters/
  );

  await assert.rejects(
    () => createPlaybook({ name: 'Test', code: 'WA-1', description: 'Desc' }, mockClient),
    /Code prefix must be 2 to 5 alphanumeric characters/
  );

  await assert.rejects(
    () => createPlaybook({ name: 'Test', code: 'WA', description: '' }, mockClient),
    /Enter a description/
  );
});

test('getPlaybookBySlug returns null for empty or whitespace slug', async () => {
  const mockClient = {};
  const result = await getPlaybookBySlug('   ', mockClient);
  assert.equal(result, null);
});

test('softDeletePlaybook throws for empty id', async () => {
  const mockClient = {};
  await assert.rejects(
    () => softDeletePlaybook('', mockClient),
    /Invalid Playbook ID/
  );
});

test('aggregatePlaybookCounts correctly aggregates counts, excludes soft-deleted items, and isolates playbooks', async () => {

  const issues = [
    { playbook_id: 'pb-1', deleted_at: null }, // active issue -> count = 1
    { playbook_id: 'pb-1', deleted_at: '2026-09-28T00:00:00Z' }, // soft-deleted -> excluded
    { playbook_id: 'pb-2', deleted_at: null }, // different playbook -> excluded from pb-1
  ];
  const guides = [
    { playbook_id: 'pb-1', deleted_at: null }, // active guide 1
    { playbook_id: 'pb-1', deleted_at: null }, // active guide 2
    { playbook_id: 'pb-1', deleted_at: '2026-09-29T00:00:00Z' }, // soft-deleted -> excluded
  ];
  const sops = [
    { playbook_id: 'pb-1', deleted_at: null }, // active sop
    { playbook_id: 'pb-3', deleted_at: null }, // different playbook
  ];

  const counts = aggregatePlaybookCounts(issues, guides, sops);

  // pb-1 has multiple child types: 1 active issue, 2 active guides, 1 active sop
  assert.equal(counts['pb-1'].issueCount, 1);
  assert.equal(counts['pb-1'].activeIssuesCount, 1);
  assert.equal(counts['pb-1'].guideCount, 2);
  assert.equal(counts['pb-1'].activeGuidesCount, 2);
  assert.equal(counts['pb-1'].sopCount, 1);
  assert.equal(counts['pb-1'].activeSopsCount, 1);

  // pb-2 has 1 issue, 0 guides, 0 sops
  assert.equal(counts['pb-2'].issueCount, 1);
  assert.equal(counts['pb-2'].guideCount, 0);
  assert.equal(counts['pb-2'].sopCount, 0);

  // pb-3 has 0 issues, 0 guides, 1 sop
  assert.equal(counts['pb-3'].issueCount, 0);
  assert.equal(counts['pb-3'].guideCount, 0);
  assert.equal(counts['pb-3'].sopCount, 1);

  // Unmentioned playbook has no entry
  assert.equal(counts['pb-zero'], undefined);
});

test('listPlaybooks integrates live child counts from Supabase and handles zero-content and soft-delete', async () => {
  const mockDbPlaybooks = [
    {
      id: 'pb-active',
      slug: 'pb-active',
      name: 'Active Playbook',
      code: 'ACT',
      description: 'Active playbook',
      icon: 'MessageSquare',
      owner: 'Support',
      visibility: 'Internal',
      created_at: '2026-09-27T00:00:00Z',
      updated_at: '2026-09-27T00:00:00Z',
      deleted_at: null,
      deleted_by: null,
    },
    {
      id: 'pb-zero',
      slug: 'pb-zero',
      name: 'Zero Playbook',
      code: 'ZERO',
      description: 'Zero content playbook',
      icon: 'Briefcase',
      owner: 'Support',
      visibility: 'Internal',
      created_at: '2026-09-27T00:00:00Z',
      updated_at: '2026-09-27T00:00:00Z',
      deleted_at: null,
      deleted_by: null,
    }
  ];

  const mockDbIssues = [
    { playbook_id: 'pb-active', deleted_at: null }, // active issue -> Issue count = 1
    { playbook_id: 'pb-active', deleted_at: '2026-09-29T10:00:00Z' }, // soft-deleted -> excluded
    { playbook_id: 'pb-other', deleted_at: null }, // different playbook -> excluded
  ];

  const mockDbGuides = [
    { playbook_id: 'pb-active', deleted_at: null }, // active guide -> Guide count = 1
  ];

  const mockDbSops = [
    { playbook_id: 'pb-active', deleted_at: null }, // active sop 1
    { playbook_id: 'pb-active', deleted_at: null }, // active sop 2 -> SOP count = 2
    { playbook_id: 'pb-active', deleted_at: '2026-09-29T12:00:00Z' }, // soft-deleted -> excluded
  ];

  const mockClient = {
    from: (table) => ({
      select: () => ({
        is: (field, val) => {
          assert.equal(field, 'deleted_at');
          assert.equal(val, null);
          return {
            order: () => {
              if (table === 'playbooks') return Promise.resolve({ data: mockDbPlaybooks, error: null });
              if (table === 'issues') return Promise.resolve({ data: mockDbIssues, error: null });
              if (table === 'guides') return Promise.resolve({ data: mockDbGuides, error: null });
              if (table === 'sops') return Promise.resolve({ data: mockDbSops, error: null });
              return Promise.resolve({ data: [], error: null });
            }
          };
        }
      })
    })
  };

  const playbooks = await listPlaybooks(mockClient);
  assert.equal(playbooks.length, 2);

  // Active Playbook has active counts derived correctly
  const activePb = playbooks.find(p => p.id === 'pb-active');
  assert.ok(activePb);
  assert.equal(activePb.issueCount, 1);
  assert.equal(activePb.activeIssuesCount, 1);
  assert.equal(activePb.guideCount, 1);
  assert.equal(activePb.activeGuidesCount, 1);
  assert.equal(activePb.sopCount, 2);
  assert.equal(activePb.activeSopsCount, 2);

  // Zero Playbook has all zeros
  const zeroPb = playbooks.find(p => p.id === 'pb-zero');
  assert.ok(zeroPb);
  assert.equal(zeroPb.issueCount, 0);
  assert.equal(zeroPb.activeIssuesCount, 0);
  assert.equal(zeroPb.guideCount, 0);
  assert.equal(zeroPb.activeGuidesCount, 0);
  assert.equal(zeroPb.sopCount, 0);
  assert.equal(zeroPb.activeSopsCount, 0);
});

test('listPlaybooks error handling rejects cleanly without falling back to localStorage or sample data', async () => {
  const failingClient = {
    from: () => ({
      select: () => ({
        is: () => ({
          order: () => Promise.resolve({ data: null, error: { message: 'Database query failed' } })
        })
      })
    })
  };

  await assert.rejects(
    () => listPlaybooks(failingClient),
    /Database query failed|Failed to load/
  );
});
