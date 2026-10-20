#!/usr/bin/env node
// ==============================================================================
// ICEBERG PLAYBOOK - BOOTSTRAP CONTENT IMPORTER
// scripts/bootstrap_content.mjs
//
// Purpose:
// Canonical onboarding and bootstrap content importer for Iceberg Playbook.
// Imports vendor-neutral bootstrap/default-content.json into the target backend
// through the Bootstrap Adapter Contract.
//
// Default behavior: DRY RUN ONLY (performs zero mutations).
// Apply behavior: Requires explicit '--apply' flag.
//
// Architecture Boundary:
// bootstrap/default-content.json
//         ↓
// scripts/bootstrap_content.mjs (Vendor-Neutral Importer Orchestrator)
//         ↓
// Bootstrap adapter contract
//         ↓
// SupabaseBootstrapAdapter (scripts/lib/bootstrap/supabase_adapter.mjs)
//
// Invariants & Safety:
// 1. Zero Supabase client imports in this file or the bundle package.
// 2. Playbook ownership and restoration is safe and non-destructive.
// 3. SOP ownership is governed STRICTLY by (playbook_id + bootstrap_key).
// 4. Untagged same-title SOPs produce CONFLICT; never adopted or overwritten.
// 5. Local media assets use SHA-256 content-addressed keys:
//    sops/bootstrap/<playbook-key>/<sop-key>/<sha256>-<sanitized-filename>
// 6. External HTTPS media links are preserved unchanged.
// 7. Unchanged assets are never re-uploaded; changed assets create new keys.
// 8. Zero hard-delete or destructive operations across any table or bucket.
// 9. Zero hardcoded secrets in source code.
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validateBootstrapContent } from '../bootstrap/validate.mjs';
import { SupabaseBootstrapAdapter } from './lib/bootstrap/supabase_adapter.mjs';

// -----------------------------------------------------------------------------
// Environment Loading (without printing or embedding secrets)
// -----------------------------------------------------------------------------
export function loadEnvFiles() {
  const env = { ...process.env };
  const rootDir = process.cwd();
  const envFiles = ['.env.local', '.env'];

  for (const file of envFiles) {
    const fullPath = path.join(rootDir, file);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            if (!env[key] && val) {
              env[key] = val;
            }
          }
        }
      } catch {
        // ignore unreadable env files
      }
    }
  }
  return env;
}

// -----------------------------------------------------------------------------
// CLI Argument Parsing
// -----------------------------------------------------------------------------
export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    apply: false,
    bundlePath: path.resolve(process.cwd(), 'bootstrap', 'default-content.json'),
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--bundle') {
      const next = argv[++i];
      if (next) options.bundlePath = path.resolve(process.cwd(), next);
    } else if (arg.startsWith('--bundle=')) {
      options.bundlePath = path.resolve(process.cwd(), arg.split('=')[1]);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

// -----------------------------------------------------------------------------
// Media & Asset Helpers
// -----------------------------------------------------------------------------
const MIME_TYPE_MAP = {
  '.png': { contentType: 'image/png', mediaType: 'image' },
  '.jpg': { contentType: 'image/jpeg', mediaType: 'image' },
  '.jpeg': { contentType: 'image/jpeg', mediaType: 'image' },
  '.webp': { contentType: 'image/webp', mediaType: 'image' },
  '.mp4': { contentType: 'video/mp4', mediaType: 'video' },
  '.webm': { contentType: 'video/webm', mediaType: 'video' },
  '.pdf': { contentType: 'application/pdf', mediaType: 'pdf' },
};

const MAX_ASSET_SIZE_BYTES = 52428800; // 50 MB

export function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Resolve, validate, and compute deterministic storage key for a local asset.
 */
export function resolveLocalAsset({ relativePath, bootstrapDir, playbookKey, sopKey }) {
  if (!relativePath.startsWith('assets/')) {
    throw new Error(`Invalid local asset reference: '${relativePath}'. Must start with 'assets/'.`);
  }

  const resolvedPath = path.resolve(bootstrapDir, relativePath);

  // Security bounds check: ensure asset is inside bootstrapDir
  const normalizedBase = path.normalize(bootstrapDir) + path.sep;
  const normalizedResolved = path.normalize(resolvedPath);
  if (!normalizedResolved.startsWith(normalizedBase)) {
    throw new Error(`Insecure asset path traversal detected: '${relativePath}'`);
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Required local asset not found: '${relativePath}' (resolved: '${resolvedPath}')`);
  }

  const stats = fs.statSync(resolvedPath);
  if (stats.size > MAX_ASSET_SIZE_BYTES) {
    throw new Error(`Asset exceeds maximum allowable size of 50 MB: '${relativePath}' (${stats.size} bytes)`);
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const mimeInfo = MIME_TYPE_MAP[ext];
  if (!mimeInfo) {
    throw new Error(`Unsupported media asset type '${ext}' for file '${relativePath}'`);
  }

  const buffer = fs.readFileSync(resolvedPath);
  const hash = computeSha256(buffer);
  const cleanName = sanitizeFilename(path.basename(resolvedPath));
  const storageKey = `sops/bootstrap/${playbookKey}/${sopKey}/${hash}-${cleanName}`;

  return {
    relativePath,
    resolvedPath,
    buffer,
    hash,
    filename: cleanName,
    storageKey,
    contentType: mimeInfo.contentType,
    mediaType: mimeInfo.mediaType,
    fileSizeBytes: stats.size,
    sopKey,
    playbookKey,
  };
}

// -----------------------------------------------------------------------------
// Deep Content Comparison Helpers
// -----------------------------------------------------------------------------
function normalizeArray(arr) {
  return Array.isArray(arr) ? arr : [];
}

/**
 * Semantic deep equality for JSON data structures.
 * - Object key ordering does NOT affect equality.
 * - Array element ordering IS strictly preserved.
 * - Content values and types are deeply compared.
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
export function semanticJsonEqual(a, b) {
  return isDeepStrictEqual(a, b);
}

export function arePlaybookMetadatasEqual(dbRow, bundlePb) {
  if (dbRow.name !== bundlePb.name) return false;
  if (dbRow.code !== bundlePb.code) return false;
  if ((dbRow.description || '') !== (bundlePb.description || '')) return false;
  if ((dbRow.icon || '') !== (bundlePb.icon || '')) return false;
  if ((dbRow.visibility || 'Internal') !== (bundlePb.visibility || 'Internal')) return false;
  return true;
}

export function areSopsEqual(dbRow, bundleSop, resolvedSteps) {
  if (dbRow.title !== bundleSop.title) return false;
  if ((dbRow.owner || '') !== (bundleSop.owner || '')) return false;
  if (dbRow.status !== bundleSop.status) return false;
  if ((dbRow.estimated_time || '') !== (bundleSop.estimatedTime || '')) return false;
  if ((dbRow.purpose || '') !== (bundleSop.purpose || '')) return false;
  if ((dbRow.when_to_use || '') !== (bundleSop.whenToUse || '')) return false;
  if ((dbRow.responsible_team || '') !== (bundleSop.responsibleTeam || '')) return false;
  if ((dbRow.escalation_rules || '') !== (bundleSop.escalationRules || '')) return false;
  if ((dbRow.completion_criteria || '') !== (bundleSop.completionCriteria || '')) return false;
  if ((dbRow.internal_notes || '') !== (bundleSop.internalNotes || '')) return false;

  const dbReqs = normalizeArray(dbRow.requirements);
  const bundleReqs = normalizeArray(bundleSop.requirements);
  if (JSON.stringify(dbReqs) !== JSON.stringify(bundleReqs)) return false;

  const dbChecklist = normalizeArray(dbRow.checklist);
  const bundleChecklist = normalizeArray(bundleSop.checklist);
  if (JSON.stringify(dbChecklist) !== JSON.stringify(bundleChecklist)) return false;

  const dbIssues = normalizeArray(dbRow.related_issues);
  const bundleIssues = normalizeArray(bundleSop.relatedIssues);
  if (JSON.stringify(dbIssues) !== JSON.stringify(bundleIssues)) return false;

  const dbGuides = normalizeArray(dbRow.related_guides);
  const bundleGuides = normalizeArray(bundleSop.relatedGuides);
  if (JSON.stringify(dbGuides) !== JSON.stringify(bundleGuides)) return false;

  // Steps comparison (using resolved steps containing deterministic storage keys)
  const dbSteps = normalizeArray(dbRow.steps);
  const bundleSteps = normalizeArray(resolvedSteps);
  if (!semanticJsonEqual(dbSteps, bundleSteps)) return false;

  // Revision history comparison
  const dbRevisions = normalizeArray(dbRow.revision_history);
  const bundleRevisions = normalizeArray(bundleSop.revisionHistory);
  if (!semanticJsonEqual(dbRevisions, bundleRevisions)) return false;

  return true;
}

// -----------------------------------------------------------------------------
// Core Plan Computation (Zero Mutations)
// -----------------------------------------------------------------------------
export async function computeBootstrapPlan({ bundle, adapter, bootstrapDir }) {
  const plan = {
    playbooks: [],
    sops: [],
    assets: [],
    summary: {
      playbooks: { create: 0, update: 0, restore: 0, noop: 0 },
      sops: { create: 0, update: 0, restore: 0, noop: 0, conflict: 0 },
      assets: { upload: 0, noop: 0 },
    },
    hasConflicts: false,
  };

  // 1. Process Playbooks
  for (const pb of bundle.playbooks || []) {
    const lookup = await adapter.getPlaybook(pb.key);

    if (!lookup.found) {
      plan.playbooks.push({
        action: 'CREATE',
        key: pb.key,
        name: pb.name,
        code: pb.code,
        bundleData: pb,
        reason: `New canonical Playbook '${pb.name}' (${pb.code}) will be created.`,
      });
      plan.summary.playbooks.create++;
    } else if (lookup.isDeleted) {
      plan.playbooks.push({
        action: 'RESTORE',
        id: lookup.playbook.id,
        key: pb.key,
        name: pb.name,
        code: pb.code,
        existing: lookup.playbook,
        bundleData: pb,
        metadataDiffers: !arePlaybookMetadatasEqual(lookup.playbook, pb),
        reason: `Soft-deleted Playbook '${lookup.playbook.name}' (${lookup.playbook.id}) will be restored and canonical metadata synchronized.`,
      });
      plan.summary.playbooks.restore++;
    } else {
      const identical = arePlaybookMetadatasEqual(lookup.playbook, pb);
      if (identical) {
        plan.playbooks.push({
          action: 'NOOP',
          id: lookup.playbook.id,
          key: pb.key,
          name: pb.name,
          code: pb.code,
          reason: `Playbook '${lookup.playbook.name}' is active and identical. No changes needed.`,
        });
        plan.summary.playbooks.noop++;
      } else {
        plan.playbooks.push({
          action: 'UPDATE',
          id: lookup.playbook.id,
          key: pb.key,
          name: pb.name,
          code: pb.code,
          existing: lookup.playbook,
          bundleData: pb,
          reason: `Playbook '${lookup.playbook.name}' is active; canonical metadata differs and will be synchronized.`,
        });
        plan.summary.playbooks.update++;
      }
    }
  }

  // 2. Process SOPs & Media
  for (const sop of bundle.sops || []) {
    const targetPlaybookKey = sop.playbookKey;

    // Resolve media assets in steps
    const resolvedSteps = [];
    const sopAssets = [];

    for (const step of sop.steps || []) {
      const stepCopy = { ...step };

      for (const mediaField of ['screenshot', 'videoLink', 'pdfReference']) {
        const ref = stepCopy[mediaField];
        if (ref && typeof ref === 'string') {
          const cleanRef = ref.trim();
          if (cleanRef.startsWith('https://')) {
            // HTTPS references remain unchanged
            stepCopy[mediaField] = cleanRef;
          } else if (cleanRef.startsWith('assets/')) {
            // Local asset: resolve and determine deterministic storage key
            const assetInfo = resolveLocalAsset({
              relativePath: cleanRef,
              bootstrapDir,
              playbookKey: targetPlaybookKey,
              sopKey: sop.key,
            });
            stepCopy[mediaField] = assetInfo.storageKey;
            sopAssets.push(assetInfo);
          }
        }
      }

      resolvedSteps.push(stepCopy);
    }

    // Check each asset against storage existence
    for (const asset of sopAssets) {
      const exists = await adapter.checkStorageObjectExists(adapter.bucket, asset.storageKey);
      if (exists) {
        plan.assets.push({
          action: 'NOOP',
          storageKey: asset.storageKey,
          sopKey: sop.key,
          reason: `Asset already exists in Storage at deterministic key. Upload skipped.`,
        });
        plan.summary.assets.noop++;
      } else {
        plan.assets.push({
          action: 'UPLOAD',
          asset,
          storageKey: asset.storageKey,
          sopKey: sop.key,
          reason: `New or modified asset will be uploaded to Storage.`,
        });
        plan.summary.assets.upload++;
      }
    }

    // Authoritative lookup: playbook_id + bootstrap_key
    const sopLookup = await adapter.findSopByBootstrapKey(targetPlaybookKey, sop.key);

    if (sopLookup.found) {
      if (sopLookup.isDeleted) {
        plan.sops.push({
          action: 'RESTORE',
          id: sopLookup.sop.id,
          key: sop.key,
          playbookKey: targetPlaybookKey,
          title: sop.title,
          existing: sopLookup.sop,
          bundleData: sop,
          resolvedSteps,
          assets: sopAssets,
          reason: `Soft-deleted SOP '${sopLookup.sop.title}' (${sopLookup.sop.id}) matching bootstrap_key '${sop.key}' will be safely restored and synchronized.`,
        });
        plan.summary.sops.restore++;
      } else {
        const identical = areSopsEqual(sopLookup.sop, sop, resolvedSteps);
        if (identical) {
          plan.sops.push({
            action: 'NOOP',
            id: sopLookup.sop.id,
            key: sop.key,
            playbookKey: targetPlaybookKey,
            title: sop.title,
            reason: `SOP '${sopLookup.sop.title}' (${sopLookup.sop.id}) is active and identical. No changes needed.`,
          });
          plan.summary.sops.noop++;
        } else {
          plan.sops.push({
            action: 'UPDATE',
            id: sopLookup.sop.id,
            key: sop.key,
            playbookKey: targetPlaybookKey,
            title: sop.title,
            existing: sopLookup.sop,
            bundleData: sop,
            resolvedSteps,
            assets: sopAssets,
            reason: `SOP '${sopLookup.sop.title}' (${sopLookup.sop.id}) has bundle content updates. Canonical fields will be updated.`,
          });
          plan.summary.sops.update++;
        }
      }
    } else {
      // No match by bootstrap_key: check for UNTAGGED SOP with same canonical title
      const untaggedLookup = await adapter.findUntaggedSopByTitle(targetPlaybookKey, sop.title);

      if (untaggedLookup.found) {
        plan.sops.push({
          action: 'CONFLICT',
          key: sop.key,
          playbookKey: targetPlaybookKey,
          title: sop.title,
          conflictingSopId: untaggedLookup.sop.id,
          isDeleted: untaggedLookup.isDeleted,
          reason: `CONFLICT: An untagged SOP with identical title '${sop.title}' already exists (ID: ${untaggedLookup.sop.id}, deleted: ${untaggedLookup.isDeleted}). Automatic adoption is strictly forbidden.`,
        });
        plan.summary.sops.conflict++;
        plan.hasConflicts = true;
      } else {
        plan.sops.push({
          action: 'CREATE',
          key: sop.key,
          playbookKey: targetPlaybookKey,
          title: sop.title,
          bundleData: sop,
          resolvedSteps,
          assets: sopAssets,
          reason: `New bootstrap SOP '${sop.title}' will be created with bootstrap_key '${sop.key}'.`,
        });
        plan.summary.sops.create++;
      }
    }
  }

  return plan;
}

// -----------------------------------------------------------------------------
// Plan Display Formatter
// -----------------------------------------------------------------------------
export function displayBootstrapPlan(plan, applyMode) {
  console.log('='.repeat(80));
  console.log('ICEBERG PLAYBOOK - BOOTSTRAP CONTENT IMPORTER PLAN');
  console.log('='.repeat(80));
  console.log(`Execution Mode: ${applyMode ? 'APPLY (LIVE DATABASE MUTATIONS)' : 'DRY RUN ONLY (READ ONLY - ZERO MUTATIONS)'}\n`);

  console.log('1. PLAYBOOKS:');
  console.log('-'.repeat(80));
  for (const pb of plan.playbooks) {
    const badge = `[${pb.action}]`.padEnd(10);
    console.log(`${badge} ${pb.key.padEnd(20)} | ${pb.name} (${pb.code})`);
    console.log(`           ${pb.reason}`);
  }
  console.log('');

  console.log('2. STANDARD OPERATING PROCEDURES (SOPs):');
  console.log('-'.repeat(80));
  for (const sop of plan.sops) {
    const badge = `[${sop.action}]`.padEnd(10);
    const identifier = (sop.id ? `${sop.id} : ` : '') + sop.key;
    console.log(`${badge} ${identifier.padEnd(30)} | "${sop.title}"`);
    console.log(`           ${sop.reason}`);
  }
  console.log('');

  console.log('3. MEDIA ASSETS:');
  console.log('-'.repeat(80));
  if (plan.assets.length === 0) {
    console.log('  No local media assets referenced in this bundle run.');
  } else {
    for (const asset of plan.assets) {
      const badge = `[${asset.action}]`.padEnd(10);
      console.log(`${badge} ${asset.storageKey}`);
      console.log(`           ${asset.reason}`);
    }
  }
  console.log('');

  console.log('PLAN SUMMARY:');
  console.log('-'.repeat(80));
  const pbSum = plan.summary.playbooks;
  console.log(`Playbooks: ${pbSum.create} create, ${pbSum.update} update, ${pbSum.restore} restore, ${pbSum.noop} noop`);
  const sopSum = plan.summary.sops;
  console.log(`SOPs:      ${sopSum.create} create, ${sopSum.update} update, ${sopSum.restore} restore, ${sopSum.noop} noop, ${sopSum.conflict} CONFLICT`);
  const assetSum = plan.summary.assets;
  console.log(`Assets:    ${assetSum.upload} upload, ${assetSum.noop} noop`);
  console.log('='.repeat(80));

  if (!applyMode) {
    console.log('\n[DRY RUN ONLY] Zero database mutations performed.');
    if (plan.hasConflicts) {
      console.log('WARNING: Untagged same-title conflicts detected. Resolve or rename conflicts before applying.');
    }
    console.log('To execute this plan against the backend, run with explicit --apply:');
    console.log('  npm run bootstrap:content -- --apply\n');
  }
}

// -----------------------------------------------------------------------------
// Plan Execution Engine (Apply Mode Only)
// -----------------------------------------------------------------------------
export async function executeBootstrapPlan({ plan, adapter }) {
  if (plan.hasConflicts) {
    throw new Error('Bootstrap execution aborted: Untagged same-title SOP conflicts detected. Automatic adoption is forbidden.');
  }

  const executionLog = {
    playbooks: { created: 0, updated: 0, restored: 0 },
    sops: { created: 0, updated: 0, restored: 0 },
    assets: { uploaded: 0 },
  };

  // 1. Execute Playbook Changes
  for (const pb of plan.playbooks) {
    if (pb.action === 'CREATE') {
      await adapter.createPlaybook(pb.bundleData);
      executionLog.playbooks.created++;
    } else if (pb.action === 'RESTORE') {
      await adapter.restorePlaybook(pb.id);
      if (pb.metadataDiffers) {
        await adapter.updatePlaybook(pb.id, {
          name: pb.bundleData.name,
          code: pb.bundleData.code,
          description: pb.bundleData.description,
          icon: pb.bundleData.icon,
          visibility: pb.bundleData.visibility,
        });
      }
      executionLog.playbooks.restored++;
    } else if (pb.action === 'UPDATE') {
      await adapter.updatePlaybook(pb.id, {
        name: pb.bundleData.name,
        code: pb.bundleData.code,
        description: pb.bundleData.description,
        icon: pb.bundleData.icon,
        visibility: pb.bundleData.visibility,
      });
      executionLog.playbooks.updated++;
    }
  }

  // 2. Execute Asset Uploads
  for (const assetAction of plan.assets) {
    if (assetAction.action === 'UPLOAD') {
      const asset = assetAction.asset;
      await adapter.uploadStorageObject(adapter.bucket, asset.storageKey, asset.buffer, asset.contentType);
      await adapter.ensureMediaFileRecord({
        storage_key: asset.storageKey,
        bucket: adapter.bucket,
        filename: asset.filename,
        content_type: asset.contentType,
        file_size_bytes: asset.fileSizeBytes,
        media_type: asset.mediaType,
        sop_id: null,
        created_by: 'Bootstrap Importer',
      });
      executionLog.assets.uploaded++;
    }
  }

  // 3. Execute SOP Changes
  for (const sopPlan of plan.sops) {
    if (sopPlan.action === 'NOOP') {
      continue;
    }

    const bundleData = sopPlan.bundleData;
    const resolvedSteps = sopPlan.resolvedSteps || [];
    const storageKeys = (sopPlan.assets || []).map(a => a.storageKey);

    const sopPayload = {
      title: bundleData.title,
      owner: bundleData.owner,
      status: bundleData.status,
      estimated_time: bundleData.estimatedTime,
      purpose: bundleData.purpose,
      when_to_use: bundleData.whenToUse,
      requirements: bundleData.requirements,
      responsible_team: bundleData.responsibleTeam,
      checklist: bundleData.checklist,
      steps: resolvedSteps,
      escalation_rules: bundleData.escalationRules,
      completion_criteria: bundleData.completionCriteria,
      related_issues: bundleData.relatedIssues,
      related_guides: bundleData.relatedGuides,
      internal_notes: bundleData.internalNotes,
      revision_history: bundleData.revisionHistory,
    };

    if (sopPlan.action === 'CREATE') {
      const sopCode = await adapter.generateSopCode(sopPlan.playbookKey);
      await adapter.createSop({
        id: sopCode,
        playbook_id: sopPlan.playbookKey,
        bootstrap_key: sopPlan.key,
        ...sopPayload,
      });

      if (storageKeys.length > 0) {
        await adapter.linkSopMedia(sopCode, storageKeys);
      }
      executionLog.sops.created++;
    } else if (sopPlan.action === 'RESTORE') {
      await adapter.restoreSop(sopPlan.id, sopPayload);

      if (storageKeys.length > 0) {
        await adapter.linkSopMedia(sopPlan.id, storageKeys);
      }
      executionLog.sops.restored++;
    } else if (sopPlan.action === 'UPDATE') {
      await adapter.updateSop(sopPlan.id, sopPayload);

      if (storageKeys.length > 0) {
        await adapter.linkSopMedia(sopPlan.id, storageKeys);
      }
      executionLog.sops.updated++;
    }
  }

  return executionLog;
}

// -----------------------------------------------------------------------------
// Orchestrator Runner
// -----------------------------------------------------------------------------
export async function runBootstrapImporter({ argv = process.argv.slice(2), adapter = null } = {}) {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(`
Iceberg Playbook - Bootstrap Content Importer
=============================================
Usage:
  npm run bootstrap:content                    # Dry run inspection (default)
  npm run bootstrap:content -- --apply         # Execute planned import against DB
  npm run bootstrap:content -- --bundle=<path> # Specify custom bundle JSON

Environment Variables:
  Plain PostgreSQL / Railway deployment (preferred when set):
    BOOTSTRAP_API_URL, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD
  Supabase reference backend:
    SUPABASE_URL (or VITE_SUPABASE_URL)
    SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)
`);
    return 0;
  }

  // 1. Load and Validate Content Bundle
  if (!fs.existsSync(options.bundlePath)) {
    console.error(`Error: Content bundle not found at: ${options.bundlePath}`);
    return 1;
  }

  let bundle;
  try {
    const rawContent = fs.readFileSync(options.bundlePath, 'utf-8');
    bundle = JSON.parse(rawContent);
  } catch (err) {
    console.error(`Error: Failed to parse bundle JSON: ${err.message}`);
    return 1;
  }

  const validation = validateBootstrapContent(bundle);
  if (!validation.valid) {
    console.error('Error: Content bundle failed schema validation:');
    for (const err of validation.errors) {
      console.error(`  - ${err}`);
    }
    return 1;
  }

  // 2. Initialize Adapter
  const bootstrapDir = path.dirname(options.bundlePath);
  let activeAdapter = adapter;

  if (!activeAdapter) {
    const env = loadEnvFiles();

    // Plain PostgreSQL deployment (Docker / Railway): talk to the Iceberg Playbook API as an Admin.
    if (env.BOOTSTRAP_API_URL) {
      const email = env.BOOTSTRAP_ADMIN_EMAIL;
      const password = env.BOOTSTRAP_ADMIN_PASSWORD;
      if (!email || !password) {
        console.error('Error: BOOTSTRAP_API_URL requires BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD.');
        return 1;
      }
      const { ApiBootstrapAdapter } = await import('./lib/bootstrap/api_adapter.mjs');
      try {
        activeAdapter = await ApiBootstrapAdapter.connect({ apiUrl: env.BOOTSTRAP_API_URL.replace(/\/+$/, ''), email, password });
      } catch (err) {
        console.error(`Error: ${err.message}`);
        return 1;
      }
    }
  }

  if (!activeAdapter) {
    const env = loadEnvFiles();
    const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl) {
      console.error('Error: Missing required environment variable SUPABASE_URL (or VITE_SUPABASE_URL).');
      return 1;
    }

    if (!serviceKey) {
      console.error('Error: Missing required environment variable SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).');
      return 1;
    }

    activeAdapter = new SupabaseBootstrapAdapter({
      supabaseUrl,
      serviceRoleKey: serviceKey,
    });
  }

  // 3. Compute Plan (Read-Only)
  const plan = await computeBootstrapPlan({
    bundle,
    adapter: activeAdapter,
    bootstrapDir,
  });

  // 4. Display Plan
  displayBootstrapPlan(plan, options.apply);

  // 5. Exit or Execute
  if (!options.apply) {
    // Dry-run mode exits cleanly with 0 unless bundle conflicts require failure signaling
    return plan.hasConflicts ? 1 : 0;
  }

  if (plan.hasConflicts) {
    console.error('Error: Cannot proceed in apply mode while conflicts exist.');
    return 1;
  }

  console.log('Executing plan changes...');
  const executionLog = await executeBootstrapPlan({
    plan,
    adapter: activeAdapter,
  });

  console.log('\nAPPLY EXECUTION COMPLETE:');
  console.log(`- Playbooks: ${executionLog.playbooks.created} created, ${executionLog.playbooks.updated} updated, ${executionLog.playbooks.restored} restored`);
  console.log(`- SOPs:      ${executionLog.sops.created} created, ${executionLog.sops.updated} updated, ${executionLog.sops.restored} restored`);
  console.log(`- Assets:    ${executionLog.assets.uploaded} uploaded`);

  return 0;
}

// -----------------------------------------------------------------------------
// Direct CLI Execution
// -----------------------------------------------------------------------------
const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (invokedFile && (currentFile === invokedFile || pathToFileURL(invokedFile).href === import.meta.url)) {
  runBootstrapImporter().then(code => {
    if (code !== 0) process.exit(code);
  }).catch(err => {
    console.error('Fatal error during bootstrap import:', err);
    process.exit(1);
  });
}
