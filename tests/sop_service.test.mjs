import { test } from 'node:test';
import assert from 'node:assert/strict';

// Provide dummy env for transpiler module loading in test environment
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dummy.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key-for-unit-tests';

import { importTs } from './helpers/transpile.mjs';

test('mapSopRowToSop correctly maps database fields to frontend SOP shape', async () => {
  const { mapSopRowToSop } = await importTs('src/services/sopService.ts', 'sop-service');
  const dbRow = {
    id: 'WA-SOP01',
    playbook_id: 'whatsapp',
    title: 'Customer Onboarding Process',
    owner: 'Onboarding Team',
    status: 'Verified',
    estimated_time: '45 min',
    purpose: 'Standard procedure for onboarding customers',
    when_to_use: 'When a new customer signs up',
    requirements: ['Verified account', 'Assigned agent'],
    responsible_team: 'Customer Success',
    checklist: ['Verify email', 'Setup webhook'],
    steps: [{ number: 1, title: 'Send welcome email', description: 'Trigger onboarding workflow' }],
    escalation_rules: 'Escalate to Tier 2 after 2 hours without response',
    completion_criteria: 'Webhook receiving live events',
    related_issues: ['WA-001'],
    related_guides: ['WA-G01'],
    internal_notes: 'Internal team checklist',
    revision_history: [{ version: '1.0.0', date: '2026-09-27', updatedBy: 'Admin', changes: 'Initial version' }],
    deleted_at: null,
    deleted_by: null,
    created_at: '2026-09-27T00:00:00Z',
    updated_at: '2026-09-27T01:00:00Z',
  };

  const sop = mapSopRowToSop(dbRow);
  assert.equal(sop.id, 'WA-SOP01');
  assert.equal(sop.playbookId, 'whatsapp');
  assert.equal(sop.title, 'Customer Onboarding Process');
  assert.equal(sop.owner, 'Onboarding Team');
  assert.equal(sop.status, 'Verified');
  assert.equal(sop.estimatedTime, '45 min');
  assert.equal(sop.purpose, 'Standard procedure for onboarding customers');
  assert.equal(sop.whenToUse, 'When a new customer signs up');
  assert.deepEqual(sop.requirements, ['Verified account', 'Assigned agent']);
  assert.equal(sop.responsibleTeam, 'Customer Success');
  assert.deepEqual(sop.checklist, ['Verify email', 'Setup webhook']);
  assert.deepEqual(sop.steps, [{ number: 1, title: 'Send welcome email', description: 'Trigger onboarding workflow' }]);
  assert.equal(sop.escalationRules, 'Escalate to Tier 2 after 2 hours without response');
  assert.equal(sop.completionCriteria, 'Webhook receiving live events');
  assert.deepEqual(sop.relatedIssues, ['WA-001']);
  assert.deepEqual(sop.relatedGuides, ['WA-G01']);
  assert.equal(sop.internalNotes, 'Internal team checklist');
  assert.equal(sop.updatedAt, '2026-09-27T01:00:00Z');
  assert.equal(sop.revisionHistory.length, 1);
});

test('createSop validates required inputs before sending query', async () => {
  const { createSop } = await importTs('src/services/sopService.ts', 'sop-service');
  const mockClient = {};

  await assert.rejects(
    () => createSop({ playbookId: '', title: 'Title', purpose: 'Purpose', whenToUse: 'When' }, mockClient),
    /Select a Playbook for this SOP/
  );

  await assert.rejects(
    () => createSop({ playbookId: 'whatsapp', title: '', purpose: 'Purpose', whenToUse: 'When' }, mockClient),
    /Enter an SOP title/
  );

  await assert.rejects(
    () => createSop({ playbookId: 'whatsapp', title: 'Title', purpose: '', whenToUse: 'When' }, mockClient),
    /Provide an SOP purpose/
  );

  await assert.rejects(
    () => createSop({ playbookId: 'whatsapp', title: 'Title', purpose: 'Purpose', whenToUse: '' }, mockClient),
    /Provide when to use this SOP/
  );
});

test('createSop generates unique code and inserts into Supabase', async () => {
  const { createSop } = await importTs('src/services/sopService.ts', 'sop-service');

  let rpcCalledWith = null;
  let insertedPayload = null;

  const mockClient = {
    rpc: async (fn, params) => {
      rpcCalledWith = { fn, params };
      return { data: 'WA-SOP01', error: null };
    },
    from: (table) => {
      assert.equal(table, 'sops');
      return {
        insert: (payload) => {
          insertedPayload = payload;
          return {
            select: () => ({
              single: async () => ({
                data: {
                  ...payload,
                  created_at: '2026-09-27T00:00:00Z',
                  updated_at: '2026-09-27T00:00:00Z',
                  deleted_at: null,
                  deleted_by: null
                },
                error: null
              })
            })
          };
        }
      };
    }
  };

  const sop = await createSop({
    playbookId: 'whatsapp',
    title: 'Customer Onboarding Process',
    purpose: 'Standard procedure for onboarding customers',
    whenToUse: 'When a new customer signs up',
    status: 'Verified',
    estimatedTime: '45 min',
    requirements: ['Verified account'],
    checklist: ['Step 1 check'],
    steps: [{ title: 'First step', description: 'Do this first' }]
  }, mockClient);

  assert.equal(rpcCalledWith.fn, 'fn_generate_sop_code');
  assert.equal(rpcCalledWith.params.p_playbook_id, 'whatsapp');
  assert.equal(insertedPayload.id, 'WA-SOP01');
  assert.equal(insertedPayload.playbook_id, 'whatsapp');
  assert.equal(insertedPayload.title, 'Customer Onboarding Process');
  assert.equal(sop.id, 'WA-SOP01');
  assert.equal(sop.title, 'Customer Onboarding Process');
  assert.equal(sop.status, 'Verified');
  assert.deepEqual(sop.requirements, ['Verified account']);
});

test('updateSop validates required inputs before sending query', async () => {
  const { updateSop } = await importTs('src/services/sopService.ts', 'sop-service');
  const mockClient = {};

  await assert.rejects(
    () => updateSop({ id: '', title: 'Title', purpose: 'Purpose', whenToUse: 'When' }, mockClient),
    /Enter an SOP ID/
  );

  await assert.rejects(
    () => updateSop({ id: 'WA-SOP01', title: '', purpose: 'Purpose', whenToUse: 'When' }, mockClient),
    /Enter an SOP title/
  );

  await assert.rejects(
    () => updateSop({ id: 'WA-SOP01', title: 'Title', purpose: '', whenToUse: 'When' }, mockClient),
    /Provide an SOP purpose/
  );

  await assert.rejects(
    () => updateSop({ id: 'WA-SOP01', title: 'Title', purpose: 'Purpose', whenToUse: '' }, mockClient),
    /Provide when to use this SOP/
  );
});

test('updateSop updates existing SOP in Supabase and preserves id, playbook_id, created_at', async () => {
  const { updateSop } = await importTs('src/services/sopService.ts', 'sop-service');

  let updatedPayload = null;
  let eqFilter = null;
  let isFilter = null;

  const mockClient = {
    from: (table) => {
      assert.equal(table, 'sops');
      return {
        update: (payload) => {
          updatedPayload = payload;
          return {
            eq: (col, val) => {
              eqFilter = { col, val };
              return {
                is: (isCol, isVal) => {
                  isFilter = { isCol, isVal };
                  return {
                    select: () => ({
                      maybeSingle: async () => ({
                        data: {
                          id: 'WA-SOP01',
                          playbook_id: 'whatsapp',
                          created_at: '2026-09-27T00:00:00Z',
                          deleted_at: null,
                          deleted_by: null,
                          ...payload
                        },
                        error: null
                      })
                    })
                  };
                }
              };
            }
          };
        }
      };
    }
  };

  const updated = await updateSop({
    id: 'WA-SOP01',
    title: 'Updated SOP Title',
    purpose: 'Updated SOP Purpose',
    whenToUse: 'Updated When to Use',
    status: 'Verified',
    estimatedTime: '60 min',
    requirements: ['New req'],
    responsibleTeam: 'Onboarding Team',
    checklist: ['New task'],
    steps: [{ title: 'Updated Step', description: 'Updated Desc' }],
    escalationRules: 'Escalate to manager',
    completionCriteria: 'Task signed off',
    relatedIssues: ['WA-002'],
    relatedGuides: ['WA-G02'],
    internalNotes: 'Updated notes',
    owner: 'Admin Team',
    revisionHistory: [{ version: '1.1.0', date: '2026-09-28', updatedBy: 'Admin', changes: 'Updated' }]
  }, mockClient);

  assert.equal(eqFilter.col, 'id');
  assert.equal(eqFilter.val, 'WA-SOP01');
  assert.equal(isFilter.isCol, 'deleted_at');
  assert.equal(isFilter.isVal, null);

  // Assert protected fields are NOT present in updatePayload
  assert.equal(updatedPayload.id, undefined);
  assert.equal(updatedPayload.playbook_id, undefined);
  assert.equal(updatedPayload.created_at, undefined);

  // Assert editable fields were sent correctly
  assert.equal(updatedPayload.title, 'Updated SOP Title');
  assert.equal(updatedPayload.purpose, 'Updated SOP Purpose');
  assert.equal(updatedPayload.when_to_use, 'Updated When to Use');
  assert.equal(updatedPayload.status, 'Verified');
  assert.equal(updatedPayload.estimated_time, '60 min');
  assert.deepEqual(updatedPayload.requirements, ['New req']);
  assert.equal(updatedPayload.responsible_team, 'Onboarding Team');
  assert.deepEqual(updatedPayload.checklist, ['New task']);
  assert.deepEqual(updatedPayload.steps, [{ number: 1, title: 'Updated Step', description: 'Updated Desc' }]);
  assert.equal(updatedPayload.escalation_rules, 'Escalate to manager');
  assert.equal(updatedPayload.completion_criteria, 'Task signed off');
  assert.deepEqual(updatedPayload.related_issues, ['WA-002']);
  assert.deepEqual(updatedPayload.related_guides, ['WA-G02']);
  assert.equal(updatedPayload.internal_notes, 'Updated notes');
  assert.equal(updatedPayload.owner, 'Admin Team');
  assert.ok(updatedPayload.updated_at);
  assert.equal(updatedPayload.revision_history.length, 1);

  // Assert returned mapped SOP
  assert.equal(updated.id, 'WA-SOP01');
  assert.equal(updated.playbookId, 'whatsapp');
  assert.equal(updated.title, 'Updated SOP Title');
});

test('updateSop handles database error and missing row', async () => {
  const { updateSop } = await importTs('src/services/sopService.ts', 'sop-service');

  const rlsErrorClient = {
    from: () => ({
      update: () => ({
        eq: () => ({
          is: () => ({
            select: () => ({
              maybeSingle: async () => ({
                data: null,
                error: { code: '42501', message: 'insufficient_privilege' }
              })
            })
          })
        })
      })
    })
  };

  await assert.rejects(
    () => updateSop({ id: 'WA-SOP01', title: 'T', purpose: 'P', whenToUse: 'W' }, rlsErrorClient),
    /Permission denied. Support or Admin role required./
  );

  const missingRowClient = {
    from: () => ({
      update: () => ({
        eq: () => ({
          is: () => ({
            select: () => ({
              maybeSingle: async () => ({
                data: null,
                error: null
              })
            })
          })
        })
      })
    })
  };

  await assert.rejects(
    () => updateSop({ id: 'WA-SOP01', title: 'T', purpose: 'P', whenToUse: 'W' }, missingRowClient),
    /SOP not found or already deleted/
  );
});

test('softDeleteSop validates id and calls fn_soft_delete_sop RPC', async () => {
  const { softDeleteSop } = await importTs('src/services/sopService.ts', 'sop-service');

  await assert.rejects(
    () => softDeleteSop('   '),
    /Invalid SOP ID/
  );

  let rpcCall = null;
  const mockClient = {
    rpc: async (fn, params) => {
      rpcCall = { fn, params };
      return { error: null };
    }
  };

  await softDeleteSop('WA-SOP01', mockClient);
  assert.equal(rpcCall.fn, 'fn_soft_delete_sop');
  assert.deepEqual(rpcCall.params, { p_sop_id: 'WA-SOP01' });
});

test('softDeleteSop handles errors and permission denied', async () => {
  const { softDeleteSop } = await importTs('src/services/sopService.ts', 'sop-service');

  const rlsClient = {
    rpc: async () => ({
      error: { code: '42501', message: 'Permission denied. Support or Admin role required.' }
    })
  };

  await assert.rejects(
    () => softDeleteSop('WA-SOP01', rlsClient),
    /Permission denied. Support or Admin role required./
  );

  const errClient = {
    rpc: async () => ({
      error: { code: 'P0001', message: 'SOP WA-SOP01 not found or already deleted.' }
    })
  };

  await assert.rejects(
    () => softDeleteSop('WA-SOP01', errClient),
    /SOP WA-SOP01 not found or already deleted./
  );
});

test('parseHash correctly routes SOP edit path', async () => {
  const { parseHash } = await importTs('src/router.ts', 'router');
  const route = parseHash('#/sops/WA-SOP01/edit');
  assert.equal(route.path, '/sops/[id]/edit');
  assert.equal(route.params.id, 'WA-SOP01');
});

