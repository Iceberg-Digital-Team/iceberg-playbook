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

test('publishGuideVersion validates required fields before making RPC call', async () => {
  const { publishGuideVersion } = await importTs('src/services/guideService.ts', 'guide-service');
  const mockClient = {};

  await assert.rejects(
    () => publishGuideVersion({
      guideId: '',
      expectedVersionId: 'WA-G01:v1',
      content: { title: 'T', summary: 'S', steps: [{ title: 'Step', description: 'Desc' }] }
    }, mockClient),
    /Guide ID is required/
  );

  await assert.rejects(
    () => publishGuideVersion({
      guideId: 'WA-G01',
      expectedVersionId: '',
      content: { title: 'T', summary: 'S', steps: [{ title: 'Step', description: 'Desc' }] }
    }, mockClient),
    /Expected version ID is required/
  );

  await assert.rejects(
    () => publishGuideVersion({
      guideId: 'WA-G01',
      expectedVersionId: 'WA-G01:v1',
      content: { title: '', summary: 'S', steps: [{ title: 'Step', description: 'Desc' }] }
    }, mockClient),
    /Add a Guide title, summary, and complete solution steps/
  );
});

test('publishGuideVersion invokes fn_publish_guide_version RPC with expected version', async () => {
  const { publishGuideVersion } = await importTs('src/services/guideService.ts', 'guide-service');

  let rpcMethod = '';
  let rpcParams = null;

  const mockClient = {
    rpc: async (fn, params) => {
      rpcMethod = fn;
      rpcParams = params;
      return {
        data: {
          id: params.p_guide_id,
          issue_id: 'WA-001',
          playbook_id: 'whatsapp',
          current_version_id: 'WA-G01:v2',
          version_number: 2,
          title: params.p_content.title,
          summary: params.p_content.summary,
          status: 'Verified',
          difficulty: 'Medium',
          estimated_time: '15 min',
          steps: params.p_content.steps,
          author: 'Development Support',
          created_by: 'Development Support',
          updated_by: 'Development Support',
          created_at: '2026-09-27T00:00:00Z',
          updated_at: '2026-09-27T02:00:00Z',
          deleted_at: null,
          deleted_by: null
        },
        error: null
      };
    }
  };

  const updated = await publishGuideVersion({
    guideId: 'WA-G01',
    expectedVersionId: 'WA-G01:v1',
    changeSummary: 'Updated step 1 with more details',
    content: {
      title: 'Updated Guide Title',
      summary: 'Updated Guide Summary',
      status: 'Verified',
      steps: [{ title: 'Step 1', description: 'Improved instructions' }]
    }
  }, mockClient);

  assert.equal(rpcMethod, 'fn_publish_guide_version');
  assert.equal(rpcParams.p_guide_id, 'WA-G01');
  assert.equal(rpcParams.p_expected_version_id, 'WA-G01:v1');
  assert.equal(rpcParams.p_change_summary, 'Updated step 1 with more details');
  assert.equal(rpcParams.p_content.title, 'Updated Guide Title');
  assert.equal(updated.id, 'WA-G01');
  assert.equal(updated.currentVersionId, 'WA-G01:v2');
  assert.equal(updated.versionNumber, 2);
});

test('publishGuideVersion translates stale-version optimistic concurrency error cleanly', async () => {
  const { publishGuideVersion } = await importTs('src/services/guideService.ts', 'guide-service');

  const mockClient = {
    rpc: async () => ({
      data: null,
      error: { message: 'This Guide was updated elsewhere. Reopen the current Guide before publishing. Your changes have not been saved.' }
    })
  };

  await assert.rejects(
    () => publishGuideVersion({
      guideId: 'WA-G01',
      expectedVersionId: 'WA-G01:v1',
      content: { title: 'T', summary: 'S', steps: [{ title: 'Step', description: 'Desc' }] }
    }, mockClient),
    /This Guide was updated elsewhere\. Reopen the current Guide before publishing\. Your changes have not been saved\./
  );
});

test('restoreGuideVersion validates required fields before making RPC call', async () => {
  const { restoreGuideVersion } = await importTs('src/services/guideService.ts', 'guide-service');
  const mockClient = {};

  await assert.rejects(
    () => restoreGuideVersion({ guideId: '', targetVersionId: 'WA-G01:v1', expectedVersionId: 'WA-G01:v2' }, mockClient),
    /Guide ID is required/
  );

  await assert.rejects(
    () => restoreGuideVersion({ guideId: 'WA-G01', targetVersionId: '', expectedVersionId: 'WA-G01:v2' }, mockClient),
    /Target version ID is required/
  );

  await assert.rejects(
    () => restoreGuideVersion({ guideId: 'WA-G01', targetVersionId: 'WA-G01:v1', expectedVersionId: '' }, mockClient),
    /Expected version ID is required/
  );
});

test('restoreGuideVersion invokes fn_restore_guide_version RPC with exact parameters', async () => {
  const { restoreGuideVersion } = await importTs('src/services/guideService.ts', 'guide-service');

  let rpcMethod = '';
  let rpcParams = null;

  const mockClient = {
    rpc: async (fn, params) => {
      rpcMethod = fn;
      rpcParams = params;
      return {
        data: {
          id: params.p_guide_id,
          issue_id: 'WA-001',
          playbook_id: 'whatsapp',
          current_version_id: 'WA-G01:v3',
          version_number: 3,
          title: 'Historical Title Restored',
          summary: 'Historical Summary Restored',
          status: 'Verified',
          difficulty: 'Medium',
          estimated_time: '15 min',
          steps: [{ number: 1, title: 'Original Step 1', description: 'Original instructions' }],
          author: 'Development Support',
          created_by: 'Development Support',
          updated_by: 'Development Support',
          created_at: '2026-09-27T00:00:00Z',
          updated_at: '2026-09-27T03:00:00Z',
          deleted_at: null,
          deleted_by: null
        },
        error: null
      };
    }
  };

  const restored = await restoreGuideVersion({
    guideId: 'WA-G01',
    targetVersionId: 'WA-G01:v1',
    expectedVersionId: 'WA-G01:v2'
  }, mockClient);

  assert.equal(rpcMethod, 'fn_restore_guide_version');
  assert.equal(rpcParams.p_guide_id, 'WA-G01');
  assert.equal(rpcParams.p_target_version_id, 'WA-G01:v1');
  assert.equal(rpcParams.p_expected_version_id, 'WA-G01:v2');
  assert.equal(restored.id, 'WA-G01');
  assert.equal(restored.currentVersionId, 'WA-G01:v3');
  assert.equal(restored.versionNumber, 3);
  assert.equal(restored.title, 'Historical Title Restored');
});

test('restoreGuideVersion translates optimistic concurrency and business validation errors cleanly', async () => {
  const { restoreGuideVersion } = await importTs('src/services/guideService.ts', 'guide-service');

  const staleClient = {
    rpc: async () => ({
      data: null,
      error: { message: 'This Guide was updated elsewhere. Reopen the current Guide before publishing. Your changes have not been saved.' }
    })
  };

  await assert.rejects(
    () => restoreGuideVersion({
      guideId: 'WA-G01',
      targetVersionId: 'WA-G01:v1',
      expectedVersionId: 'WA-G01:v2'
    }, staleClient),
    /This Guide was updated elsewhere\. Reopen the current Guide before publishing\. Your changes have not been saved\./
  );

  const alreadyCurrentClient = {
    rpc: async () => ({
      data: null,
      error: { message: 'This version is already current.' }
    })
  };

  await assert.rejects(
    () => restoreGuideVersion({
      guideId: 'WA-G01',
      targetVersionId: 'WA-G01:v2',
      expectedVersionId: 'WA-G01:v2'
    }, alreadyCurrentClient),
    /This version is already current\./
  );
});

test('softDeleteGuide validates id and rejects empty/whitespace input', async () => {
  const { softDeleteGuide } = await importTs('src/services/guideService.ts', 'guide-service');

  await assert.rejects(
    () => softDeleteGuide('   '),
    /Invalid Guide ID\./
  );

  await assert.rejects(
    () => softDeleteGuide(''),
    /Invalid Guide ID\./
  );
});

test('softDeleteGuide invokes exact fn_soft_delete_guide RPC and does NOT hard delete', async () => {
  const { softDeleteGuide } = await importTs('src/services/guideService.ts', 'guide-service');

  let rpcCall = null;
  let hardDeleteCalled = false;

  const mockClient = {
    rpc: async (fn, params) => {
      rpcCall = { fn, params };
      return { error: null };
    },
    from: () => ({
      delete: () => {
        hardDeleteCalled = true;
        return { eq: () => ({ error: null }) };
      }
    })
  };

  await softDeleteGuide('WA-G01', mockClient);

  assert.equal(rpcCall.fn, 'fn_soft_delete_guide');
  assert.deepEqual(rpcCall.params, { p_guide_id: 'WA-G01' });
  assert.equal(hardDeleteCalled, false, 'hard delete should not be invoked');
});

test('softDeleteGuide propagates backend errors and translates permission denied', async () => {
  const { softDeleteGuide } = await importTs('src/services/guideService.ts', 'guide-service');

  const rlsClient = {
    rpc: async () => ({
      error: { code: '42501', message: 'Permission denied. Support or Admin role required.' }
    })
  };

  await assert.rejects(
    () => softDeleteGuide('WA-G01', rlsClient),
    /Permission denied\. Support or Admin role required\./
  );

  const notFoundClient = {
    rpc: async () => ({
      error: { code: 'P0001', message: 'Guide WA-G01 not found or already deleted.' }
    })
  };

  await assert.rejects(
    () => softDeleteGuide('WA-G01', notFoundClient),
    /Guide WA-G01 not found or already deleted\./
  );
});

