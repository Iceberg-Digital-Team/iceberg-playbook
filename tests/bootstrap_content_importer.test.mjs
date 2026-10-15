// ==============================================================================
// ICEBERG PLAYBOOK - TESTS
// tests/bootstrap_content_importer.test.mjs
//
// Purpose:
// Comprehensive unit and integration test suite for Bootstrap Phase 2 Importer.
// Tests the 20 critical invariants, safety guarantees, dry-run neutrality,
// and adapter boundaries.
// ==============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  parseArgs,
  computeBootstrapPlan,
  executeBootstrapPlan,
  runBootstrapImporter,
  resolveLocalAsset,
  semanticJsonEqual,
  areSopsEqual,
} from '../scripts/bootstrap_content.mjs';

// -----------------------------------------------------------------------------
// Mock Bootstrap Adapter Implementation
// -----------------------------------------------------------------------------
class MockBootstrapAdapter {
  constructor({ playbooks = [], sops = [], storage = [], mediaFiles = [] } = {}) {
    this.bucket = 'support-assets';
    this.playbooks = new Map(playbooks.map(pb => [pb.id || pb.slug, { ...pb }]));
    this.sops = new Map(sops.map(s => [s.id, { ...s }]));
    this.storage = new Set(storage);
    this.mediaFiles = new Map(mediaFiles.map(m => [m.storage_key, { ...m }]));
    this.sopCounter = 1;
    this.mutations = [];
    this.calls = [];
  }

  recordCall(method, args) {
    this.calls.push({ method, args });
  }

  recordMutation(method, args) {
    this.mutations.push({ method, args });
  }

  async getPlaybook(key) {
    this.recordCall('getPlaybook', [key]);
    const pb = this.playbooks.get(key);
    if (!pb) return { found: false, playbook: null, isDeleted: false };
    return { found: true, playbook: { ...pb }, isDeleted: pb.deleted_at !== null };
  }

  async createPlaybook(data) {
    this.recordMutation('createPlaybook', [data]);
    const id = data.id || data.key;
    const row = {
      id,
      slug: data.slug || data.key,
      name: data.name,
      code: data.code,
      description: data.description,
      icon: data.icon || 'Compass',
      owner: data.owner || 'Support Operations',
      visibility: data.visibility || 'Internal',
      deleted_at: null,
      deleted_by: null,
      created_at: '2026-10-15T12:00:00Z',
      updated_at: '2026-10-15T12:00:00Z',
    };
    this.playbooks.set(id, row);
    return { ...row };
  }

  async restorePlaybook(id) {
    this.recordMutation('restorePlaybook', [id]);
    const pb = this.playbooks.get(id);
    if (pb) {
      pb.deleted_at = null;
      pb.deleted_by = null;
      pb.updated_at = new Date().toISOString();
    }
  }

  async updatePlaybook(id, metadata) {
    this.recordMutation('updatePlaybook', [id, metadata]);
    const pb = this.playbooks.get(id);
    if (pb) {
      Object.assign(pb, metadata, { updated_at: new Date().toISOString() });
    }
    return { ...pb };
  }

  async findSopByBootstrapKey(playbookId, bootstrapKey) {
    this.recordCall('findSopByBootstrapKey', [playbookId, bootstrapKey]);
    for (const sop of this.sops.values()) {
      if (sop.playbook_id === playbookId && sop.bootstrap_key === bootstrapKey) {
        return { found: true, sop: { ...sop }, isDeleted: sop.deleted_at !== null };
      }
    }
    return { found: false, sop: null, isDeleted: false };
  }

  async findUntaggedSopByTitle(playbookId, title) {
    this.recordCall('findUntaggedSopByTitle', [playbookId, title]);
    for (const sop of this.sops.values()) {
      if (sop.playbook_id === playbookId && sop.title === title && !sop.bootstrap_key) {
        return { found: true, sop: { ...sop }, isDeleted: sop.deleted_at !== null };
      }
    }
    return { found: false, sop: null, isDeleted: false };
  }

  async generateSopCode(playbookId) {
    this.recordCall('generateSopCode', [playbookId]);
    let max = 0;
    for (const id of this.sops.keys()) {
      const match = String(id).match(/SOP(\d+)$/);
      if (match) {
        max = Math.max(max, parseInt(match[1], 10));
      }
    }
    const next = max + 1;
    return `GS-SOP${String(next).padStart(2, '0')}`;
  }

  async createSop(data) {
    this.recordMutation('createSop', [data]);
    const row = {
      ...data,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
      deleted_by: null,
    };
    this.sops.set(row.id, row);
    return { ...row };
  }

  async updateSop(id, data) {
    this.recordMutation('updateSop', [id, data]);
    const sop = this.sops.get(id);
    if (sop) {
      Object.assign(sop, data, { updated_at: new Date().toISOString() });
    }
    return { ...sop };
  }

  async restoreSop(id, updates = {}) {
    this.recordMutation('restoreSop', [id, updates]);
    const sop = this.sops.get(id);
    if (sop) {
      Object.assign(sop, updates, {
        deleted_at: null,
        deleted_by: null,
        updated_at: new Date().toISOString(),
      });
    }
    return { ...sop };
  }

  async checkStorageObjectExists(bucket, key) {
    this.recordCall('checkStorageObjectExists', [bucket, key]);
    return this.storage.has(key);
  }

  async uploadStorageObject(bucket, key, _buffer, _contentType) {
    this.recordMutation('uploadStorageObject', [bucket, key]);
    this.storage.add(key);
  }

  async ensureMediaFileRecord(record) {
    this.recordMutation('ensureMediaFileRecord', [record]);
    this.mediaFiles.set(record.storage_key, { ...record });
  }

  async linkSopMedia(sopId, keys) {
    this.recordMutation('linkSopMedia', [sopId, keys]);
    for (const k of keys) {
      const mf = this.mediaFiles.get(k);
      if (mf) mf.sop_id = sopId;
    }
    return keys.length;
  }
}

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------
const rootDir = process.cwd();
const bootstrapDir = path.resolve(rootDir, 'bootstrap');
const defaultContentPath = path.resolve(bootstrapDir, 'default-content.json');
const canonicalBundle = JSON.parse(fs.readFileSync(defaultContentPath, 'utf-8'));

// -----------------------------------------------------------------------------
// Test 1: Default command is dry-run
// -----------------------------------------------------------------------------
test('1. default command is dry-run', () => {
  const options = parseArgs([]);
  assert.equal(options.apply, false, 'Default command must be dry-run (apply=false)');
  assert.equal(options.help, false);
  assert.ok(options.bundlePath.endsWith('default-content.json'));

  const applyOptions = parseArgs(['--apply']);
  assert.equal(applyOptions.apply, true, '--apply flag sets apply=true');
});

// -----------------------------------------------------------------------------
// Test 2: Dry-run performs zero mutations
// -----------------------------------------------------------------------------
test('2. dry-run performs zero mutations', async () => {
  const adapter = new MockBootstrapAdapter({
    playbooks: [
      {
        id: 'getting-started',
        slug: 'getting-started',
        name: 'Getting Started',
        code: 'GS',
        description: 'Old description',
        icon: 'Globe',
        visibility: 'Public',
        deleted_at: '2026-10-05T09:29:42Z',
      },
    ],
  });

  const exitCode = await runBootstrapImporter({
    argv: [],
    adapter,
  });

  assert.equal(exitCode, 0, 'Dry-run should exit with 0');
  assert.equal(adapter.mutations.length, 0, 'Dry-run must perform zero mutations');
  assert.ok(adapter.calls.length > 0, 'Dry-run should execute read queries to calculate plan');
});

// -----------------------------------------------------------------------------
// Test 3: Getting Started soft-deleted row -> planned restore
// -----------------------------------------------------------------------------
test('3. Getting Started soft-deleted row -> planned restore', async () => {
  const adapter = new MockBootstrapAdapter({
    playbooks: [
      {
        id: 'getting-started',
        slug: 'getting-started',
        name: 'Getting Started',
        code: 'GS',
        description: 'Old desc',
        icon: 'Globe',
        visibility: 'Public',
        deleted_at: '2026-10-05T09:29:42Z',
      },
    ],
  });

  const plan = await computeBootstrapPlan({
    bundle: canonicalBundle,
    adapter,
    bootstrapDir,
  });

  assert.equal(plan.playbooks.length, 1);
  const pbAction = plan.playbooks[0];
  assert.equal(pbAction.action, 'RESTORE');
  assert.equal(pbAction.key, 'getting-started');
  assert.equal(pbAction.metadataDiffers, true);
  assert.equal(plan.summary.playbooks.restore, 1);
});

// -----------------------------------------------------------------------------
// Test 4: Getting Started active/identical -> no-op
// -----------------------------------------------------------------------------
test('4. Getting Started active/identical -> no-op', async () => {
  const adapter = new MockBootstrapAdapter({
    playbooks: [
      {
        id: 'getting-started',
        slug: 'getting-started',
        name: 'Getting Started',
        code: 'GS',
        description: canonicalBundle.playbooks[0].description,
        icon: canonicalBundle.playbooks[0].icon,
        visibility: canonicalBundle.playbooks[0].visibility,
        deleted_at: null,
      },
    ],
  });

  const plan = await computeBootstrapPlan({
    bundle: canonicalBundle,
    adapter,
    bootstrapDir,
  });

  assert.equal(plan.playbooks.length, 1);
  assert.equal(plan.playbooks[0].action, 'NOOP');
  assert.equal(plan.summary.playbooks.noop, 1);
});

// -----------------------------------------------------------------------------
// Test 5: First-run plans 5 SOP creates
// -----------------------------------------------------------------------------
test('5. first-run plans 5 SOP creates', async () => {
  const adapter = new MockBootstrapAdapter({
    playbooks: [
      {
        id: 'getting-started',
        slug: 'getting-started',
        name: 'Getting Started',
        code: 'GS',
        deleted_at: null,
      },
    ],
    sops: [],
  });

  const plan = await computeBootstrapPlan({
    bundle: canonicalBundle,
    adapter,
    bootstrapDir,
  });

  assert.equal(plan.sops.length, 5);
  assert.equal(plan.summary.sops.create, 5);
  for (const sopPlan of plan.sops) {
    assert.equal(sopPlan.action, 'CREATE');
    assert.ok(sopPlan.key.startsWith('how-to-'));
  }
});

// -----------------------------------------------------------------------------
// Test 6: Apply creates bootstrap_key ownership
// -----------------------------------------------------------------------------
test('6. apply creates bootstrap_key ownership', async () => {
  const adapter = new MockBootstrapAdapter({
    playbooks: [
      {
        id: 'getting-started',
        slug: 'getting-started',
        name: 'Getting Started',
        code: 'GS',
        description: 'Old',
        icon: 'Globe',
        visibility: 'Public',
        deleted_at: '2026-10-05T09:29:42Z',
      },
    ],
  });

  const exitCode = await runBootstrapImporter({
    argv: ['--apply'],
    adapter,
  });

  assert.equal(exitCode, 0);

  // Verify Playbook restored
  const pb = adapter.playbooks.get('getting-started');
  assert.equal(pb.deleted_at, null, 'Playbook must be restored');
  assert.equal(pb.description, canonicalBundle.playbooks[0].description);

  // Verify 5 SOPs created with explicit bootstrap_key
  assert.equal(adapter.sops.size, 5);
  for (const sop of adapter.sops.values()) {
    assert.ok(sop.bootstrap_key, 'SOP must have bootstrap_key');
    assert.ok(canonicalBundle.sops.some(s => s.key === sop.bootstrap_key));
    assert.equal(sop.playbook_id, 'getting-started');
  }
});

// -----------------------------------------------------------------------------
// Test 7: Second run is full no-op
// -----------------------------------------------------------------------------
test('7. second run is full no-op', async () => {
  const adapter = new MockBootstrapAdapter({
    playbooks: [
      {
        id: 'getting-started',
        slug: 'getting-started',
        name: 'Getting Started',
        code: 'GS',
        description: 'Old',
        deleted_at: '2026-10-05T09:29:42Z',
      },
    ],
  });

  // First run: apply
  await runBootstrapImporter({ argv: ['--apply'], adapter });
  adapter.mutations = []; // reset mutation tracker

  // Second run: dry run
  const plan = await computeBootstrapPlan({
    bundle: canonicalBundle,
    adapter,
    bootstrapDir,
  });

  assert.equal(plan.summary.playbooks.create, 0);
  assert.equal(plan.summary.playbooks.update, 0);
  assert.equal(plan.summary.playbooks.restore, 0);
  assert.equal(plan.summary.playbooks.noop, 1);

  assert.equal(plan.summary.sops.create, 0);
  assert.equal(plan.summary.sops.update, 0);
  assert.equal(plan.summary.sops.restore, 0);
  assert.equal(plan.summary.sops.conflict, 0);
  assert.equal(plan.summary.sops.noop, 5);

  assert.equal(plan.summary.assets.upload, 0);

  // Second run with --apply: executes 0 mutations
  const secondExit = await runBootstrapImporter({ argv: ['--apply'], adapter });
  assert.equal(secondExit, 0);
  assert.equal(adapter.mutations.length, 0, 'Second run must perform 0 database mutations');
});

// -----------------------------------------------------------------------------
// Test 8: bootstrap_key mapping is authoritative
// -----------------------------------------------------------------------------
test('8. bootstrap_key mapping is authoritative', async () => {
  // Existing SOP has modified title in DB, but matches canonical bootstrap_key
  const adapter = new MockBootstrapAdapter({
    playbooks: [
      {
        id: 'getting-started',
        slug: 'getting-started',
        name: 'Getting Started',
        code: 'GS',
        deleted_at: null,
      },
    ],
    sops: [
      {
        id: 'GS-SOP99',
        playbook_id: 'getting-started',
        bootstrap_key: 'how-to-use-playbooks',
        title: 'Custom User Renamed Title',
        owner: 'Support Operations',
        status: 'Verified',
        deleted_at: null,
      },
    ],
  });

  const plan = await computeBootstrapPlan({
    bundle: canonicalBundle,
    adapter,
    bootstrapDir,
  });

  const matchingPlan = plan.sops.find(s => s.key === 'how-to-use-playbooks');
  assert.ok(matchingPlan);
  assert.equal(matchingPlan.action, 'UPDATE', 'Must match by bootstrap_key and plan UPDATE, not CREATE');
  assert.equal(matchingPlan.id, 'GS-SOP99', 'Must target existing SOP id');
});

// -----------------------------------------------------------------------------
// Test 9: Same-title untagged SOP causes conflict, never adoption
// -----------------------------------------------------------------------------
test('9. same-title untagged SOP causes conflict, never adoption', async () => {
  const adapter = new MockBootstrapAdapter({
    playbooks: [
      {
        id: 'getting-started',
        slug: 'getting-started',
        name: 'Getting Started',
        code: 'GS',
        deleted_at: null,
      },
    ],
    sops: [
      {
        id: 'GS-SOP01',
        playbook_id: 'getting-started',
        bootstrap_key: null, // UNTAGGED
        title: 'How to Use Playbooks', // Exact title collision
        deleted_at: null,
      },
    ],
  });

  const plan = await computeBootstrapPlan({
    bundle: canonicalBundle,
    adapter,
    bootstrapDir,
  });

  assert.equal(plan.hasConflicts, true, 'Plan must flag conflict');
  const conflict = plan.sops.find(s => s.action === 'CONFLICT');
  assert.ok(conflict, 'Untagged title match must create CONFLICT action');
  assert.equal(conflict.key, 'how-to-use-playbooks');
  assert.equal(conflict.conflictingSopId, 'GS-SOP01');

  // Verify apply mode fails closed and skips mutation
  await assert.rejects(
    async () => {
      await executeBootstrapPlan({ plan, adapter });
    },
    /Untagged same-title SOP conflicts detected/,
    'Apply execution must fail closed'
  );

  // Untagged SOP must not have been modified
  const sop = adapter.sops.get('GS-SOP01');
  assert.equal(sop.bootstrap_key, null, 'Must never automatically adopt untagged SOP');
});

// -----------------------------------------------------------------------------
// Test 10: Soft-deleted matching bootstrap SOP is restored
// -----------------------------------------------------------------------------
test('10. soft-deleted matching bootstrap SOP is restored', async () => {
  const adapter = new MockBootstrapAdapter({
    playbooks: [
      {
        id: 'getting-started',
        slug: 'getting-started',
        name: 'Getting Started',
        code: 'GS',
        deleted_at: null,
      },
    ],
    sops: [
      {
        id: 'GS-SOP02',
        playbook_id: 'getting-started',
        bootstrap_key: 'how-to-use-playbooks',
        title: 'How to Use Playbooks',
        deleted_at: '2026-10-10T10:00:00Z',
      },
    ],
  });

  const plan = await computeBootstrapPlan({
    bundle: canonicalBundle,
    adapter,
    bootstrapDir,
  });

  const sopPlan = plan.sops.find(s => s.key === 'how-to-use-playbooks');
  assert.equal(sopPlan.action, 'RESTORE');
  assert.equal(sopPlan.id, 'GS-SOP02');

  await executeBootstrapPlan({ plan, adapter });

  const restored = adapter.sops.get('GS-SOP02');
  assert.equal(restored.deleted_at, null, 'SOP must be restored');
  assert.equal(restored.bootstrap_key, 'how-to-use-playbooks');
  assert.equal(adapter.sops.size, 5, 'Should not create duplicate');
});

// -----------------------------------------------------------------------------
// Test 11: Bundle content update updates same SOP id
// -----------------------------------------------------------------------------
test('11. bundle content update updates same SOP id', async () => {
  const adapter = new MockBootstrapAdapter({
    playbooks: [
      {
        id: 'getting-started',
        slug: 'getting-started',
        name: 'Getting Started',
        code: 'GS',
        deleted_at: null,
      },
    ],
    sops: [
      {
        id: 'GS-SOP02',
        playbook_id: 'getting-started',
        bootstrap_key: 'how-to-use-playbooks',
        title: 'How to Use Playbooks',
        purpose: 'Old purpose statement',
        deleted_at: null,
      },
    ],
  });

  const plan = await computeBootstrapPlan({
    bundle: canonicalBundle,
    adapter,
    bootstrapDir,
  });

  const sopPlan = plan.sops.find(s => s.key === 'how-to-use-playbooks');
  assert.equal(sopPlan.action, 'UPDATE');
  assert.equal(sopPlan.id, 'GS-SOP02');

  await executeBootstrapPlan({ plan, adapter });

  const updated = adapter.sops.get('GS-SOP02');
  assert.equal(updated.id, 'GS-SOP02', 'Preserves original generated ID');
  assert.equal(updated.purpose, canonicalBundle.sops[0].purpose, 'Updates canonical purpose');
});

// -----------------------------------------------------------------------------
// Test 12: External HTTPS media remains unchanged
// -----------------------------------------------------------------------------
test('12. external HTTPS media remains unchanged', async () => {
  const customBundle = {
    ...canonicalBundle,
    sops: [
      {
        ...canonicalBundle.sops[0],
        steps: [
          {
            number: 1,
            title: 'External link step',
            description: 'Check cloud dashboard',
            screenshot: 'https://example.com/cdn/dashboard.png',
          },
        ],
      },
    ],
  };

  const adapter = new MockBootstrapAdapter();
  const plan = await computeBootstrapPlan({
    bundle: customBundle,
    adapter,
    bootstrapDir,
  });

  const sopPlan = plan.sops[0];
  assert.equal(sopPlan.resolvedSteps[0].screenshot, 'https://example.com/cdn/dashboard.png');
  assert.equal(plan.assets.length, 0, 'No local assets queued for upload');
});

// -----------------------------------------------------------------------------
// Test 13: Local media uses SHA-256 content-addressed path
// -----------------------------------------------------------------------------
test('13. local media uses SHA-256 content-addressed path', () => {
  // Create a temporary asset in bootstrap/assets/getting-started/sops
  const tempAssetDir = path.resolve(bootstrapDir, 'assets', 'getting-started', 'sops');
  fs.mkdirSync(tempAssetDir, { recursive: true });
  const tempAssetFile = path.resolve(tempAssetDir, 'test-diagram.png');
  const dummyContent = Buffer.from('PNG_FAKE_IMAGE_DATA_12345');
  fs.writeFileSync(tempAssetFile, dummyContent);

  try {
    const asset = resolveLocalAsset({
      relativePath: 'assets/getting-started/sops/test-diagram.png',
      bootstrapDir,
      playbookKey: 'getting-started',
      sopKey: 'how-to-use-playbooks',
    });

    const expectedHash = crypto.createHash('sha256').update(dummyContent).digest('hex');
    assert.equal(asset.hash, expectedHash);
    assert.equal(
      asset.storageKey,
      `sops/bootstrap/getting-started/how-to-use-playbooks/${expectedHash}-test-diagram.png`
    );
    assert.equal(asset.contentType, 'image/png');
    assert.equal(asset.mediaType, 'image');
  } finally {
    if (fs.existsSync(tempAssetFile)) {
      fs.unlinkSync(tempAssetFile);
    }
  }
});

// -----------------------------------------------------------------------------
// Test 14: Unchanged asset is not re-uploaded
// -----------------------------------------------------------------------------
test('14. unchanged asset is not re-uploaded', async () => {
  const tempAssetDir = path.resolve(bootstrapDir, 'assets', 'getting-started', 'sops');
  fs.mkdirSync(tempAssetDir, { recursive: true });
  const tempAssetFile = path.resolve(tempAssetDir, 'existing-diagram.png');
  const dummyContent = Buffer.from('IDENTICAL_CONTENT_BUFFER');
  fs.writeFileSync(tempAssetFile, dummyContent);

  try {
    const asset = resolveLocalAsset({
      relativePath: 'assets/getting-started/sops/existing-diagram.png',
      bootstrapDir,
      playbookKey: 'getting-started',
      sopKey: 'how-to-use-playbooks',
    });

    // Adapter already has this storage key
    const adapter = new MockBootstrapAdapter({
      storage: [asset.storageKey],
    });

    const customBundle = {
      ...canonicalBundle,
      sops: [
        {
          ...canonicalBundle.sops[0],
          steps: [
            {
              number: 1,
              title: 'Step 1',
              description: 'Desc',
              screenshot: 'assets/getting-started/sops/existing-diagram.png',
            },
          ],
        },
      ],
    };

    const plan = await computeBootstrapPlan({
      bundle: customBundle,
      adapter,
      bootstrapDir,
    });

    const assetAction = plan.assets.find(a => a.storageKey === asset.storageKey);
    assert.ok(assetAction);
    assert.equal(assetAction.action, 'NOOP');
    assert.equal(plan.summary.assets.upload, 0);
  } finally {
    if (fs.existsSync(tempAssetFile)) {
      fs.unlinkSync(tempAssetFile);
    }
  }
});

// -----------------------------------------------------------------------------
// Test 15: Changed asset gets new key
// -----------------------------------------------------------------------------
test('15. changed asset gets new key', () => {
  const tempAssetDir = path.resolve(bootstrapDir, 'assets', 'getting-started', 'sops');
  fs.mkdirSync(tempAssetDir, { recursive: true });
  const tempAssetFile = path.resolve(tempAssetDir, 'changing-diagram.png');

  try {
    fs.writeFileSync(tempAssetFile, Buffer.from('VERSION_ONE'));
    const asset1 = resolveLocalAsset({
      relativePath: 'assets/getting-started/sops/changing-diagram.png',
      bootstrapDir,
      playbookKey: 'getting-started',
      sopKey: 'how-to-use-playbooks',
    });

    fs.writeFileSync(tempAssetFile, Buffer.from('VERSION_TWO'));
    const asset2 = resolveLocalAsset({
      relativePath: 'assets/getting-started/sops/changing-diagram.png',
      bootstrapDir,
      playbookKey: 'getting-started',
      sopKey: 'how-to-use-playbooks',
    });

    assert.notEqual(asset1.hash, asset2.hash);
    assert.notEqual(asset1.storageKey, asset2.storageKey);
    assert.ok(asset1.storageKey.includes(asset1.hash));
    assert.ok(asset2.storageKey.includes(asset2.hash));
  } finally {
    if (fs.existsSync(tempAssetFile)) {
      fs.unlinkSync(tempAssetFile);
    }
  }
});

// -----------------------------------------------------------------------------
// Test 16: Old asset is not deleted
// -----------------------------------------------------------------------------
test('16. old asset is not deleted', async () => {
  const oldKey = 'sops/bootstrap/getting-started/how-to-use-playbooks/oldhash-diagram.png';
  const adapter = new MockBootstrapAdapter({
    storage: [oldKey],
  });

  const plan = await computeBootstrapPlan({
    bundle: canonicalBundle,
    adapter,
    bootstrapDir,
  });

  await executeBootstrapPlan({ plan, adapter });

  assert.ok(adapter.storage.has(oldKey), 'Old storage asset must remain intact and not deleted');
});

// -----------------------------------------------------------------------------
// Test 17: No Guide/Issue/Admin/User mutations
// -----------------------------------------------------------------------------
test('17. no Guide/Issue/Admin/User mutations', () => {
  const adapterCode = fs.readFileSync(
    path.resolve(rootDir, 'scripts/lib/bootstrap/supabase_adapter.mjs'),
    'utf-8'
  );
  const importerCode = fs.readFileSync(
    path.resolve(rootDir, 'scripts/bootstrap_content.mjs'),
    'utf-8'
  );

  const combined = adapterCode + '\n' + importerCode;

  // Verify no mutation calls against guides, issues, profiles, auth
  assert.ok(!combined.includes(".from('guides').insert"), 'No guides insert');
  assert.ok(!combined.includes(".from('guides').update"), 'No guides update');
  assert.ok(!combined.includes(".from('issues').insert"), 'No issues insert');
  assert.ok(!combined.includes(".from('issues').update"), 'No issues update');
  assert.ok(!combined.includes(".from('profiles')"), 'No profiles access');
  assert.ok(!combined.includes('.auth.admin'), 'No auth admin calls');
});

// -----------------------------------------------------------------------------
// Test 18: No hard-delete logic
// -----------------------------------------------------------------------------
test('18. no hard-delete logic', () => {
  const adapterCode = fs.readFileSync(
    path.resolve(rootDir, 'scripts/lib/bootstrap/supabase_adapter.mjs'),
    'utf-8'
  );
  const importerCode = fs.readFileSync(
    path.resolve(rootDir, 'scripts/bootstrap_content.mjs'),
    'utf-8'
  );

  const combined = adapterCode + '\n' + importerCode;

  assert.ok(!combined.includes(".delete()"), 'No table .delete() operations allowed');
  assert.ok(!combined.includes('.storage.from(') || !combined.includes('.remove('), 'No storage .remove() operations allowed');
  assert.ok(!/DELETE\s+FROM/i.test(combined), 'No raw SQL DELETE statements');
  assert.ok(!/TRUNCATE/i.test(combined), 'No TRUNCATE statements');
  assert.ok(!/DROP\s+TABLE/i.test(combined), 'No DROP statements');
});

// -----------------------------------------------------------------------------
// Test 19: Supabase imports exist only in the adapter layer
// -----------------------------------------------------------------------------
test('19. Supabase imports exist only in the adapter layer', () => {
  const importerCode = fs.readFileSync(
    path.resolve(rootDir, 'scripts/bootstrap_content.mjs'),
    'utf-8'
  );
  const validatorCode = fs.readFileSync(
    path.resolve(rootDir, 'bootstrap/validate.mjs'),
    'utf-8'
  );

  assert.ok(
    !importerCode.includes('@supabase/supabase-js'),
    'scripts/bootstrap_content.mjs must NOT import @supabase/supabase-js'
  );
  assert.ok(
    !validatorCode.includes('@supabase/supabase-js'),
    'bootstrap/validate.mjs must NOT import @supabase/supabase-js'
  );

  const adapterCode = fs.readFileSync(
    path.resolve(rootDir, 'scripts/lib/bootstrap/supabase_adapter.mjs'),
    'utf-8'
  );
  assert.ok(
    adapterCode.includes('@supabase/supabase-js'),
    'scripts/lib/bootstrap/supabase_adapter.mjs is the sole owner of @supabase/supabase-js'
  );
});

// -----------------------------------------------------------------------------
// Test 20: No secret values exist in source
// -----------------------------------------------------------------------------
test('20. no secret values exist in source', () => {
  const scriptFiles = [
    'scripts/bootstrap_content.mjs',
    'scripts/lib/bootstrap/supabase_adapter.mjs',
    'tests/bootstrap_content_importer.test.mjs',
  ];

  const sensitivePattern = /eyJh[a-zA-Z0-9_-]{30,}|sbp_[a-zA-Z0-9]{20,}/;

  for (const file of scriptFiles) {
    const content = fs.readFileSync(path.resolve(rootDir, file), 'utf-8');
    assert.ok(
      !sensitivePattern.test(content),
      `File ${file} must not contain embedded JWT or Supabase service keys`
    );
  }
});

import { SupabaseBootstrapAdapter } from '../scripts/lib/bootstrap/supabase_adapter.mjs';

test('21. SupabaseBootstrapAdapter fulfills adapter contract with Supabase client', async () => {
  const queryLog = [];
  const fakeClient = {
    from: (table) => {
      queryLog.push(`from:${table}`);
      return {
        select: (cols) => {
          queryLog.push(`select:${cols}`);
          return {
            or: (filter) => {
              queryLog.push(`or:${filter}`);
              return {
                maybeSingle: async () => ({
                  data: {
                    id: 'getting-started',
                    slug: 'getting-started',
                    name: 'Getting Started',
                    code: 'GS',
                    deleted_at: '2026-10-05T00:00:00Z',
                  },
                  error: null,
                }),
              };
            },
            eq: (col1, val1) => {
              queryLog.push(`eq:${col1}=${val1}`);
              return {
                eq: (col2, val2) => {
                  queryLog.push(`eq:${col2}=${val2}`);
                  return {
                    maybeSingle: async () => ({
                      data: { id: 'GS-SOP02', playbook_id: val1, bootstrap_key: val2, deleted_at: null },
                      error: null,
                    }),
                  };
                },
                is: (col2, val2) => {
                  queryLog.push(`is:${col2}=${val2}`);
                  return {
                    maybeSingle: async () => ({
                      data: null,
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        },
        insert: (data) => {
          queryLog.push(`insert:${JSON.stringify(data)}`);
          return {
            select: () => ({
              single: async () => ({ data: { id: data.id || 'GS-SOP02', ...data }, error: null }),
            }),
          };
        },
        update: (data) => {
          queryLog.push(`update:${JSON.stringify(data)}`);
          return {
            eq: (col, val) => {
              queryLog.push(`eq:${col}=${val}`);
              return {
                select: () => ({
                  single: async () => ({ data: { id: val, ...data }, error: null }),
                }),
              };
            },
          };
        },
        upsert: async (data) => {
          queryLog.push(`upsert:${data.storage_key}`);
          return { error: null };
        },
      };
    },
    rpc: async (fn, params) => {
      queryLog.push(`rpc:${fn}:${JSON.stringify(params)}`);
      if (fn === 'fn_generate_sop_code') return { data: 'GS-SOP02', error: null };
      if (fn === 'fn_link_sop_media') return { data: 1, error: null };
      if (fn === 'fn_restore_playbook') return { data: null, error: null };
      return { data: null, error: null };
    },
    storage: {
      from: (bucket) => {
        queryLog.push(`storage.from:${bucket}`);
        return {
          list: async (folder, opts) => {
            queryLog.push(`storage.list:${folder}:${JSON.stringify(opts)}`);
            return { data: [{ name: 'existing.png' }], error: null };
          },
          upload: async (key) => {
            queryLog.push(`storage.upload:${key}`);
            return { error: null };
          },
        };
      },
    },
  };

  const adapter = new SupabaseBootstrapAdapter({ client: fakeClient });

  // 1. Playbook lookup & restore
  const pbRes = await adapter.getPlaybook('getting-started');
  assert.equal(pbRes.found, true);
  assert.equal(pbRes.isDeleted, true);

  await adapter.restorePlaybook('getting-started');

  // 2. SOP code generation & linking
  const code = await adapter.generateSopCode('getting-started');
  assert.equal(code, 'GS-SOP02');

  const linked = await adapter.linkSopMedia('GS-SOP02', ['sops/bootstrap/gs/s1/img.png']);
  assert.equal(linked, 1);

  // 3. Storage inspection
  const exists = await adapter.checkStorageObjectExists('support-assets', 'sops/bootstrap/gs/existing.png');
  assert.equal(exists, true);

  assert.ok(queryLog.some(q => q.includes('rpc:fn_restore_playbook')));
  assert.ok(queryLog.some(q => q.includes('rpc:fn_generate_sop_code')));
  assert.ok(queryLog.some(q => q.includes('rpc:fn_link_sop_media')));
});

// -----------------------------------------------------------------------------
// Test 21-26: Semantic JSON equality for Postgres JSONB structures
// -----------------------------------------------------------------------------
test('21. semantic JSON equality: JSON objects with different key order compare equal', () => {
  const objA = { number: 1, title: 'Navigate the Playbook Directory', estimatedTime: '2 min' };
  const objB = { title: 'Navigate the Playbook Directory', estimatedTime: '2 min', number: 1 };
  assert.equal(semanticJsonEqual(objA, objB), true);
});

test('22. semantic JSON equality: nested objects with different key order compare equal', () => {
  const nestedA = {
    step: {
      number: 1,
      meta: { scope: 'support', code: 'GS' },
    },
    tags: ['a', 'b'],
  };
  const nestedB = {
    tags: ['a', 'b'],
    step: {
      meta: { code: 'GS', scope: 'support' },
      number: 1,
    },
  };
  assert.equal(semanticJsonEqual(nestedA, nestedB), true);
});

test('23. semantic JSON equality: arrays with different item order compare different', () => {
  const arrA = [{ number: 1 }, { number: 2 }];
  const arrB = [{ number: 2 }, { number: 1 }];
  assert.equal(semanticJsonEqual(arrA, arrB), false);

  const primitiveA = [1, 2, 3];
  const primitiveB = [2, 1, 3];
  assert.equal(semanticJsonEqual(primitiveA, primitiveB), false);
});

test('24. semantic JSON equality: actual semantically identical DB JSONB vs bundle JSON produces NOOP', async () => {
  // Simulate Postgres JSONB key re-ordering for steps and revision_history
  const sopBundle = canonicalBundle.sops[0];
  const dbStepsReordered = sopBundle.steps.map(step => {
    const keys = Object.keys(step).sort();
    const reordered = {};
    for (const k of keys) reordered[k] = step[k];
    return reordered;
  });
  const dbRevReordered = sopBundle.revisionHistory.map(rev => {
    const keys = Object.keys(rev).sort();
    const reordered = {};
    for (const k of keys) reordered[k] = rev[k];
    return reordered;
  });

  const dbRow = {
    id: 'GS-SOP02',
    playbook_id: 'getting-started',
    bootstrap_key: sopBundle.key,
    title: sopBundle.title,
    owner: sopBundle.owner,
    status: sopBundle.status,
    estimated_time: sopBundle.estimatedTime,
    purpose: sopBundle.purpose,
    when_to_use: sopBundle.whenToUse,
    responsible_team: sopBundle.responsibleTeam,
    requirements: sopBundle.requirements,
    checklist: sopBundle.checklist,
    steps: dbStepsReordered,
    escalation_rules: sopBundle.escalationRules,
    completion_criteria: sopBundle.completionCriteria,
    related_issues: sopBundle.relatedIssues,
    related_guides: sopBundle.relatedGuides,
    internal_notes: sopBundle.internalNotes,
    revision_history: dbRevReordered,
    deleted_at: null,
  };

  assert.equal(areSopsEqual(dbRow, sopBundle, sopBundle.steps), true);

  const adapter = new MockBootstrapAdapter({
    playbooks: [
      {
        id: 'getting-started',
        slug: 'getting-started',
        name: 'Getting Started',
        code: 'GS',
        description: canonicalBundle.playbooks[0].description,
        icon: canonicalBundle.playbooks[0].icon,
        visibility: canonicalBundle.playbooks[0].visibility,
        deleted_at: null,
      },
    ],
    sops: [dbRow],
  });

  const plan = await computeBootstrapPlan({
    bundle: { ...canonicalBundle, sops: [sopBundle] },
    adapter,
    bootstrapDir,
  });

  assert.equal(plan.sops.length, 1);
  assert.equal(plan.sops[0].action, 'NOOP');
  assert.equal(plan.summary.sops.noop, 1);
  assert.equal(plan.summary.sops.update, 0);
});

test('25. semantic JSON equality: a real content change inside a step still produces UPDATE', async () => {
  const sopBundle = canonicalBundle.sops[0];
  const dbStepsModified = JSON.parse(JSON.stringify(sopBundle.steps));
  dbStepsModified[0].description = 'Modified step description that differs from bundle';

  const dbRow = {
    id: 'GS-SOP02',
    playbook_id: 'getting-started',
    bootstrap_key: sopBundle.key,
    title: sopBundle.title,
    owner: sopBundle.owner,
    status: sopBundle.status,
    estimated_time: sopBundle.estimatedTime,
    purpose: sopBundle.purpose,
    when_to_use: sopBundle.whenToUse,
    responsible_team: sopBundle.responsibleTeam,
    requirements: sopBundle.requirements,
    checklist: sopBundle.checklist,
    steps: dbStepsModified,
    escalation_rules: sopBundle.escalationRules,
    completion_criteria: sopBundle.completionCriteria,
    related_issues: sopBundle.relatedIssues,
    related_guides: sopBundle.relatedGuides,
    internal_notes: sopBundle.internalNotes,
    revision_history: sopBundle.revisionHistory,
    deleted_at: null,
  };

  assert.equal(areSopsEqual(dbRow, sopBundle, sopBundle.steps), false);

  const adapter = new MockBootstrapAdapter({
    playbooks: [
      {
        id: 'getting-started',
        slug: 'getting-started',
        name: 'Getting Started',
        code: 'GS',
        description: canonicalBundle.playbooks[0].description,
        icon: canonicalBundle.playbooks[0].icon,
        visibility: canonicalBundle.playbooks[0].visibility,
        deleted_at: null,
      },
    ],
    sops: [dbRow],
  });

  const plan = await computeBootstrapPlan({
    bundle: { ...canonicalBundle, sops: [sopBundle] },
    adapter,
    bootstrapDir,
  });

  assert.equal(plan.sops.length, 1);
  assert.equal(plan.sops[0].action, 'UPDATE');
  assert.equal(plan.summary.sops.update, 1);
  assert.equal(plan.summary.sops.noop, 0);
});

test('26. semantic JSON equality: a real revision_history value change still produces UPDATE', async () => {
  const sopBundle = canonicalBundle.sops[0];
  const dbRevModified = JSON.parse(JSON.stringify(sopBundle.revisionHistory));
  dbRevModified[0].version = '1.0.1';

  const dbRow = {
    id: 'GS-SOP02',
    playbook_id: 'getting-started',
    bootstrap_key: sopBundle.key,
    title: sopBundle.title,
    owner: sopBundle.owner,
    status: sopBundle.status,
    estimated_time: sopBundle.estimatedTime,
    purpose: sopBundle.purpose,
    when_to_use: sopBundle.whenToUse,
    responsible_team: sopBundle.responsibleTeam,
    requirements: sopBundle.requirements,
    checklist: sopBundle.checklist,
    steps: sopBundle.steps,
    escalation_rules: sopBundle.escalationRules,
    completion_criteria: sopBundle.completionCriteria,
    related_issues: sopBundle.relatedIssues,
    related_guides: sopBundle.relatedGuides,
    internal_notes: sopBundle.internalNotes,
    revision_history: dbRevModified,
    deleted_at: null,
  };

  assert.equal(areSopsEqual(dbRow, sopBundle, sopBundle.steps), false);

  const adapter = new MockBootstrapAdapter({
    playbooks: [
      {
        id: 'getting-started',
        slug: 'getting-started',
        name: 'Getting Started',
        code: 'GS',
        description: canonicalBundle.playbooks[0].description,
        icon: canonicalBundle.playbooks[0].icon,
        visibility: canonicalBundle.playbooks[0].visibility,
        deleted_at: null,
      },
    ],
    sops: [dbRow],
  });

  const plan = await computeBootstrapPlan({
    bundle: { ...canonicalBundle, sops: [sopBundle] },
    adapter,
    bootstrapDir,
  });

  assert.equal(plan.sops.length, 1);
  assert.equal(plan.sops[0].action, 'UPDATE');
  assert.equal(plan.summary.sops.update, 1);
  assert.equal(plan.summary.sops.noop, 0);
});

