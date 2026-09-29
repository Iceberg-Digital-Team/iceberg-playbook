import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dummy.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key-for-unit-tests';

import { importTs } from './helpers/transpile.mjs';

const mockPlaybooks = [
  {
    id: 'whatsapp',
    slug: 'whatsapp',
    name: 'WhatsApp Business',
    code: 'WA',
    description: 'WhatsApp onboarding and troubleshooting',
    icon: 'MessageSquare',
    owner: 'Support Team',
    visibility: 'Internal',
    created_at: '2026-09-27T00:00:00Z',
    updated_at: '2026-09-27T00:00:00Z',
    deleted_at: null,
    deleted_by: null,
  },
  {
    id: 'meta-business',
    slug: 'meta-business',
    name: 'Meta Business Manager',
    code: 'META',
    description: 'Portfolios, system users and access management',
    icon: 'Briefcase',
    owner: 'Admin Team',
    visibility: 'Internal',
    created_at: '2026-09-27T00:00:00Z',
    updated_at: '2026-09-27T00:00:00Z',
    deleted_at: null,
    deleted_by: null,
  }
];

const mockIssues = [
  {
    id: 'WA-001',
    playbook_id: 'whatsapp',
    title: 'Phone Number Already Registered',
    summary: 'Customer unable to register business number due to collision',
    symptoms: ['Registration error'],
    error_message: 'ERR_NUMBER_IN_USE',
    context: 'During onboarding signup',
    affected_area: 'Account Setup',
    information_to_collect: ['Screenshot'],
    attachments: [],
    internal_notes: '',
    status: 'Verified',
    difficulty: 'Medium',
    estimated_time: '15 min',
    author: 'Support Team',
    created_at: '2026-09-28T09:00:00Z',
    updated_at: '2026-09-28T12:00:00Z',
    deleted_at: null,
    deleted_by: null,
  },
  {
    id: 'META-001',
    playbook_id: 'meta-business',
    title: '2FA Reset Required',
    summary: 'Admin unable to authenticate',
    symptoms: ['No OTP'],
    error_message: null,
    context: 'Login',
    affected_area: 'Auth',
    information_to_collect: [],
    attachments: [],
    internal_notes: '',
    status: 'Verified',
    difficulty: 'Easy',
    estimated_time: '10 min',
    author: 'Admin Team',
    created_at: '2026-09-28T07:00:00Z',
    updated_at: '2026-09-28T08:00:00Z',
    deleted_at: null,
    deleted_by: null,
  }
];

const mockGuides = [
  {
    id: 'WA-G01',
    issue_id: 'WA-001',
    playbook_id: 'whatsapp',
    current_version_id: 'WA-G01:v1',
    version_number: 1,
    title: 'How to Resolve Registration Failure',
    summary: 'Step-by-step resolution for registered phone numbers',
    status: 'Verified',
    difficulty: 'Medium',
    estimated_time: '20 min',
    before_you_start: [],
    requirements: [],
    important_information: '',
    video: '',
    pdf: '',
    steps: [{ number: 1, title: 'Release number', description: 'Disconnect previous WABA.' }],
    common_problems: [],
    faq: [],
    related_items: [],
    internal_notes: '',
    revision_history: [],
    author: 'Support Team',
    created_by: 'Support Team',
    updated_by: 'Support Team',
    created_at: '2026-09-28T10:00:00Z',
    updated_at: '2026-09-28T15:00:00Z',
    deleted_at: null,
    deleted_by: null,
  }
];

const mockSops = [
  {
    id: 'WA-SOP01',
    playbook_id: 'whatsapp',
    title: 'Customer Onboarding Workflow',
    owner: 'Onboarding Team',
    status: 'Verified',
    estimated_time: '45 min',
    purpose: 'Standard procedure for onboarding new customer phone accounts',
    when_to_use: 'When a new client signs up for WhatsApp API',
    requirements: [],
    responsible_team: 'Onboarding Operations',
    checklist: [],
    steps: [{ number: 1, title: 'Send invitation', description: 'Trigger onboarding link.' }],
    escalation_rules: 'Escalate to Tier 2',
    completion_criteria: 'Active webhook received',
    related_issues: ['WA-001'],
    related_guides: ['WA-G01'],
    internal_notes: '',
    revision_history: [],
    created_at: '2026-09-28T09:30:00Z',
    updated_at: '2026-09-28T10:00:00Z',
    deleted_at: null,
    deleted_by: null,
  }
];

function createMockSupabaseClient(overrides = {}) {
  const isFilters = {};
  const queriedTables = [];

  return {
    client: {
      from: (table) => {
        queriedTables.push(table);
        return {
          select: () => ({
            is: (field, val) => {
              isFilters[table] = { field, val };
              return {
                order: () => {
                  if (overrides[table]?.error) {
                    return Promise.resolve({ data: null, error: overrides[table].error });
                  }
                  if (table === 'playbooks') return Promise.resolve({ data: overrides.playbooks?.data ?? mockPlaybooks, error: null });
                  if (table === 'issues') return Promise.resolve({ data: overrides.issues?.data ?? mockIssues, error: null });
                  if (table === 'guides') return Promise.resolve({ data: overrides.guides?.data ?? mockGuides, error: null });
                  if (table === 'sops') return Promise.resolve({ data: overrides.sops?.data ?? mockSops, error: null });
                  return Promise.resolve({ data: [], error: null });
                }
              };
            }
          })
        };
      }
    },
    isFilters,
    queriedTables
  };
}

test('Supabase recent-content aggregation combines active Issues, Guides, and SOPs', async () => {
  const { listRecentSolutions } = await importTs('src/services/homeService.ts', 'home-service');
  const { client } = createMockSupabaseClient();

  const recent = await listRecentSolutions(client);

  assert.equal(recent.length, 4);
  const types = recent.map(r => r.type);
  assert.ok(types.includes('Issue'));
  assert.ok(types.includes('Guide'));
  assert.ok(types.includes('SOP'));

  for (const item of recent) {
    assert.ok(item.id, 'Item must have an id');
    assert.ok(item.title, 'Item must have a title');
    assert.ok(item.type, 'Item must have a type');
    assert.ok(item.folder, 'Item must have a folder');
    assert.ok(item.playbookId, 'Item must have a playbookId');
    assert.ok(item.playbookSlug, 'Item must have a playbookSlug');
    assert.ok(item.href, 'Item must have a href');
    assert.ok(item.updatedAt, 'Item must have an updatedAt');
  }
});

test('timestamp ordering sorts recent content newest first by updatedAt', async () => {
  const { listRecentSolutions } = await importTs('src/services/homeService.ts', 'home-service');
  const { client } = createMockSupabaseClient();

  const recent = await listRecentSolutions(client);

  // Expected timestamps:
  // 1. WA-G01: 2026-09-28T15:00:00Z (Guide)
  // 2. WA-001: 2026-09-28T12:00:00Z (Issue)
  // 3. WA-SOP01: 2026-09-28T10:00:00Z (SOP)
  // 4. META-001: 2026-09-28T08:00:00Z (Issue)
  assert.equal(recent[0].id, 'WA-G01');
  assert.equal(recent[0].type, 'Guide');
  assert.equal(recent[1].id, 'WA-001');
  assert.equal(recent[1].type, 'Issue');
  assert.equal(recent[2].id, 'WA-SOP01');
  assert.equal(recent[2].type, 'SOP');
  assert.equal(recent[3].id, 'META-001');
  assert.equal(recent[3].type, 'Issue');

  // Verify non-increasing timestamps
  for (let i = 0; i < recent.length - 1; i++) {
    const curr = Date.parse(recent[i].updatedAt);
    const next = Date.parse(recent[i + 1].updatedAt);
    assert.ok(curr >= next, `Expected ${recent[i].id} (${recent[i].updatedAt}) >= ${recent[i + 1].id} (${recent[i + 1].updatedAt})`);
  }
});

test('route generation correctly resolves parent playbook slug for Issue, Guide, and SOP', async () => {
  const { listRecentSolutions } = await importTs('src/services/homeService.ts', 'home-service');
  const { client } = createMockSupabaseClient();

  const recent = await listRecentSolutions(client);

  const guideItem = recent.find(r => r.id === 'WA-G01');
  assert.equal(guideItem.href, '#/playbooks/whatsapp/guides/WA-G01');
  assert.equal(guideItem.folder, 'guides');

  const issueItem = recent.find(r => r.id === 'WA-001');
  assert.equal(issueItem.href, '#/playbooks/whatsapp/issues/WA-001');
  assert.equal(issueItem.folder, 'issues');

  const metaIssue = recent.find(r => r.id === 'META-001');
  assert.equal(metaIssue.href, '#/playbooks/meta-business/issues/META-001');
  assert.equal(metaIssue.folder, 'issues');

  const sopItem = recent.find(r => r.id === 'WA-SOP01');
  assert.equal(sopItem.href, '#/playbooks/whatsapp/sops/WA-SOP01');
  assert.equal(sopItem.folder, 'sops');
});

test('active-only behavior filters out soft-deleted records and orphaned items', async () => {
  const { listRecentSolutions } = await importTs('src/services/homeService.ts', 'home-service');
  const { client, isFilters } = createMockSupabaseClient({
    issues: {
      data: [
        ...mockIssues,
        // Orphaned item pointing to nonexistent / soft-deleted playbook
        {
          id: 'ORPHAN-001',
          playbook_id: 'deleted-playbook',
          title: 'Orphan Issue',
          summary: 'Should not appear',
          symptoms: [],
          error_message: null,
          context: '',
          affected_area: '',
          information_to_collect: [],
          attachments: [],
          internal_notes: '',
          status: 'Verified',
          difficulty: 'Easy',
          estimated_time: '5 min',
          author: 'Test',
          created_at: '2026-09-28T16:00:00Z',
          updated_at: '2026-09-28T16:00:00Z',
          deleted_at: null,
          deleted_by: null,
        }
      ]
    }
  });

  const recent = await listRecentSolutions(client);

  // All tables must query with deleted_at IS NULL
  assert.deepEqual(isFilters['playbooks'], { field: 'deleted_at', val: null });
  assert.deepEqual(isFilters['issues'], { field: 'deleted_at', val: null });
  assert.deepEqual(isFilters['guides'], { field: 'deleted_at', val: null });
  assert.deepEqual(isFilters['sops'], { field: 'deleted_at', val: null });

  // Orphan item must be excluded because parent playbook cannot be resolved
  assert.ok(!recent.some(r => r.id === 'ORPHAN-001'));
});

test('Troubleshooting is excluded from Home recent content queries and results', async () => {
  const { listRecentSolutions } = await importTs('src/services/homeService.ts', 'home-service');
  const { client, queriedTables } = createMockSupabaseClient();

  const recent = await listRecentSolutions(client);

  assert.ok(!queriedTables.includes('troubleshooting'), 'Troubleshooting table must not be queried');
  assert.ok(!recent.some(r => r.type === 'Troubleshooting'), 'Troubleshooting type must not exist in recent items');
});

test('error handling rejects cleanly without falling back to localStorage or sampleData', async () => {
  const { listRecentSolutions } = await importTs('src/services/homeService.ts', 'home-service');
  const { client } = createMockSupabaseClient({
    issues: { error: { message: 'Database connection failed' } }
  });

  await assert.rejects(
    () => listRecentSolutions(client),
    /Failed to load Issues|Database connection failed/
  );
});
