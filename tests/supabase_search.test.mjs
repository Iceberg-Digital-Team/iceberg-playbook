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
    symptoms: ['Registration error', 'Code not received'],
    error_message: 'ERR_NUMBER_IN_USE',
    context: 'During onboarding signup',
    affected_area: 'Account Setup',
    information_to_collect: ['Screenshot of error'],
    attachments: [],
    internal_notes: 'Support notes',
    status: 'Verified',
    difficulty: 'Medium',
    estimated_time: '15 min',
    author: 'Support Team',
    created_at: '2026-09-27T00:00:00Z',
    updated_at: '2026-09-27T00:00:00Z',
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
    before_you_start: ['Check business manager'],
    requirements: ['Admin access'],
    important_information: 'Do not repeat SMS request.',
    video: '',
    video_storage_key: null,
    pdf: '',
    pdf_storage_key: null,
    steps: [{ number: 1, title: 'Release old number', description: 'Delete or disconnect previous WABA.' }],
    common_problems: [{ problem: 'OTP timeout', cause: 'Rate limiting', solution: 'Wait 10 min' }],
    faq: [],
    related_items: [],
    internal_notes: '',
    revision_history: [],
    author: 'Support Team',
    created_by: 'Support Team',
    updated_by: 'Support Team',
    created_at: '2026-09-27T00:00:00Z',
    updated_at: '2026-09-27T00:00:00Z',
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
    requirements: ['Verified account'],
    responsible_team: 'Onboarding Operations',
    checklist: ['Verify email', 'Setup webhook'],
    steps: [{ number: 1, title: 'Send invitation', description: 'Trigger onboarding link.' }],
    escalation_rules: 'Escalate to Tier 2',
    completion_criteria: 'Active webhook received',
    related_issues: ['WA-001'],
    related_guides: ['WA-G01'],
    internal_notes: '',
    revision_history: [],
    created_at: '2026-09-27T00:00:00Z',
    updated_at: '2026-09-27T00:00:00Z',
    deleted_at: null,
    deleted_by: null,
  }
];

function createMockSupabaseClient() {
  const isFilters = {};

  return {
    client: {
      from: (table) => ({
        select: () => ({
          is: (field, val) => {
            isFilters[table] = { field, val };
            return {
              order: () => {
                if (table === 'playbooks') return Promise.resolve({ data: mockPlaybooks, error: null });
                if (table === 'issues') return Promise.resolve({ data: mockIssues, error: null });
                if (table === 'guides') return Promise.resolve({ data: mockGuides, error: null });
                if (table === 'sops') return Promise.resolve({ data: mockSops, error: null });
                return Promise.resolve({ data: [], error: null });
              }
            };
          }
        })
      })
    },
    isFilters
  };
}

test('getSearchData aggregates live Supabase data and filters deleted_at is null across all tables', async () => {
  const { getSearchData } = await importTs('src/search/dataSource.ts', 'search-datasource');
  const { client, isFilters } = createMockSupabaseClient();

  const data = await getSearchData(client);

  assert.equal(data.playbooks.length, 2);
  assert.equal(data.issues.length, 1);
  assert.equal(data.guides.length, 1);
  assert.equal(data.sops.length, 1);

  // Soft-deleted check: every domain query must check deleted_at IS NULL
  assert.deepEqual(isFilters['playbooks'], { field: 'deleted_at', val: null });
  assert.deepEqual(isFilters['issues'], { field: 'deleted_at', val: null });
  assert.deepEqual(isFilters['guides'], { field: 'deleted_at', val: null });
  assert.deepEqual(isFilters['sops'], { field: 'deleted_at', val: null });
});

test('executeSearch matches query across Playbooks, Issues, Guides, and SOPs', async () => {
  const { executeSearch } = await importTs('src/search/searchService.ts', 'search-service');
  const { getItemType } = await importTs('src/search/searchCore.ts', 'search-core');
  const { client } = createMockSupabaseClient();
  const { getSearchData } = await importTs('src/search/dataSource.ts', 'search-datasource');
  const data = await getSearchData(client);

  // 1. Search Playbook by code
  const pbCodeResults = executeSearch('META', data);
  assert.ok(pbCodeResults.some(r => r.id === 'meta-business' && getItemType(r) === 'Playbooks'));

  // 2. Search Playbook by description
  const pbDescResults = executeSearch('troubleshooting', data);
  assert.ok(pbDescResults.some(r => r.id === 'whatsapp' && getItemType(r) === 'Playbooks'));

  // 3. Search Issue by error message
  const issueResults = executeSearch('ERR_NUMBER_IN_USE', data);
  assert.ok(issueResults.some(r => r.id === 'WA-001' && getItemType(r) === 'Issues'));

  // 4. Search Guide by step description
  const guideResults = executeSearch('disconnect previous WABA', data);
  assert.ok(guideResults.some(r => r.id === 'WA-G01' && getItemType(r) === 'Guides'));

  // 5. Search SOP by responsible team
  const sopResults = executeSearch('Onboarding Operations', data);
  assert.ok(sopResults.some(r => r.id === 'WA-SOP01' && getItemType(r) === 'SOPs'));
});

test('Search result types are strictly limited to Playbook, Issue, Guide, SOP (Troubleshooting excluded)', async () => {
  const { executeSearch } = await importTs('src/search/searchService.ts', 'search-service');
  const { getItemType } = await importTs('src/search/searchCore.ts', 'search-core');
  const { client } = createMockSupabaseClient();
  const { getSearchData } = await importTs('src/search/dataSource.ts', 'search-datasource');
  const data = await getSearchData(client);

  const allResults = executeSearch('', data);
  const types = new Set(allResults.map(r => getItemType(r)));

  for (const t of types) {
    assert.ok(
      ['Playbooks', 'Issues', 'Guides', 'SOPs'].includes(t),
      `Unexpected result type in search pipeline: ${t}`
    );
  }

  // Ensure no troubleshooting items exist in the search output
  assert.ok(!types.has('Troubleshooting'));
});

test('Search filters by type and playbookId correctly', async () => {
  const { executeSearch } = await importTs('src/search/searchService.ts', 'search-service');
  const { getItemType } = await importTs('src/search/searchCore.ts', 'search-core');
  const { client } = createMockSupabaseClient();
  const { getSearchData } = await importTs('src/search/dataSource.ts', 'search-datasource');
  const data = await getSearchData(client);

  // Filter type = 'Playbooks'
  const playbooksOnly = executeSearch('', data, { type: 'Playbooks' });
  assert.ok(playbooksOnly.length > 0);
  assert.ok(playbooksOnly.every(r => getItemType(r) === 'Playbooks'));

  // Filter type = 'Issues'
  const issuesOnly = executeSearch('', data, { type: 'Issues' });
  assert.ok(issuesOnly.length > 0);
  assert.ok(issuesOnly.every(r => getItemType(r) === 'Issues'));

  // Filter by playbookId = 'meta-business'
  const metaOnly = executeSearch('', data, { playbookId: 'meta-business' });
  assert.ok(metaOnly.every(r => r.id === 'meta-business' || ('playbookId' in r && r.playbookId === 'meta-business')));
});

test('Search error handling rejects cleanly when Supabase query fails without falling back to localStorage', async () => {
  const { getSearchData } = await importTs('src/search/dataSource.ts', 'search-datasource');
  const failingClient = {
    from: () => ({
      select: () => ({
        is: () => ({
          order: () => Promise.resolve({ data: null, error: { message: 'Database connection failed' } })
        })
      })
    })
  };

  await assert.rejects(
    () => getSearchData(failingClient),
    /Failed to load|Database connection failed/
  );
});
