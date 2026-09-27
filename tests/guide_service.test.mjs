import { test } from 'node:test';
import assert from 'node:assert/strict';

// Provide dummy env for transpiler module loading in test environment
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dummy.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key-for-unit-tests';

import { importTs } from './helpers/transpile.mjs';

test('mapGuideRowToGuide correctly maps database fields to frontend VersionedGuide shape', async () => {
  const { mapGuideRowToGuide } = await importTs('src/services/guideService.ts', 'guide-service');
  const dbRow = {
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
    before_you_start: ['Check business manager', 'Verify phone number'],
    requirements: ['Admin access'],
    important_information: 'Do not repeat SMS request more than 3 times.',
    video: 'https://example.com/video.mp4',
    video_storage_key: null,
    pdf: 'https://example.com/guide.pdf',
    pdf_storage_key: null,
    steps: [{ number: 1, title: 'Check phone status', description: 'Open portal and check phone.' }],
    common_problems: [{ problem: 'SMS timeout', cause: 'Network issue', solution: 'Wait 5 minutes' }],
    faq: [{ question: 'Can I retry?', answer: 'Yes, after 1 hour.' }],
    related_items: ['WA-002'],
    internal_notes: 'Support notes',
    revision_history: [],
    author: 'Development Support',
    created_by: 'Development Support',
    updated_by: 'Development Support',
    deleted_at: null,
    deleted_by: null,
    created_at: '2026-09-27T00:00:00Z',
    updated_at: '2026-09-27T01:00:00Z',
  };

  const guide = mapGuideRowToGuide(dbRow);
  assert.equal(guide.id, 'WA-G01');
  assert.equal(guide.issueId, 'WA-001');
  assert.equal(guide.playbookId, 'whatsapp');
  assert.equal(guide.currentVersionId, 'WA-G01:v1');
  assert.equal(guide.versionNumber, 1);
  assert.equal(guide.title, 'How to Resolve Registration Failure');
  assert.equal(guide.summary, 'Step-by-step resolution for registered phone numbers');
  assert.equal(guide.status, 'Verified');
  assert.equal(guide.difficulty, 'Medium');
  assert.equal(guide.estimatedTime, '20 min');
  assert.deepEqual(guide.beforeYouStart, ['Check business manager', 'Verify phone number']);
  assert.deepEqual(guide.requirements, ['Admin access']);
  assert.equal(guide.importantInformation, 'Do not repeat SMS request more than 3 times.');
  assert.equal(guide.video, 'https://example.com/video.mp4');
  assert.equal(guide.pdf, 'https://example.com/guide.pdf');
  assert.deepEqual(guide.steps, [{ number: 1, title: 'Check phone status', description: 'Open portal and check phone.' }]);
  assert.deepEqual(guide.commonProblems, [{ problem: 'SMS timeout', cause: 'Network issue', solution: 'Wait 5 minutes' }]);
  assert.deepEqual(guide.faq, [{ question: 'Can I retry?', answer: 'Yes, after 1 hour.' }]);
  assert.deepEqual(guide.relatedItems, ['WA-002']);
  assert.equal(guide.internalNotes, 'Support notes');
  assert.equal(guide.author, 'Development Support');
  assert.equal(guide.createdBy, 'Development Support');
  assert.equal(guide.updatedBy, 'Development Support');
  assert.equal(guide.createdAt, '2026-09-27T00:00:00Z');
  assert.equal(guide.updatedAt, '2026-09-27T01:00:00Z');
});

test('createGuide validates required fields before making RPC call', async () => {
  const { createGuide } = await importTs('src/services/guideService.ts', 'guide-service');
  const mockClient = {};

  await assert.rejects(
    () => createGuide({ issueId: '', playbookId: 'whatsapp', title: 'T', summary: 'S', steps: [{ title: '1', description: '1' }] }, mockClient),
    /Select an existing Related Issue/
  );

  await assert.rejects(
    () => createGuide({ issueId: 'WA-001', playbookId: '', title: 'T', summary: 'S', steps: [{ title: '1', description: '1' }] }, mockClient),
    /The Guide must use its Issue’s Playbook/
  );

  await assert.rejects(
    () => createGuide({ issueId: 'WA-001', playbookId: 'whatsapp', title: '', summary: 'S', steps: [{ title: '1', description: '1' }] }, mockClient),
    /Add a Guide title, summary, and complete solution steps/
  );

  await assert.rejects(
    () => createGuide({ issueId: 'WA-001', playbookId: 'whatsapp', title: 'T', summary: 'S', steps: [] }, mockClient),
    /Add a Guide title, summary, and complete solution steps/
  );

  await assert.rejects(
    () => createGuide({ issueId: 'WA-001', playbookId: 'whatsapp', title: 'T', summary: 'S', steps: [{ title: '', description: 'desc' }] }, mockClient),
    /Add a Guide title, summary, and complete solution steps/
  );
});

test('createGuide invokes fn_create_guide RPC and maps result', async () => {
  const { createGuide } = await importTs('src/services/guideService.ts', 'guide-service');

  let rpcMethod = '';
  let rpcParams = null;

  const mockClient = {
    rpc: async (fn, params) => {
      rpcMethod = fn;
      rpcParams = params;
      return {
        data: {
          id: 'WA-G01',
          issue_id: params.p_issue_id,
          playbook_id: params.p_playbook_id,
          current_version_id: 'WA-G01:v1',
          version_number: 1,
          title: params.p_content.title,
          summary: params.p_content.summary,
          status: params.p_content.status,
          difficulty: params.p_content.difficulty,
          estimated_time: params.p_content.estimatedTime,
          before_you_start: params.p_content.beforeYouStart,
          requirements: params.p_content.requirements,
          important_information: params.p_content.importantInformation,
          video: '',
          pdf: '',
          steps: params.p_content.steps,
          common_problems: params.p_content.commonProblems,
          faq: params.p_content.faq,
          related_items: params.p_content.relatedItems,
          internal_notes: params.p_content.internalNotes,
          revision_history: [],
          author: 'Development Support',
          created_by: 'Development Support',
          updated_by: 'Development Support',
          created_at: '2026-09-27T00:00:00Z',
          updated_at: '2026-09-27T00:00:00Z',
          deleted_at: null,
          deleted_by: null
        },
        error: null
      };
    }
  };

  const created = await createGuide({
    issueId: 'WA-001',
    playbookId: 'whatsapp',
    title: 'Resolution Guide',
    summary: 'Clear problem summary',
    status: 'Verified',
    steps: [{ title: 'First step', description: 'Do this first' }]
  }, mockClient);

  assert.equal(rpcMethod, 'fn_create_guide');
  assert.equal(rpcParams.p_issue_id, 'WA-001');
  assert.equal(rpcParams.p_playbook_id, 'whatsapp');
  assert.equal(rpcParams.p_content.title, 'Resolution Guide');
  assert.equal(created.id, 'WA-G01');
  assert.equal(created.currentVersionId, 'WA-G01:v1');
  assert.equal(created.versionNumber, 1);
});

test('createGuide translates database duplicate primary guide error cleanly', async () => {
  const { createGuide } = await importTs('src/services/guideService.ts', 'guide-service');

  const mockClient = {
    rpc: async () => ({
      data: null,
      error: { message: 'This Issue already has a primary Guide. Open the existing Guide.' }
    })
  };

  await assert.rejects(
    () => createGuide({
      issueId: 'WA-001',
      playbookId: 'whatsapp',
      title: 'T',
      summary: 'S',
      steps: [{ title: 'Step', description: 'Desc' }]
    }, mockClient),
    /This Issue already has a primary Guide. Open the existing Guide./
  );
});
