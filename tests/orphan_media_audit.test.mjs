import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractProtectedKeys,
  auditOrphanMedia,
  deleteOrphanObject,
  parseArgs,
} from '../scripts/prune_orphan_media.mjs';

// -----------------------------------------------------------------------------
// Test Fixtures
// -----------------------------------------------------------------------------
const mockGuides = [
  {
    id: 'ISS-G01',
    video_storage_key: null,
    pdf_storage_key: null,
    steps: [
      { number: 1, screenshot: 'guides/pending/ChatGPT_Image_11_A_u_2026_16_2-1790630139675-pxmoziy.png' },
    ],
    deleted_at: null,
  },
  {
    id: 'ZOOM-G01',
    video_storage_key: null,
    pdf_storage_key: null,
    steps: [
      { number: 1, screenshot: 'guides/pending/Mikrofon_Se_imini_Do_rulama_Re-1790857403450-5m86edh.png' },
      { number: 2, screenshot: 'guides/pending/ChatGPT_G_rseli_30_Eyl_2026_22-1790857475577-ld41qgn.png' },
      { number: 3, screenshot: 'guides/pending/ChatGPT_Image_21_Eyl_2026_17_1-1790857584216-1ehngh6.png' },
    ],
    deleted_at: null,
  },
];

const mockGuideVersions = [
  {
    id: 'ZOOM-G01:v4',
    guide_id: 'ZOOM-G01',
    version_number: 4,
    video_storage_key: null,
    pdf_storage_key: null,
    steps: [
      { number: 1, screenshot: 'guides/pending/Mikrofon_Se_imini_Do_rulama_Re-1790857403450-5m86edh.png' },
      { number: 2, screenshot: 'guides/pending/ChatGPT_G_rseli_30_Eyl_2026_22-1790857475577-ld41qgn.png' },
      // This historical screenshot was superseded in ZOOM-G01:v5+ but is preserved here:
      { number: 3, screenshot: 'guides/pending/ChatGPT_G_rseli_30_Eyl_2026_22-1790857542599-bri48oy.png' },
    ],
  },
];

const mockSops = [
  {
    id: 'PLAY-SOP02',
    steps: [
      { number: 1, videoLink: 'sops/pending/draft-1792017701331-yc6r16y/LVBEL_C5__AKDO_-_5_YILDIZ-1792017727471-zs34ons.mp4' },
    ],
    deleted_at: null,
  },
  {
    id: 'PLAY-SOP03',
    steps: [
      { number: 1, screenshot: 'sops/pending/draft-1792023905183-1wwu94s/images__1_-1792023918262-d13dthr.jpg' },
    ],
    deleted_at: null,
  },
];

const mockIssues = [
  {
    id: 'ISS-001',
    attachments: [
      { name: 'diagram.png', url: 'issues/diagrams/arch-diagram-1.png' },
      { name: 'external-doc', url: 'https://external-site.com/doc.pdf' },
    ],
    deleted_at: null,
  },
];

const now = Date.now();
const oneHourAgo = new Date(now - 1 * 3600 * 1000).toISOString();
const twoWeeksAgo = new Date(now - 14 * 24 * 3600 * 1000).toISOString();

const mockStorageObjects = [
  // Current Guide media
  { name: 'guides/pending/ChatGPT_Image_11_A_u_2026_16_2-1790630139675-pxmoziy.png', created_at: twoWeeksAgo, size: 1904308, mimetype: 'image/png' },
  // Historical Guide Version media
  { name: 'guides/pending/ChatGPT_G_rseli_30_Eyl_2026_22-1790857542599-bri48oy.png', created_at: twoWeeksAgo, size: 319134, mimetype: 'image/png' },
  // Current SOP media
  { name: 'sops/pending/draft-1792017701331-yc6r16y/LVBEL_C5__AKDO_-_5_YILDIZ-1792017727471-zs34ons.mp4', created_at: oneHourAgo, size: 18149188, mimetype: 'video/mp4' },
  { name: 'sops/pending/draft-1792023905183-1wwu94s/images__1_-1792023918262-d13dthr.jpg', created_at: oneHourAgo, size: 17663, mimetype: 'image/jpeg' },
  // Current Issue attachment
  { name: 'issues/diagrams/arch-diagram-1.png', created_at: twoWeeksAgo, size: 450000, mimetype: 'image/png' },
  // Old Genuine Orphans (> 24h)
  { name: 'guides/pending/Product_advertisement_shot_gen-1790857208674-hl9147g.mp4', created_at: twoWeeksAgo, size: 3324601, mimetype: 'video/mp4' },
  { name: 'guides/pending/ChatGPT_G_rseli_30_Eyl_2026_22-1790857285520-17clfmj.png', created_at: twoWeeksAgo, size: 58850, mimetype: 'image/png' },
  { name: 'guides/ZOOM-G01/Product_advertisement_shot_gen-1790857500315-fyzm0cz.mp4', created_at: twoWeeksAgo, size: 3324601, mimetype: 'video/mp4' },
  { name: 'guides/ZOOM-G01/Document-1790857712619-m3frwzk.pdf', created_at: twoWeeksAgo, size: 3886057, mimetype: 'application/pdf' },
  // Recent Unreferenced Media (< 24h)
  { name: 'sops/pending/draft-1792023905183-1wwu94s/Playbook_advertisement_shot_on-1792023923762-qanu150.mp4', created_at: oneHourAgo, size: 3251187, mimetype: 'video/mp4' },
];

function createMockClient({
  guides = mockGuides,
  guideVersions = mockGuideVersions,
  sops = mockSops,
  issues = mockIssues,
  mediaFiles = [
    { id: 'mf-1', storage_key: 'sops/pending/draft-1792017701331-yc6r16y/LVBEL_C5__AKDO_-_5_YILDIZ-1792017727471-zs34ons.mp4', sop_id: 'PLAY-SOP02' },
    { id: 'mf-2', storage_key: 'sops/pending/draft-1792023905183-1wwu94s/images__1_-1792023918262-d13dthr.jpg', sop_id: 'PLAY-SOP03' },
    { id: 'mf-3', storage_key: 'sops/pending/draft-1792023905183-1wwu94s/Playbook_advertisement_shot_on-1792023923762-qanu150.mp4', sop_id: null },
  ],
  storageObjects = mockStorageObjects,
  onStorageRemove = null,
  onMediaFilesDelete = null,
} = {}) {
  return {
    from: (table) => {
      if (table === 'guides') return { select: async () => ({ data: guides, error: null }) };
      if (table === 'guide_versions') return { select: async () => ({ data: guideVersions, error: null }) };
      if (table === 'sops') return { select: async () => ({ data: sops, error: null }) };
      if (table === 'issues') return { select: async () => ({ data: issues, error: null }) };
      if (table === 'media_files') {
        return {
          select: async () => ({ data: mediaFiles, error: null }),
          delete: () => ({
            eq: async (col, val) => {
              if (onMediaFilesDelete) onMediaFilesDelete(col, val);
              return { error: null };
            },
          }),
        };
      }
      return { select: async () => ({ data: [], error: null }) };
    },
    storage: {
      from: () => ({
        list: async (prefix = '') => {
          const filtered = storageObjects
            .filter(o => !prefix || o.name.startsWith(prefix))
            .map(o => ({
              name: prefix ? o.name.replace(prefix + '/', '') : o.name,
              id: 'uuid-' + o.name,
              created_at: o.created_at,
              updated_at: o.created_at,
              metadata: { size: o.size, mimetype: o.mimetype },
            }));
          return { data: filtered, error: null };
        },
        remove: async (keys) => {
          if (onStorageRemove) return onStorageRemove(keys);
          return { error: null };
        },
      }),
    },
    rpc: async () => {
      // Simulate RPC not found in unit test to test fallback logic
      const err = new Error('RPC function not found');
      err.code = 'PGRST202';
      return { data: null, error: err };
    },
  };
}

// -----------------------------------------------------------------------------
// 1. Current Guide media is protected
// -----------------------------------------------------------------------------
test('1. current Guide media is protected', async () => {
  const protectedKeys = extractProtectedKeys({ guides: mockGuides });
  assert.ok(
    protectedKeys.has('guides/pending/ChatGPT_Image_11_A_u_2026_16_2-1790630139675-pxmoziy.png'),
    'Active Guide step screenshot must be protected'
  );
  assert.ok(
    protectedKeys.has('guides/pending/Mikrofon_Se_imini_Do_rulama_Re-1790857403450-5m86edh.png'),
    'ZOOM-G01 step 1 screenshot must be protected'
  );
});

// -----------------------------------------------------------------------------
// 2. Current SOP media is protected
// -----------------------------------------------------------------------------
test('2. current SOP media is protected', async () => {
  const protectedKeys = extractProtectedKeys({ sops: mockSops });
  assert.ok(
    protectedKeys.has('sops/pending/draft-1792017701331-yc6r16y/LVBEL_C5__AKDO_-_5_YILDIZ-1792017727471-zs34ons.mp4'),
    'Active SOP step videoLink must be protected'
  );
  assert.ok(
    protectedKeys.has('sops/pending/draft-1792023905183-1wwu94s/images__1_-1792023918262-d13dthr.jpg'),
    'Active SOP step screenshot must be protected'
  );
});

// -----------------------------------------------------------------------------
// 3. Historical guide_versions media is protected
// -----------------------------------------------------------------------------
test('3. historical guide_versions media is protected permanently', async () => {
  const protectedKeys = extractProtectedKeys({
    guides: mockGuides,
    guideVersions: mockGuideVersions,
  });

  const historicalKey = 'guides/pending/ChatGPT_G_rseli_30_Eyl_2026_22-1790857542599-bri48oy.png';
  assert.ok(
    protectedKeys.has(historicalKey),
    'Superseded historical Guide version media must be permanently protected'
  );
});

// -----------------------------------------------------------------------------
// 4. Soft-deleted entity media is protected
// -----------------------------------------------------------------------------
test('4. soft-deleted entity media is protected', async () => {
  const softDeletedGuide = {
    id: 'DELETED-G01',
    video_storage_key: 'guides/DELETED-G01/intro.mp4',
    pdf_storage_key: null,
    steps: [{ number: 1, screenshot: 'guides/DELETED-G01/step1.png' }],
    deleted_at: '2026-10-10T12:00:00Z',
  };

  const softDeletedSop = {
    id: 'DELETED-SOP01',
    steps: [{ number: 1, videoLink: 'sops/DELETED-SOP01/procedure.mp4' }],
    deleted_at: '2026-10-10T12:00:00Z',
  };

  const softDeletedIssue = {
    id: 'DELETED-ISS01',
    attachments: [{ name: 'crash.log', storage_key: 'issues/DELETED-ISS01/crash.log' }],
    deleted_at: '2026-10-10T12:00:00Z',
  };

  const protectedKeys = extractProtectedKeys({
    guides: [softDeletedGuide],
    sops: [softDeletedSop],
    issues: [softDeletedIssue],
  });

  assert.ok(protectedKeys.has('guides/DELETED-G01/intro.mp4'), 'Soft-deleted guide video is protected');
  assert.ok(protectedKeys.has('guides/DELETED-G01/step1.png'), 'Soft-deleted guide screenshot is protected');
  assert.ok(protectedKeys.has('sops/DELETED-SOP01/procedure.mp4'), 'Soft-deleted SOP video is protected');
  assert.ok(protectedKeys.has('issues/DELETED-ISS01/crash.log'), 'Soft-deleted Issue attachment is protected');
});

// -----------------------------------------------------------------------------
// 5. Recent unreferenced media is protected by grace period
// -----------------------------------------------------------------------------
test('5. recent unreferenced media is protected by grace period', async () => {
  const client = createMockClient();
  const { candidates } = await auditOrphanMedia({
    client,
    bucket: 'support-assets',
    graceHours: 24,
  });

  const recentVideoKey = 'sops/pending/draft-1792023905183-1wwu94s/Playbook_advertisement_shot_on-1792023923762-qanu150.mp4';
  const found = candidates.find(c => c.storage_key === recentVideoKey);
  assert.equal(
    found,
    undefined,
    'Recent unreferenced media (< 24h old) must NOT be returned as an orphan candidate'
  );
});

// -----------------------------------------------------------------------------
// 6. Old genuinely unreferenced media is returned
// -----------------------------------------------------------------------------
test('6. old genuinely unreferenced media is returned', async () => {
  const client = createMockClient();
  const { candidates } = await auditOrphanMedia({
    client,
    bucket: 'support-assets',
    graceHours: 24,
  });

  const expectedOldOrphans = [
    'guides/pending/Product_advertisement_shot_gen-1790857208674-hl9147g.mp4',
    'guides/pending/ChatGPT_G_rseli_30_Eyl_2026_22-1790857285520-17clfmj.png',
    'guides/ZOOM-G01/Product_advertisement_shot_gen-1790857500315-fyzm0cz.mp4',
    'guides/ZOOM-G01/Document-1790857712619-m3frwzk.pdf',
  ];

  const candidateKeys = candidates.map(c => c.storage_key);

  for (const expected of expectedOldOrphans) {
    assert.ok(candidateKeys.includes(expected), `Expected old orphan candidate ${expected} to be identified`);
  }
  assert.equal(candidates.length, 4, 'Exactly 4 old orphan candidates must be returned');
});

// -----------------------------------------------------------------------------
// 7. media_files absence does not make active legacy media orphan
// -----------------------------------------------------------------------------
test('7. media_files absence does not make active legacy media orphan', async () => {
  // Empty media_files array: simulate legacy state before media_files table existed
  const client = createMockClient({ mediaFiles: [] });
  const { candidates } = await auditOrphanMedia({
    client,
    bucket: 'support-assets',
    graceHours: 24,
  });

  const activeLegacyScreenshot = 'guides/pending/ChatGPT_Image_11_A_u_2026_16_2-1790630139675-pxmoziy.png';
  const candidateKeys = candidates.map(c => c.storage_key);

  assert.ok(
    !candidateKeys.includes(activeLegacyScreenshot),
    'Active legacy media must NEVER be an orphan candidate even if media_files has no row'
  );
});

// -----------------------------------------------------------------------------
// 8. Stale media_files ownership alone does not make unreferenced content protected
// -----------------------------------------------------------------------------
test('8. stale media_files ownership alone does not make unreferenced content protected', async () => {
  // Old object with stale media_files row pointing to a deleted or non-existent entity
  const staleKey = 'guides/pending/stale-unreferenced.png';
  const oldObjects = [
    { name: staleKey, created_at: twoWeeksAgo, size: 100000, mimetype: 'image/png' },
  ];
  const staleMediaFiles = [
    { id: 'stale-mf-1', storage_key: staleKey, sop_id: 'OLD-SOP-999', guide_id: null },
  ];

  const client = createMockClient({
    guides: [],
    guideVersions: [],
    sops: [],
    issues: [],
    storageObjects: oldObjects,
    mediaFiles: staleMediaFiles,
  });

  const { candidates } = await auditOrphanMedia({
    client,
    bucket: 'support-assets',
    graceHours: 24,
  });

  assert.equal(candidates.length, 1, 'Unreferenced content must be flagged even if media_files has a row');
  assert.equal(candidates[0].storage_key, staleKey);
  assert.equal(candidates[0].has_media_files_row, true);
  assert.equal(candidates[0].sop_id, 'OLD-SOP-999');
});

// -----------------------------------------------------------------------------
// 9. Dry-run contains no Storage deletion
// -----------------------------------------------------------------------------
test('9. dry-run contains no Storage deletion', async () => {
  let storageDeleteCalled = false;
  let mfDeleteCalled = false;

  const client = createMockClient({
    onStorageRemove: () => {
      storageDeleteCalled = true;
      return { error: null };
    },
    onMediaFilesDelete: () => {
      mfDeleteCalled = true;
    },
  });

  // Calling auditOrphanMedia must be purely read-only
  await auditOrphanMedia({ client, bucket: 'support-assets', graceHours: 24 });

  assert.equal(storageDeleteCalled, false, 'auditOrphanMedia must never call storage remove');
  assert.equal(mfDeleteCalled, false, 'auditOrphanMedia must never delete media_files rows');
});

// -----------------------------------------------------------------------------
// 10. Apply mode requires explicit --apply
// -----------------------------------------------------------------------------
test('10. apply mode requires explicit --apply', () => {
  const defaultOpts = parseArgs([]);
  assert.equal(defaultOpts.apply, false, 'Default options must have apply = false');

  const graceOnlyOpts = parseArgs(['--grace-hours', '48']);
  assert.equal(graceOnlyOpts.apply, false, 'Passing other flags without --apply must have apply = false');

  const applyOpts = parseArgs(['--apply']);
  assert.equal(applyOpts.apply, true, '--apply flag sets apply = true');
});

// -----------------------------------------------------------------------------
// 11. Storage deletion occurs before media_files metadata deletion
// -----------------------------------------------------------------------------
test('11. Storage deletion occurs before media_files metadata deletion', async () => {
  const executionOrder = [];

  const client = {
    storage: {
      from: () => ({
        remove: async (keys) => {
          executionOrder.push(`storage.remove:${keys[0]}`);
          return { error: null };
        },
      }),
    },
    from: (table) => {
      if (table === 'media_files') {
        return {
          delete: () => ({
            eq: async (col, val) => {
              executionOrder.push(`media_files.delete:${val}`);
              return { error: null };
            },
          }),
        };
      }
      return {};
    },
  };

  const candidate = {
    storage_key: 'guides/pending/orphan-example.png',
    has_media_files_row: true,
  };

  const result = await deleteOrphanObject({ client, bucket: 'support-assets', candidate });

  assert.equal(result.success, true);
  assert.deepEqual(executionOrder, [
    'storage.remove:guides/pending/orphan-example.png',
    'media_files.delete:guides/pending/orphan-example.png',
  ], 'Storage remove must occur BEFORE media_files row delete');

  // Test failure case: If storage deletion fails, media_files must NOT be touched
  executionOrder.length = 0;
  const failingStorageClient = {
    storage: {
      from: () => ({
        remove: async () => ({ error: new Error('Storage network timeout') }),
      }),
    },
    from: (_table) => ({
      delete: () => ({
        eq: async () => {
          executionOrder.push('media_files.delete');
          return { error: null };
        },
      }),
    }),
  };

  const failResult = await deleteOrphanObject({ client: failingStorageClient, bucket: 'support-assets', candidate });
  assert.equal(failResult.success, false);
  assert.ok(failResult.error.includes('Storage deletion failed'));
  assert.equal(executionOrder.length, 0, 'media_files must NOT be touched when Storage deletion fails');
});

// -----------------------------------------------------------------------------
// 12. No service-role secret is stored in source
// -----------------------------------------------------------------------------
test('12. no service-role secret is stored in source', () => {
  const root = process.cwd();
  const scriptContent = readFileSync(join(root, 'scripts', 'prune_orphan_media.mjs'), 'utf-8');
  const migrationContent = readFileSync(join(root, 'supabase', 'migrations', '16_orphan_media_audit.sql'), 'utf-8');

  // Check for common JWT pattern for service_role or hardcoded secret
  const jwtRegex = /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g;

  // The script should not have embedded JWT secrets
  const scriptJwtMatches = scriptContent.match(jwtRegex) || [];
  assert.equal(scriptJwtMatches.length, 0, 'scripts/prune_orphan_media.mjs must not contain JWT secrets');

  // The migration should not have embedded JWT secrets
  const migrationJwtMatches = migrationContent.match(jwtRegex) || [];
  assert.equal(migrationJwtMatches.length, 0, '16_orphan_media_audit.sql must not contain JWT secrets');

  // Check that SUPABASE_SERVICE_ROLE_KEY is referenced only as an environment variable
  assert.ok(
    scriptContent.includes('process.env.SUPABASE_SERVICE_ROLE_KEY') || scriptContent.includes('env.SUPABASE_SERVICE_ROLE_KEY'),
    'Script must read SUPABASE_SERVICE_ROLE_KEY from environment variables'
  );
});

// -----------------------------------------------------------------------------
// 13. Migration 16 security and structure invariants
// -----------------------------------------------------------------------------
test('13. Migration 16 contains required security definer, search_path, and revoke blocks', () => {
  const root = process.cwd();
  const sql = readFileSync(join(root, 'supabase', 'migrations', '16_orphan_media_audit.sql'), 'utf-8');

  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.fn_audit_orphan_media'), 'Must define public.fn_audit_orphan_media');
  assert.ok(sql.includes('SECURITY DEFINER'), 'Must be SECURITY DEFINER');
  assert.ok(sql.includes("SET search_path = ''"), "search_path must be empty string");
  assert.ok(sql.includes('STABLE'), 'Must be marked STABLE (read-only)');
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.fn_audit_orphan_media(INTEGER) FROM PUBLIC;'), 'Must revoke from PUBLIC');
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.fn_audit_orphan_media(INTEGER) FROM anon;'), 'Must revoke from anon');
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.fn_audit_orphan_media(INTEGER) FROM authenticated;'), 'Must revoke from authenticated');
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.fn_audit_orphan_media(INTEGER) TO service_role;'), 'Must grant to service_role');
  assert.ok(!sql.includes('DELETE FROM'), 'Must not contain DELETE statements');
  assert.ok(!sql.includes('DROP TABLE'), 'Must not contain DROP statements');
});
