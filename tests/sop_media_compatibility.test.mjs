import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Provide dummy env for transpiler module loading in test environment
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dummy.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key-for-unit-tests';

import { importTs } from './helpers/transpile.mjs';

// 1. createSop preserves all optional Step fields
test('createSop preserves all optional Step fields', async () => {
  const { createSop } = await importTs('src/services/sopService.ts', 'sop-service-compat-1');

  let insertedPayload = null;
  const mockClient = {
    rpc: async (fn, _params) => {
      assert.equal(fn, 'fn_generate_sop_code');
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
                  created_at: '2026-10-15T00:00:00Z',
                  updated_at: '2026-10-15T00:00:00Z',
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

  const fullStep = {
    number: 1,
    title: 'Configure Webhook Endpoint',
    description: 'Add your webhook destination in settings',
    estimatedTime: '5 min',
    screenshot: 'sops/whatsapp/webhook.png',
    importantNote: 'Keep API secret confidential',
    successIndicator: 'Webhook responds with 200 OK',
    videoLink: 'sops/whatsapp/webhook-guide.mp4',
    pdfReference: 'sops/whatsapp/webhook-spec.pdf'
  };

  const created = await createSop({
    playbookId: 'whatsapp',
    title: 'WhatsApp Onboarding SOP',
    purpose: 'Standard onboarding for WhatsApp clients',
    whenToUse: 'When setting up a new WhatsApp Business client',
    steps: [fullStep]
  }, mockClient);

  assert.ok(insertedPayload, 'Payload must be inserted');
  assert.equal(insertedPayload.steps.length, 1);
  assert.deepEqual(insertedPayload.steps[0], fullStep);
  assert.deepEqual(created.steps[0], fullStep);
});

// 2. updateSop preserves all optional Step fields
test('updateSop preserves all optional Step fields', async () => {
  const { updateSop } = await importTs('src/services/sopService.ts', 'sop-service-compat-2');

  let updatedPayload = null;
  const mockClient = {
    from: (table) => {
      assert.equal(table, 'sops');
      return {
        update: (payload) => {
          updatedPayload = payload;
          return {
            eq: () => ({
              is: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'WA-SOP01',
                      playbook_id: 'whatsapp',
                      created_at: '2026-10-15T00:00:00Z',
                      deleted_at: null,
                      deleted_by: null,
                      ...payload
                    },
                    error: null
                  })
                })
              })
            })
          };
        }
      };
    }
  };

  const fullStep = {
    number: 1,
    title: 'Updated Step 1',
    description: 'Updated Description 1',
    estimatedTime: '10 min',
    screenshot: 'sops/whatsapp/step1-v2.png',
    importantNote: 'New important note',
    successIndicator: 'New expected result',
    videoLink: 'sops/whatsapp/step1-v2.mp4',
    pdfReference: 'sops/whatsapp/step1-v2.pdf'
  };

  const updated = await updateSop({
    id: 'WA-SOP01',
    title: 'Updated WhatsApp Onboarding SOP',
    purpose: 'Updated purpose',
    whenToUse: 'Updated when to use',
    steps: [fullStep]
  }, mockClient);

  assert.ok(updatedPayload, 'Payload must be updated');
  assert.equal(updatedPayload.steps.length, 1);
  assert.deepEqual(updatedPayload.steps[0], fullStep);
  assert.deepEqual(updated.steps[0], fullStep);
});

// 3. legacy steps with only number/title/description still work
test('legacy steps with only number/title/description still work in createSop, updateSop, and mapping', async () => {
  const { createSop, updateSop, mapSopRowToSop } = await importTs('src/services/sopService.ts', 'sop-service-compat-3');

  let insertedPayload = null;
  let updatedPayload = null;

  const mockClient = {
    rpc: async () => ({ data: 'LEG-SOP01', error: null }),
    from: (_table) => ({
      insert: (payload) => {
        insertedPayload = payload;
        return {
          select: () => ({
            single: async () => ({
              data: {
                ...payload,
                created_at: '2026-10-15T00:00:00Z',
                updated_at: '2026-10-15T00:00:00Z',
                deleted_at: null,
                deleted_by: null
              },
              error: null
            })
          })
        };
      },
      update: (payload) => {
        updatedPayload = payload;
        return {
          eq: () => ({
            is: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'LEG-SOP01',
                    playbook_id: 'legacy',
                    created_at: '2026-10-15T00:00:00Z',
                    deleted_at: null,
                    deleted_by: null,
                    ...payload
                  },
                  error: null
                })
              })
            })
          })
        };
      }
    })
  };

  // createSop with step lacking optional fields and number
  await createSop({
    playbookId: 'legacy',
    title: 'Legacy SOP',
    purpose: 'Purpose',
    whenToUse: 'When',
    steps: [{ title: 'Only Title and Desc', description: 'Just the basics' }]
  }, mockClient);

  assert.deepEqual(insertedPayload.steps, [
    { number: 1, title: 'Only Title and Desc', description: 'Just the basics' }
  ]);
  assert.equal(insertedPayload.steps[0].screenshot, undefined);
  assert.equal(insertedPayload.steps[0].videoLink, undefined);
  assert.equal(insertedPayload.steps[0].pdfReference, undefined);

  // updateSop with legacy steps
  await updateSop({
    id: 'LEG-SOP01',
    title: 'Legacy SOP Updated',
    purpose: 'Purpose',
    whenToUse: 'When',
    steps: [{ number: 1, title: 'Legacy Step 1', description: 'Legacy Step 1 Desc' }]
  }, mockClient);

  assert.deepEqual(updatedPayload.steps, [
    { number: 1, title: 'Legacy Step 1', description: 'Legacy Step 1 Desc' }
  ]);

  // mapSopRowToSop with legacy DB row lacking any optional step fields
  const legacyRow = {
    id: 'LEG-SOP01',
    playbook_id: 'legacy',
    title: 'Legacy SOP',
    owner: 'Support',
    status: 'Verified',
    estimated_time: '15 min',
    purpose: 'Legacy purpose',
    when_to_use: 'Legacy when',
    requirements: null,
    responsible_team: 'Support Team',
    checklist: null,
    steps: [{ number: 1, title: 'Legacy 1', description: 'Desc 1' }],
    escalation_rules: null,
    completion_criteria: null,
    related_issues: null,
    related_guides: null,
    internal_notes: null,
    revision_history: null,
    deleted_at: null,
    deleted_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  };

  const mapped = mapSopRowToSop(legacyRow);
  assert.deepEqual(mapped.steps, [{ number: 1, title: 'Legacy 1', description: 'Desc 1' }]);
});

// 4. external HTTPS media references remain unchanged
test('external HTTPS media references remain unchanged when resolved for SOP rendering', async () => {
  const { resolveStepMedia } = await importTs('src/services/mediaService.ts', 'media-service-compat-4');

  const externalSteps = [
    {
      number: 1,
      title: 'External Links Step',
      description: 'Check external resources',
      screenshot: 'https://cdn.example.com/images/screenshot.png',
      videoLink: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      pdfReference: 'https://docs.example.com/handbook.pdf'
    }
  ];

  let storageCreateSignedUrlsCalled = false;
  const mockClient = {
    storage: {
      from: () => ({
        createSignedUrls: () => {
          storageCreateSignedUrlsCalled = true;
          return Promise.resolve({ data: [], error: null });
        }
      })
    }
  };

  const resolved = await resolveStepMedia(externalSteps, mockClient);

  assert.equal(storageCreateSignedUrlsCalled, false, 'Storage must not be queried for external HTTPS URLs');
  assert.equal(resolved[0].screenshot, 'https://cdn.example.com/images/screenshot.png');
  assert.equal(resolved[0].videoLink, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(resolved[0].pdfReference, 'https://docs.example.com/handbook.pdf');
});

// 5. private storage keys can be resolved for SOP rendering
test('private storage keys can be resolved for SOP rendering via signed URLs from private bucket', async () => {
  const { resolveStepMedia } = await importTs('src/services/mediaService.ts', 'media-service-compat-5');

  const privateSteps = [
    {
      number: 1,
      title: 'Private Media Step',
      description: 'Step with storage keys',
      screenshot: 'sops/whatsapp/screenshot.png',
      videoLink: 'sops/whatsapp/walkthrough.mp4',
      pdfReference: 'sops/whatsapp/checklist.pdf'
    }
  ];

  let accessedBucket = null;
  let queriedPaths = null;

  const mockClient = {
    storage: {
      from: (bucket) => {
        accessedBucket = bucket;
        return {
          createSignedUrls: async (paths, expiresIn) => {
            queriedPaths = paths;
            return {
              data: paths.map(p => ({
                path: p,
                signedUrl: `https://dummy.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=signed-${expiresIn}`,
                error: null
              })),
              error: null
            };
          }
        };
      }
    }
  };

  const resolved = await resolveStepMedia(privateSteps, mockClient);

  assert.equal(accessedBucket, 'support-assets', 'Must resolve from private support-assets bucket');
  assert.deepEqual(queriedPaths.sort(), [
    'sops/whatsapp/checklist.pdf',
    'sops/whatsapp/screenshot.png',
    'sops/whatsapp/walkthrough.mp4'
  ]);
  assert.equal(
    resolved[0].screenshot,
    'https://dummy.supabase.co/storage/v1/object/sign/support-assets/sops/whatsapp/screenshot.png?token=signed-3600'
  );
  assert.equal(
    resolved[0].videoLink,
    'https://dummy.supabase.co/storage/v1/object/sign/support-assets/sops/whatsapp/walkthrough.mp4?token=signed-3600'
  );
  assert.equal(
    resolved[0].pdfReference,
    'https://dummy.supabase.co/storage/v1/object/sign/support-assets/sops/whatsapp/checklist.pdf?token=signed-3600'
  );
});

// 6. signed URLs are presentation-only and are not persisted
test('signed URLs are presentation-only and are not persisted back into the SOP record', async () => {
  const { resolveStepMedia } = await importTs('src/services/mediaService.ts', 'media-service-compat-6a');
  const { updateSop } = await importTs('src/services/sopService.ts', 'sop-service-compat-6b');

  const durableSteps = [
    {
      number: 1,
      title: 'Durable Step',
      description: 'Testing persistence boundary',
      screenshot: 'sops/durable/screenshot.png',
      videoLink: 'sops/durable/video.mp4',
      pdfReference: 'sops/durable/manual.pdf'
    }
  ];

  const mockStorageClient = {
    storage: {
      from: (bucket) => ({
        createSignedUrls: async (paths) => ({
          data: paths.map(p => ({
            path: p,
            signedUrl: `https://dummy.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=temp-signed-token`,
            error: null
          })),
          error: null
        })
      })
    }
  };

  // 1. Resolve for presentation
  const presentationSteps = await resolveStepMedia(durableSteps, mockStorageClient);

  // Assert original object retained durable keys (not mutated)
  assert.equal(durableSteps[0].screenshot, 'sops/durable/screenshot.png');
  assert.equal(durableSteps[0].videoLink, 'sops/durable/video.mp4');
  assert.equal(durableSteps[0].pdfReference, 'sops/durable/manual.pdf');

  // Assert presentation steps received signed URLs
  assert.ok(presentationSteps[0].screenshot.includes('temp-signed-token'));
  assert.ok(presentationSteps[0].videoLink.includes('temp-signed-token'));
  assert.ok(presentationSteps[0].pdfReference.includes('temp-signed-token'));

  // 2. When updating SOP, durable keys are persisted to Supabase, NOT signed URLs
  let persistedPayload = null;
  const mockDbClient = {
    from: () => ({
      update: (payload) => {
        persistedPayload = payload;
        return {
          eq: () => ({
            is: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: { id: 'WA-SOP01', ...payload },
                  error: null
                })
              })
            })
          })
        };
      }
    })
  };

  await updateSop({
    id: 'WA-SOP01',
    title: 'Durable SOP',
    purpose: 'Purpose',
    whenToUse: 'When',
    steps: durableSteps
  }, mockDbClient);

  assert.equal(persistedPayload.steps[0].screenshot, 'sops/durable/screenshot.png');
  assert.equal(persistedPayload.steps[0].videoLink, 'sops/durable/video.mp4');
  assert.equal(persistedPayload.steps[0].pdfReference, 'sops/durable/manual.pdf');
  assert.ok(!persistedPayload.steps[0].screenshot.includes('token='));
  assert.ok(!persistedPayload.steps[0].videoLink.includes('token='));
  assert.ok(!persistedPayload.steps[0].pdfReference.includes('token='));
});

// 7. no page/component directly imports Supabase
test('no page/component directly imports Supabase', () => {
  const rootDir = process.cwd();
  const searchDirs = [
    join(rootDir, 'src', 'pages'),
    join(rootDir, 'src', 'components')
  ];

  function scanDir(dir) {
    const files = [];
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...scanDir(fullPath));
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const filesToInspect = searchDirs.flatMap(scanDir);
  const violations = [];

  for (const filePath of filesToInspect) {
    const content = readFileSync(filePath, 'utf8');
    // Check for direct Supabase imports
    const directSupabaseImport = /import\s+.*from\s+['"][^'"]*supabase[^'"]*['"]/i;
    if (directSupabaseImport.test(content)) {
      violations.push(filePath.replace(rootDir, ''));
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Direct Supabase imports found in UI pages or components: ${violations.join(', ')}`
  );
});
