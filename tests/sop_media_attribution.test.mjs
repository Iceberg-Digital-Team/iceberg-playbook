import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Provide dummy env for transpiler module loading in test environment
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dummy.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key-for-unit-tests';

import { importTs } from './helpers/transpile.mjs';

// 1. SOP screenshot uses domain=sops, never guides
test('1. SOP screenshot uses domain=sops, never guides', async () => {
  const { generateStoragePath } = await importTs('src/services/mediaService.ts', 'media-path-1');
  const path = generateStoragePath('sops', 'pending/draft-session-123', 'screen.png');

  assert.ok(path.startsWith('sops/'), `Expected path to start with 'sops/', got '${path}'`);
  assert.ok(!path.startsWith('guides/'), `Path should never start with 'guides/', got '${path}'`);
  assert.ok(path.includes('/pending/draft-session-123/'), `Path should contain isolated draft session, got '${path}'`);

  // Check CreateSOP.tsx passes domain="sops" to StepEditor
  const createSopSource = readFileSync(join(process.cwd(), 'src', 'pages', 'CreateSOP.tsx'), 'utf-8');
  assert.ok(createSopSource.includes('domain="sops"'), 'CreateSOP.tsx must pass domain="sops" to StepEditor');

  // Check EditorFields.tsx forwards domain to MediaUploadField
  const editorFieldsSource = readFileSync(join(process.cwd(), 'src', 'components', 'knowledge', 'EditorFields.tsx'), 'utf-8');
  assert.ok(editorFieldsSource.includes('domain={domain}'), 'EditorFields.tsx must forward domain to MediaUploadField');
});

// 2. New SOP pending media uses an isolated draft/session identifier
test('2. New SOP pending media uses an isolated draft/session identifier', async () => {
  const { generateStoragePath } = await importTs('src/services/mediaService.ts', 'media-path-2');

  const sessionA = 'draft-1718000001-abc';
  const sessionB = 'draft-1718000002-xyz';

  const pathA = generateStoragePath('sops', `pending/${sessionA}`, 'step1.png');
  const pathB = generateStoragePath('sops', `pending/${sessionB}`, 'step1.png');

  assert.ok(pathA.startsWith(`sops/pending/${sessionA}/`), `Expected pathA in sessionA, got ${pathA}`);
  assert.ok(pathB.startsWith(`sops/pending/${sessionB}/`), `Expected pathB in sessionB, got ${pathB}`);
  assert.notEqual(pathA, pathB, 'Paths from separate draft sessions must be distinct and isolated');
  assert.ok(!pathA.includes('%2F'), 'Subpaths in entityId should preserve slashes');

  // Test passing entityId without leading 'pending/' also automatically prefixes pending
  const pathC = generateStoragePath('sops', sessionA, 'step1.png');
  assert.ok(pathC.startsWith(`sops/pending/${sessionA}/`), `Expected auto-prefixed pending/ draft path, got ${pathC}`);
});

// 3. Video upload works
test('3. Video upload works (MP4 and WebM validation and path generation)', async () => {
  const { validateMediaFile, generateStoragePath } = await importTs('src/services/mediaService.ts', 'media-validate-video');

  const validMp4 = { name: 'demo.mp4', size: 10 * 1024 * 1024, type: 'video/mp4' };
  const validWebm = { name: 'demo.webm', size: 5 * 1024 * 1024, type: 'video/webm' };
  const invalidType = { name: 'demo.png', size: 1 * 1024 * 1024, type: 'image/png' };
  const oversized = { name: 'huge.mp4', size: 60 * 1024 * 1024, type: 'video/mp4' };

  const resMp4 = validateMediaFile(validMp4, 'video');
  assert.equal(resMp4.valid, true);
  assert.equal(resMp4.contentType, 'video/mp4');

  const resWebm = validateMediaFile(validWebm, 'video');
  assert.equal(resWebm.valid, true);
  assert.equal(resWebm.contentType, 'video/webm');

  const resInvalid = validateMediaFile(invalidType, 'video');
  assert.equal(resInvalid.valid, false);
  assert.ok(resInvalid.error.includes('video'));

  const resOversized = validateMediaFile(oversized, 'video');
  assert.equal(resOversized.valid, false);
  assert.ok(resOversized.error.includes('limit'));

  const videoStorageKey = generateStoragePath('sops', 'pending/draft-session-1', 'demo.mp4');
  assert.ok(videoStorageKey.startsWith('sops/pending/draft-session-1/'));
  assert.ok(videoStorageKey.endsWith('.mp4'));
});

// 4. External HTTPS video URL works
test('4. External HTTPS video URL works and is preserved', async () => {
  const { isStorageKey, resolveStepMedia } = await importTs('src/services/mediaService.ts', 'media-ext-video');
  const { formatSopStep } = await importTs('src/services/sopService.ts', 'sop-ext-video');

  const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const cdnUrl = 'https://cdn.iceberg.example/videos/walkthrough.mp4';

  assert.equal(isStorageKey(youtubeUrl), false, 'HTTPS YouTube URL must not be classified as a storage key');
  assert.equal(isStorageKey(cdnUrl), false, 'HTTPS direct video URL must not be classified as a storage key');

  const formatted = formatSopStep({
    title: 'Watch video',
    description: 'Check external video',
    videoLink: youtubeUrl
  }, 0);

  assert.equal(formatted.videoLink, youtubeUrl);

  // resolveStepMedia should not attempt to sign external URLs
  const resolved = await resolveStepMedia([formatted]);
  assert.equal(resolved[0].videoLink, youtubeUrl);
});

// 5. PDF upload works
test('5. PDF upload works (PDF validation and path generation)', async () => {
  const { validateMediaFile, generateStoragePath } = await importTs('src/services/mediaService.ts', 'media-validate-pdf');

  const validPdf = { name: 'manual.pdf', size: 2 * 1024 * 1024, type: 'application/pdf' };
  const invalidDoc = { name: 'manual.docx', size: 2 * 1024 * 1024, type: 'application/msword' };

  const resPdf = validateMediaFile(validPdf, 'pdf');
  assert.equal(resPdf.valid, true);
  assert.equal(resPdf.contentType, 'application/pdf');

  const resInvalid = validateMediaFile(invalidDoc, 'pdf');
  assert.equal(resInvalid.valid, false);

  const pdfStorageKey = generateStoragePath('sops', 'pending/draft-session-1', 'manual.pdf');
  assert.ok(pdfStorageKey.startsWith('sops/pending/draft-session-1/'));
  assert.ok(pdfStorageKey.endsWith('.pdf'));
});

// 6. External HTTPS PDF URL works
test('6. External HTTPS PDF URL works and is preserved', async () => {
  const { isStorageKey, resolveStepMedia } = await importTs('src/services/mediaService.ts', 'media-ext-pdf');
  const { formatSopStep } = await importTs('src/services/sopService.ts', 'sop-ext-pdf');

  const extPdfUrl = 'https://docs.example.com/specifications/api-guide.pdf';

  assert.equal(isStorageKey(extPdfUrl), false, 'HTTPS PDF URL must not be classified as a storage key');

  const formatted = formatSopStep({
    title: 'Review PDF reference',
    description: 'Refer to external documentation',
    pdfReference: extPdfUrl
  }, 0);

  assert.equal(formatted.pdfReference, extPdfUrl);

  const resolved = await resolveStepMedia([formatted]);
  assert.equal(resolved[0].pdfReference, extPdfUrl);
});

// 7. createSop links uploaded storage keys to final sop_id
test('7. createSop links uploaded storage keys to final sop_id', async () => {
  const { createSop } = await importTs('src/services/sopService.ts', 'sop-link-media-create');

  let rpcLinked = null;

  const mockClient = {
    rpc: async (fn, params) => {
      if (fn === 'fn_generate_sop_code') {
        return { data: 'WHATSAPP-SOP-001', error: null };
      }
      if (fn === 'fn_link_sop_media') {
        rpcLinked = {
          sop_id: params.p_sop_id,
          keys: params.p_storage_keys
        };
        return { data: params.p_storage_keys.length, error: null };
      }
      return { data: null, error: new Error('Unknown RPC') };
    },
    from: (table) => {
      if (table === 'sops') {
        return {
          insert: (payload) => ({
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
          })
        };
      }
      throw new Error(`Direct table access to ${table} is forbidden!`);
    }
  };

  const stepsWithMedia = [
    {
      title: 'Step with uploaded media',
      description: 'Upload details',
      screenshot: 'sops/pending/draft-1/screen.png',
      videoLink: 'sops/pending/draft-1/video.mp4',
      pdfReference: 'https://external.example.com/spec.pdf' // external URL should not be linked
    },
    {
      title: 'Step 2',
      description: 'PDF upload',
      pdfReference: 'sops/pending/draft-1/handbook.pdf'
    }
  ];

  const sop = await createSop({
    playbookId: 'pb-whatsapp',
    title: 'Customer Onboarding SOP',
    purpose: 'Onboard clients',
    whenToUse: 'When a new client signs up',
    steps: stepsWithMedia
  }, mockClient);

  assert.equal(sop.id, 'WHATSAPP-SOP-001');
  assert.ok(rpcLinked, 'RPC fn_link_sop_media must be called to link storage keys');
  assert.equal(rpcLinked.sop_id, 'WHATSAPP-SOP-001');

  // Check that the storage keys were linked
  assert.ok(rpcLinked.keys.includes('sops/pending/draft-1/screen.png'));
  assert.ok(rpcLinked.keys.includes('sops/pending/draft-1/video.mp4'));
  assert.ok(rpcLinked.keys.includes('sops/pending/draft-1/handbook.pdf'));

  // External URL must NOT be included in storage keys linking
  assert.ok(!rpcLinked.keys.includes('https://external.example.com/spec.pdf'));
});

// 8. updateSop preserves/links media correctly
test('8. updateSop preserves and links media correctly', async () => {
  const { updateSop } = await importTs('src/services/sopService.ts', 'sop-link-media-update');

  let rpcLinked = null;
  const mockClient = {
    rpc: async (fn, params) => {
      if (fn === 'fn_link_sop_media') {
        rpcLinked = {
          sop_id: params.p_sop_id,
          keys: params.p_storage_keys
        };
        return { data: params.p_storage_keys.length, error: null };
      }
      return { data: null, error: new Error('Unknown RPC') };
    },
    from: (table) => {
      if (table === 'sops') {
        return {
          update: (payload) => ({
            eq: () => ({
              is: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'WHATSAPP-SOP-001',
                      playbook_id: 'pb-1',
                      ...payload,
                      created_at: '2026-10-15T00:00:00Z',
                      updated_at: '2026-10-15T01:00:00Z',
                      deleted_at: null,
                      deleted_by: null
                    },
                    error: null
                  })
                })
              })
            })
          })
        };
      }
      throw new Error(`Direct table access to ${table} is forbidden!`);
    }
  };

  const steps = [
    {
      title: 'Updated Step',
      description: 'Preserved & new media',
      screenshot: 'sops/WHATSAPP-SOP-001/screenshot.png',
      videoLink: 'https://youtube.com/watch?v=123',
      pdfReference: 'sops/WHATSAPP-SOP-001/doc.pdf'
    }
  ];

  const updated = await updateSop({
    id: 'WHATSAPP-SOP-001',
    title: 'Updated SOP Title',
    purpose: 'Updated purpose',
    whenToUse: 'Updated when to use',
    steps
  }, mockClient);

  assert.equal(updated.id, 'WHATSAPP-SOP-001');
  assert.equal(updated.steps[0].videoLink, 'https://youtube.com/watch?v=123');
  assert.ok(rpcLinked);
  assert.equal(rpcLinked.sop_id, 'WHATSAPP-SOP-001');
  assert.deepEqual(rpcLinked.keys.sort(), [
    'sops/WHATSAPP-SOP-001/doc.pdf',
    'sops/WHATSAPP-SOP-001/screenshot.png'
  ].sort());
});

// 9. Legacy SOPs still work without error
test('9. Legacy SOPs without media still work correctly', async () => {
  const { createSop, extractStepStorageKeys, linkSopMedia } = await importTs('src/services/sopService.ts', 'sop-legacy');

  // Verify extractStepStorageKeys handles empty or no media safely
  assert.deepEqual(extractStepStorageKeys([]), []);
  assert.deepEqual(extractStepStorageKeys(null), []);
  assert.deepEqual(extractStepStorageKeys([
    { title: 'Plain Step', description: 'No media at all' }
  ]), []);

  // linkSopMedia should no-op safely on empty keys
  await linkSopMedia('SOP-LEGACY', []);

  let rpcCalled = false;
  const mockClient = {
    rpc: async (fn, _params) => {
      if (fn === 'fn_generate_sop_code') return { data: 'SOP-LEGACY', error: null };
      if (fn === 'fn_link_sop_media') {
        rpcCalled = true;
        return { data: 0, error: null };
      }
      return { data: null, error: null };
    },
    from: () => ({
      insert: (payload) => ({
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
      })
    })
  };

  const legacySop = await createSop({
    playbookId: 'pb-legacy',
    title: 'Legacy Process',
    purpose: 'Standard procedure',
    whenToUse: 'Always',
    steps: [{ title: 'Do task', description: 'Perform work' }]
  }, mockClient);

  assert.equal(legacySop.id, 'SOP-LEGACY');
  assert.equal(rpcCalled, false, 'linkSopMedia should not call RPC when there are no storage keys');
});

// 10. Guide media behavior is unchanged
test('10. Guide media behavior is unchanged', async () => {
  const { generateStoragePath } = await importTs('src/services/mediaService.ts', 'media-guide-unchanged');

  // Guide with real entityId
  const guidePath = generateStoragePath('guides', 'GUIDE-101', 'screen.png');
  assert.ok(guidePath.startsWith('guides/GUIDE-101/'));

  // Guide with no entityId defaults to pending
  const guidePendingPath = generateStoragePath('guides', undefined, 'screen.png');
  assert.ok(guidePendingPath.startsWith('guides/pending/'));

  // Check CreateGuide passes domain="guides"
  const createGuideSource = readFileSync(join(process.cwd(), 'src', 'pages', 'CreateGuide.tsx'), 'utf-8');
  assert.ok(createGuideSource.includes('domain="guides"'), 'CreateGuide.tsx must preserve domain="guides"');
});

// 11. UI has no direct Supabase imports
test('11. UI has no direct Supabase imports', () => {
  const rootDir = process.cwd();
  const searchDirs = [
    join(rootDir, 'src', 'pages'),
    join(rootDir, 'src', 'components')
  ];

  function scan(dir) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        scan(fullPath);
      } else if (/\.(tsx|ts|jsx|js)$/.test(entry)) {
        const content = readFileSync(fullPath, 'utf-8');
        const hasDirectImport =
          /from\s+['"]@supabase\/supabase-js['"]/.test(content) ||
          /from\s+['"][^'"]*lib\/supabase['"]/.test(content);
        assert.ok(
          !hasDirectImport,
          `Forbidden direct Supabase import found in UI file: ${fullPath}`
        );
      }
    }
  }

  for (const dir of searchDirs) {
    scan(dir);
  }
});

// 12. No code in this task deletes Storage objects
test('12. No code in this task deletes Storage objects', () => {
  const sopServiceSource = readFileSync(join(process.cwd(), 'src', 'services', 'sopService.ts'), 'utf-8');
  assert.ok(
    !sopServiceSource.includes('.storage.from'),
    'sopService must not invoke Storage remove operations'
  );
  assert.ok(
    !sopServiceSource.includes('removeMedia'),
    'sopService must not import or invoke removeMedia'
  );

  const migration14Source = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '14_sop_media_link.sql'),
    'utf-8'
  );
  assert.ok(
    !/DELETE\s+FROM/i.test(migration14Source),
    'Migration 14 must not contain DELETE statements'
  );
  assert.ok(
    !/DROP\s+TABLE/i.test(migration14Source),
    'Migration 14 must not drop tables'
  );
});

// 13. Safety checks: No direct media_files update fallback exists in sopService
test('13. No direct media_files table update fallback exists in sopService', () => {
  const sopServiceSource = readFileSync(join(process.cwd(), 'src', 'services', 'sopService.ts'), 'utf-8');
  assert.ok(
    !sopServiceSource.includes(".from('media_files')"),
    'sopService must never directly update media_files table'
  );
  assert.ok(
    !sopServiceSource.includes('.from("media_files")'),
    'sopService must never directly update media_files table'
  );
});

// 14. Safety checks: Missing or failing RPC throws safe service error clearly
test('14. Missing or failing RPC throws safe service error clearly without fallback', async () => {
  const { linkSopMedia } = await importTs('src/services/sopService.ts', 'sop-rpc-missing');

  let attemptedTableUpdate = false;
  const mockClientWithFailingRpc = {
    rpc: async (fn) => {
      assert.equal(fn, 'fn_link_sop_media');
      return { data: null, error: { code: '42883', message: 'function fn_link_sop_media does not exist' } };
    },
    from: () => {
      attemptedTableUpdate = true;
      throw new Error('Direct table fallback should not be called!');
    }
  };

  await assert.rejects(
    () => linkSopMedia('SOP-001', ['sops/pending/img.png'], mockClientWithFailingRpc),
    /Failed to associate media with SOP: function fn_link_sop_media does not exist/
  );
  assert.equal(attemptedTableUpdate, false, 'No fallback to direct table update must occur');

  // Permission denied error
  const mockClientWithDeniedRpc = {
    rpc: async () => ({
      data: null,
      error: { code: '42501', message: 'Permission denied. Support or Admin role required.' }
    })
  };
  await assert.rejects(
    () => linkSopMedia('SOP-001', ['sops/pending/img.png'], mockClientWithDeniedRpc),
    /Permission denied\. Support or Admin role required\./
  );
});

// 15. Safety checks: Hardened fn_link_sop_media migration rules and simulated ownership verification
test('15. Hardened migration 14 enforces search_path, permissions, and ownership safety', () => {
  const m14 = readFileSync(join(process.cwd(), 'supabase', 'migrations', '14_sop_media_link.sql'), 'utf-8');

  // Mode header
  assert.match(m14, /ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS/);
  assert.match(m14, /Migration 14:/);
  assert.match(m14, /Mode: PROPOSED \(DO NOT EXECUTE WITHOUT APPROVAL\)/);

  // Security definer and empty search_path
  assert.match(m14, /SECURITY DEFINER/);
  assert.match(m14, /SET search_path = ''/);

  // Permissions lockdown
  assert.match(m14, /REVOKE EXECUTE ON FUNCTION public\.fn_link_sop_media\(TEXT, TEXT\[\]\) FROM PUBLIC, anon;/);
  assert.match(m14, /GRANT EXECUTE ON FUNCTION public\.fn_link_sop_media\(TEXT, TEXT\[\]\) TO authenticated, service_role;/);

  // Role verification inside function
  assert.match(m14, /public\.get_current_user_role\(\)/);
  assert.match(m14, /v_role NOT IN \('Admin', 'Support'\)/);

  // Namespace check (sops/)
  assert.match(m14, /LIKE 'sops\/%'/);

  // Target SOP active check
  assert.match(m14, /WHERE id = v_clean_sop_id AND deleted_at IS NULL/);

  // Rejection of foreign entities
  assert.match(m14, /guide_version_id IS NOT NULL/);
  assert.match(m14, /guide_id IS NOT NULL/);
  assert.match(m14, /issue_id IS NOT NULL/);
  assert.match(m14, /sop_id IS NOT NULL AND v_rec\.sop_id <> v_clean_sop_id/);
});

// 16. Simulated RPC attribution semantics: Guide media, Guide-version, Issue, Foreign SOP, Idempotent, Atomic
test('16. Simulated RPC attribution semantics: strict rejection, atomicity, idempotence', () => {
  // Model of public.media_files database rows
  const mockDatabase = [
    { storage_key: 'sops/pending/session-1/clean.png', guide_id: null, guide_version_id: null, issue_id: null, sop_id: null },
    { storage_key: 'guides/g-100/guide-cover.png', guide_id: 'G-100', guide_version_id: null, issue_id: null, sop_id: null },
    { storage_key: 'sops/pending/sneaky-guide-version.png', guide_id: null, guide_version_id: 'GV-001', issue_id: null, sop_id: null },
    { storage_key: 'sops/pending/sneaky-issue.png', guide_id: null, guide_version_id: null, issue_id: 'ISSUE-42', sop_id: null },
    { storage_key: 'sops/SOP-OTHER/owned.png', guide_id: null, guide_version_id: null, issue_id: null, sop_id: 'SOP-OTHER' },
    { storage_key: 'sops/SOP-TARGET/already.png', guide_id: null, guide_version_id: null, issue_id: null, sop_id: 'SOP-TARGET' }
  ];

  // Exact reproduction of fn_link_sop_media verification logic in JavaScript
  function simulateLinkSopMedia(targetSopId, suppliedKeys, db) {
    if (!suppliedKeys || suppliedKeys.length === 0) return 0;
    const distinct = Array.from(new Set(suppliedKeys.filter(Boolean)));

    // 1. Namespace check
    for (const key of distinct) {
      if (!key.startsWith('sops/')) {
        throw new Error(`Storage key ${key} does not belong to the sops/ namespace.`);
      }
    }

    // 2. Atomicity check across all keys BEFORE any update
    for (const key of distinct) {
      const row = db.find(r => r.storage_key === key);
      if (!row) throw new Error(`Media file ${key} not found in media_files registry.`);
      if (row.guide_version_id !== null) throw new Error(`Media file ${key} is linked to a guide version and cannot be claimed by an SOP.`);
      if (row.guide_id !== null) throw new Error(`Media file ${key} is linked to a guide and cannot be claimed by an SOP.`);
      if (row.issue_id !== null) throw new Error(`Media file ${key} is linked to an issue and cannot be claimed by an SOP.`);
      if (row.sop_id !== null && row.sop_id !== targetSopId) {
        throw new Error(`Media file ${key} is already owned by another SOP (${row.sop_id}) and cannot be reassigned.`);
      }
    }

    // 3. Update matching rows
    let updated = 0;
    for (const key of distinct) {
      const row = db.find(r => r.storage_key === key);
      if (row) {
        row.sop_id = targetSopId;
        updated++;
      }
    }
    return updated;
  }

  // A. Guide media cannot be claimed by an SOP (fails namespace or guide_id)
  assert.throws(
    () => simulateLinkSopMedia('SOP-TARGET', ['guides/g-100/guide-cover.png'], [...mockDatabase]),
    /does not belong to the sops\/ namespace/
  );

  // B. Guide-version media cannot be claimed
  assert.throws(
    () => simulateLinkSopMedia('SOP-TARGET', ['sops/pending/sneaky-guide-version.png'], [...mockDatabase]),
    /linked to a guide version and cannot be claimed by an SOP/
  );

  // C. Issue media cannot be claimed
  assert.throws(
    () => simulateLinkSopMedia('SOP-TARGET', ['sops/pending/sneaky-issue.png'], [...mockDatabase]),
    /linked to an issue and cannot be claimed by an SOP/
  );

  // D. Media belonging to another SOP cannot be stolen
  assert.throws(
    () => simulateLinkSopMedia('SOP-TARGET', ['sops/SOP-OTHER/owned.png'], [...mockDatabase]),
    /already owned by another SOP \(SOP-OTHER\) and cannot be reassigned/
  );

  // E. Unlinked sops/... media can be linked
  const db1 = mockDatabase.map(r => ({ ...r }));
  const count1 = simulateLinkSopMedia('SOP-TARGET', ['sops/pending/session-1/clean.png'], db1);
  assert.equal(count1, 1);
  assert.equal(db1.find(r => r.storage_key === 'sops/pending/session-1/clean.png').sop_id, 'SOP-TARGET');

  // F. Already-linked media for the same SOP is idempotent
  const db2 = mockDatabase.map(r => ({ ...r }));
  const count2 = simulateLinkSopMedia('SOP-TARGET', ['sops/SOP-TARGET/already.png'], db2);
  assert.equal(count2, 1);
  assert.equal(db2.find(r => r.storage_key === 'sops/SOP-TARGET/already.png').sop_id, 'SOP-TARGET');

  // G. Mixed valid + invalid key set fails atomically without partial link
  const db3 = mockDatabase.map(r => ({ ...r }));
  assert.throws(
    () => simulateLinkSopMedia('SOP-TARGET', [
      'sops/pending/session-1/clean.png',
      'sops/SOP-OTHER/owned.png' // invalid key in batch
    ], db3),
    /already owned by another SOP/
  );
  // Assert atomic rollback: clean.png was NOT linked
  assert.equal(db3.find(r => r.storage_key === 'sops/pending/session-1/clean.png').sop_id, null, 'Clean key must not be partially linked when batch fails');
});

// 17. createSop succeeds with non-blocking media warning when media linking RPC fails
test('17. createSop succeeds if SOP insert succeeds but media linking RPC fails', async () => {
  const { createSop, MEDIA_LINKING_WARNING } = await importTs('src/services/sopService.ts', 'sop-create-partial-success');

  let insertCount = 0;
  let attemptedTableUpdate = false;

  const mockClient = {
    rpc: async (fn) => {
      if (fn === 'fn_generate_sop_code') {
        return { data: 'ONBOARDING-SOP-001', error: null };
      }
      if (fn === 'fn_link_sop_media') {
        return {
          data: null,
          error: { code: 'P0001', message: 'Target SOP ONBOARDING-SOP-001 not found or has been deleted.' }
        };
      }
      return { data: null, error: new Error('Unknown RPC') };
    },
    from: (table) => {
      if (table === 'sops') {
        return {
          insert: (payload) => {
            insertCount++;
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
      if (table === 'media_files') {
        attemptedTableUpdate = true;
        throw new Error('Direct table access to media_files is strictly forbidden!');
      }
      throw new Error(`Unexpected table access to ${table}`);
    }
  };

  const stepsWithMedia = [
    {
      title: 'Step with media',
      description: 'Upload details',
      screenshot: 'sops/pending/draft-1/screen.png',
      videoLink: 'sops/pending/draft-1/video.mp4',
      pdfReference: 'sops/pending/draft-1/handbook.pdf'
    }
  ];

  // Must NOT throw
  const created = await createSop({
    playbookId: 'pb-onboarding',
    title: 'Client Setup Process',
    purpose: 'Standard onboarding',
    whenToUse: 'When setting up a new client',
    steps: stepsWithMedia
  }, mockClient);

  // 1. SOP persistence succeeded
  assert.equal(created.id, 'ONBOARDING-SOP-001');
  assert.equal(created.title, 'Client Setup Process');
  assert.equal(created.steps.length, 1);
  assert.equal(created.steps[0].screenshot, 'sops/pending/draft-1/screen.png');

  // 2. Non-blocking warning is returned
  assert.equal(created.warning, MEDIA_LINKING_WARNING);
  assert.equal(created.mediaWarning, MEDIA_LINKING_WARNING);
  assert.ok(created.warning.includes('media ownership metadata could not be linked'));

  // 3. Exactly one insert (no automatic retry, no duplicate second SOP created)
  assert.equal(insertCount, 1, 'Only exactly one SOP row must be inserted; no duplicate retry');

  // 4. No direct table fallback
  assert.equal(attemptedTableUpdate, false, 'No direct update to media_files table permitted');
});

// 18. updateSop succeeds with non-blocking media warning when media linking RPC fails
test('18. updateSop succeeds if SOP update succeeds but media linking RPC fails', async () => {
  const { updateSop, MEDIA_LINKING_WARNING } = await importTs('src/services/sopService.ts', 'sop-update-partial-success');

  let updateCount = 0;
  let attemptedTableUpdate = false;

  const mockClient = {
    rpc: async (fn) => {
      if (fn === 'fn_link_sop_media') {
        return {
          data: null,
          error: { code: '42501', message: 'Permission denied. Support or Admin role required.' }
        };
      }
      return { data: null, error: new Error('Unknown RPC') };
    },
    from: (table) => {
      if (table === 'sops') {
        return {
          update: (payload) => {
            updateCount++;
            return {
              eq: () => ({
                is: () => ({
                  select: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: 'ONBOARDING-SOP-001',
                        playbook_id: 'pb-onboarding',
                        ...payload,
                        created_at: '2026-10-15T00:00:00Z',
                        updated_at: '2026-10-15T02:00:00Z',
                        deleted_at: null,
                        deleted_by: null
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
      if (table === 'media_files') {
        attemptedTableUpdate = true;
        throw new Error('Direct table access to media_files is strictly forbidden!');
      }
      throw new Error(`Unexpected table access to ${table}`);
    }
  };

  const updated = await updateSop({
    id: 'ONBOARDING-SOP-001',
    title: 'Updated Client Setup Process',
    purpose: 'Updated purpose',
    whenToUse: 'Updated when to use',
    steps: [
      {
        title: 'Updated Step',
        description: 'New media',
        screenshot: 'sops/ONBOARDING-SOP-001/new-screen.png'
      }
    ]
  }, mockClient);

  // 1. SOP update succeeded
  assert.equal(updated.id, 'ONBOARDING-SOP-001');
  assert.equal(updated.title, 'Updated Client Setup Process');
  assert.equal(updated.steps[0].screenshot, 'sops/ONBOARDING-SOP-001/new-screen.png');

  // 2. Non-blocking warning is returned
  assert.equal(updated.warning, MEDIA_LINKING_WARNING);
  assert.equal(updated.mediaWarning, MEDIA_LINKING_WARNING);

  // 3. Exactly one update (no retry)
  assert.equal(updateCount, 1, 'Only exactly one SOP update must occur');

  // 4. No direct table fallback
  assert.equal(attemptedTableUpdate, false, 'No direct update to media_files table permitted');
});

// 19. Migration 14 uses row locking FOR UPDATE OF mf for attribution validation
test('19. Migration 14 uses row locking FOR UPDATE OF mf for attribution validation', () => {
  const m14 = readFileSync(join(process.cwd(), 'supabase', 'migrations', '14_sop_media_link.sql'), 'utf-8');

  // Check row locking on media_files
  assert.match(m14, /FOR UPDATE OF mf/, 'Migration 14 must lock media_files rows with FOR UPDATE OF mf');
  assert.match(m14, /JOIN public\.media_files mf ON mf\.storage_key = k\.key/, 'Migration 14 must join media_files on key');
});

// 20. Guide behavior unchanged and zero storage deletions
test('20. Guide behavior unchanged and zero storage deletion logic', () => {
  const createGuide = readFileSync(join(process.cwd(), 'src', 'pages', 'CreateGuide.tsx'), 'utf-8');
  assert.ok(createGuide.includes('domain="guides"'), 'CreateGuide must preserve domain="guides"');

  const sopService = readFileSync(join(process.cwd(), 'src', 'services', 'sopService.ts'), 'utf-8');
  assert.ok(!sopService.includes('.remove('), 'sopService must never delete storage files');
  assert.ok(!sopService.includes('DELETE FROM'), 'sopService must never delete database records');

  const m14 = readFileSync(join(process.cwd(), 'supabase', 'migrations', '14_sop_media_link.sql'), 'utf-8');
  assert.ok(!m14.includes('DELETE FROM'), 'Migration 14 must never delete media records');
  assert.ok(!m14.includes('DROP TABLE'), 'Migration 14 must never drop tables');
  assert.ok(!m14.includes('TRUNCATE'), 'Migration 14 must never truncate tables');
});

// 21. Migration 15 fixes role helper to fn_is_support_or_admin while preserving all protections
test('21. Migration 15 uses fn_is_support_or_admin and retains all Migration 14 security rules', () => {
  const m15 = readFileSync(join(process.cwd(), 'supabase', 'migrations', '15_sop_media_link_fix.sql'), 'utf-8');

  // Header & Mode
  assert.match(m15, /Migration 15: Fix SOP Media Link Role Helper/);
  assert.match(m15, /Mode: PROPOSED \(DO NOT EXECUTE WITHOUT APPROVAL\)/);

  // Uses project helper fn_is_support_or_admin
  assert.match(m15, /public\.fn_is_support_or_admin\(\)/, 'Migration 15 must use public.fn_is_support_or_admin()');
  assert.ok(!m15.includes('get_current_user_role'), 'Migration 15 must not reference nonexistent get_current_user_role');

  // Security Definer & empty search path
  assert.match(m15, /SECURITY DEFINER/);
  assert.match(m15, /SET search_path = ''/);

  // Permissions lockdown
  assert.match(m15, /REVOKE EXECUTE ON FUNCTION public\.fn_link_sop_media\(TEXT, TEXT\[\]\) FROM PUBLIC, anon;/);
  assert.match(m15, /GRANT EXECUTE ON FUNCTION public\.fn_link_sop_media\(TEXT, TEXT\[\]\) TO authenticated, service_role;/);

  // Namespace check (sops/)
  assert.match(m15, /LIKE 'sops\/%'/);

  // Target SOP active check
  assert.match(m15, /WHERE id = v_clean_sop_id AND deleted_at IS NULL/);

  // Row locking
  assert.match(m15, /FOR UPDATE OF mf/, 'Migration 15 must retain FOR UPDATE OF mf row locking');
  assert.match(m15, /JOIN public\.media_files mf ON mf\.storage_key = k\.key/);

  // Entity isolation
  assert.match(m15, /guide_version_id IS NOT NULL/);
  assert.match(m15, /guide_id IS NOT NULL/);
  assert.match(m15, /issue_id IS NOT NULL/);
  assert.match(m15, /sop_id IS NOT NULL AND v_rec\.sop_id <> v_clean_sop_id/);

  // Zero deletion
  assert.ok(!m15.includes('DELETE FROM'), 'Migration 15 must never delete records');
  assert.ok(!m15.includes('DROP TABLE'), 'Migration 15 must never drop tables');
  assert.ok(!m15.includes('TRUNCATE'), 'Migration 15 must never truncate tables');
});

// 22. SOP inline direct video rendering and Guide isolation
test('22. StepsSection supports inlineDirectVideo for direct video files and preserves Guide link behavior', async () => {
  const { StepsSection } = await importTs('src/components/article/ArticleComponents.tsx', 'steps-section-video-test');

  const mp4SignedUrl = 'https://xwqqngkjlsgwsvacmjmf.supabase.co/storage/v1/object/sign/support-assets/sops/demo.mp4?token=abc123xyz';
  const webmSignedUrl = 'https://xwqqngkjlsgwsvacmjmf.supabase.co/storage/v1/object/sign/support-assets/sops/demo.webm?token=abc123xyz';
  const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const screenshotUrl = 'https://xwqqngkjlsgwsvacmjmf.supabase.co/storage/v1/object/sign/support-assets/sops/screen.png?token=123';

  function findNodes(node, predicate) {
    const results = [];
    if (!node || typeof node !== 'object') return results;
    if (predicate(node)) results.push(node);
    if (Array.isArray(node)) {
      for (const item of node) results.push(...findNodes(item, predicate));
    } else if (node.props) {
      if (node.props.children) results.push(...findNodes(node.props.children, predicate));
    }
    return results;
  }

  // A. SOP direct MP4 renders <video controls>
  const sopMp4Tree = StepsSection({
    steps: [{ number: 1, title: 'Step 1', description: 'Watch MP4', videoLink: mp4SignedUrl, screenshot: screenshotUrl }],
    inlineDirectVideo: true
  });
  const mp4Videos = findNodes(sopMp4Tree, n => n.type === 'video');
  assert.equal(mp4Videos.length, 1, 'Direct MP4 must render exactly one <video> element when inlineDirectVideo=true');
  assert.equal(mp4Videos[0].props.src, mp4SignedUrl);
  assert.equal(mp4Videos[0].props.controls, true);
  assert.equal(mp4Videos[0].props.preload, 'metadata');

  // Screenshot is also preserved
  const screenshots = findNodes(sopMp4Tree, n => n && n.props && n.props.src === screenshotUrl);
  assert.ok(screenshots.length >= 1, 'Screenshot must still be rendered');

  // No redundant link in inline-actions
  const mp4Links = findNodes(sopMp4Tree, n => n.type === 'a' && n.props && n.props.children === 'Watch video chapter');
  assert.equal(mp4Links.length, 0, 'No redundant "Watch video chapter" link should be rendered when direct video is inline');

  // B. SOP direct WebM renders <video controls>
  const sopWebmTree = StepsSection({
    steps: [{ number: 1, title: 'Step 1', description: 'Watch WebM', videoLink: webmSignedUrl }],
    inlineDirectVideo: true
  });
  const webmVideos = findNodes(sopWebmTree, n => n.type === 'video');
  assert.equal(webmVideos.length, 1, 'Direct WebM must render <video> element when inlineDirectVideo=true');
  assert.equal(webmVideos[0].props.src, webmSignedUrl);

  // C. External YouTube URL remains a link even when inlineDirectVideo=true
  const sopYoutubeTree = StepsSection({
    steps: [{ number: 1, title: 'Step 1', description: 'Watch YouTube', videoLink: youtubeUrl }],
    inlineDirectVideo: true
  });
  const youtubeVideos = findNodes(sopYoutubeTree, n => n.type === 'video');
  assert.equal(youtubeVideos.length, 0, 'YouTube URL must NOT render <video> element');
  const youtubeLinks = findNodes(sopYoutubeTree, n => n.type === 'a' && n.props && n.props.children === 'Watch video chapter');
  assert.equal(youtubeLinks.length, 1, 'YouTube URL must remain "Watch video chapter" link');
  assert.equal(youtubeLinks[0].props.href, youtubeUrl);

  // D. Guide step video behavior remains unchanged (inlineDirectVideo omitted / default false)
  const guideTree = StepsSection({
    steps: [{ number: 1, title: 'Guide Step 1', description: 'Guide instructions', videoLink: mp4SignedUrl }]
  });
  const guideVideos = findNodes(guideTree, n => n.type === 'video');
  assert.equal(guideVideos.length, 0, 'Guide steps must NOT render <video> element when inlineDirectVideo is omitted (default false)');
  const guideLinks = findNodes(guideTree, n => n.type === 'a' && n.props && n.props.children === 'Watch video chapter');
  assert.equal(guideLinks.length, 1, 'Guide steps must preserve "Watch video chapter" link');

  // E. Verify SOPDetail passes inlineDirectVideo and GuideArticle does NOT
  const sopDetailSource = readFileSync(join(process.cwd(), 'src', 'pages', 'SOPDetail.tsx'), 'utf-8');
  assert.ok(sopDetailSource.includes('inlineDirectVideo'), 'SOPDetail.tsx must pass inlineDirectVideo prop to StepsSection');

  const guideArticleSource = readFileSync(join(process.cwd(), 'src', 'components', 'knowledge', 'GuideArticle.tsx'), 'utf-8');
  assert.ok(!guideArticleSource.includes('inlineDirectVideo'), 'GuideArticle.tsx must NOT enable inlineDirectVideo');
});

// 23. Portability boundary: zero direct supabase imports in UI pages/components
test('23. Zero direct Supabase client imports in UI components and pages', () => {
  const filesToCheck = [
    'src/pages/CreateSOP.tsx',
    'src/pages/SOPDetail.tsx',
    'src/components/article/ArticleComponents.tsx',
    'src/components/knowledge/GuideArticle.tsx',
    'src/components/knowledge/EditorFields.tsx'
  ];

  for (const relPath of filesToCheck) {
    const content = readFileSync(join(process.cwd(), relPath), 'utf-8');
    assert.ok(
      !content.includes("from '../supabase'") && !content.includes("from '../../supabase'"),
      `${relPath} must not directly import supabase client`
    );
  }
});
