#!/usr/bin/env node
// ==============================================================================
// ICEBERG PLAYBOOK - MAINTENANCE SCRIPT
// scripts/prune_orphan_media.mjs
//
// Purpose:
// Safe orphan media audit and maintenance cleanup for Supabase Storage
// ('support-assets' bucket).
//
// Default behavior: DRY RUN ONLY (deletes nothing).
// Apply mode: Requires explicit '--apply' flag.
//
// Invariants:
// 1. Content references in guides, guide_versions, sops, and issues are AUTHORITATIVE.
// 2. A media_files row is metadata only and never proves a file is used or unused.
// 3. Historical guide_versions and soft-deleted entities are always protected.
// 4. Any object newer than the grace period (default 24h) is protected.
// 5. Deletion must go through Supabase Storage API first, then delete media_files row.
// 6. Zero service-role secrets embedded in source code.
//
// Environment Variables (required for remote maintenance execution):
// - SUPABASE_URL (or VITE_SUPABASE_URL): Supabase project endpoint
// - SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY): Service-role key for backend maintenance
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// -----------------------------------------------------------------------------
// Helper: Environment Loading (without embedding secrets)
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
// Helper: CLI Argument Parsing
// -----------------------------------------------------------------------------
export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    apply: false,
    graceHours: 24,
    bucket: 'support-assets',
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--grace-hours') {
      const next = argv[++i];
      const parsed = parseInt(next, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        options.graceHours = parsed;
      }
    } else if (arg.startsWith('--grace-hours=')) {
      const parsed = parseInt(arg.split('=')[1], 10);
      if (!isNaN(parsed) && parsed >= 0) {
        options.graceHours = parsed;
      }
    } else if (arg === '--bucket') {
      const next = argv[++i];
      if (next) options.bucket = next;
    } else if (arg.startsWith('--bucket=')) {
      options.bucket = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

// -----------------------------------------------------------------------------
// Helper: Byte Formatting
// -----------------------------------------------------------------------------
export function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// -----------------------------------------------------------------------------
// Core: Extract Authoritative Protected Keys
// -----------------------------------------------------------------------------
export function extractProtectedKeys({ guides = [], guideVersions = [], sops = [], issues = [] }) {
  const protectedSet = new Set();

  function addKey(key) {
    if (!key || typeof key !== 'string') return;
    const trimmed = key.trim();
    if (!trimmed) return;
    // Exclude web URLs and base64/blob schemes
    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('blob:') ||
      trimmed.startsWith('data:')
    ) {
      return;
    }
    protectedSet.add(trimmed);
  }

  // 1. Guides (active AND soft-deleted)
  for (const g of guides) {
    addKey(g.video_storage_key);
    addKey(g.pdf_storage_key);
    if (Array.isArray(g.steps)) {
      for (const s of g.steps) {
        addKey(s?.screenshot);
        addKey(s?.videoLink);
        addKey(s?.pdfReference);
      }
    }
  }

  // 2. Guide Versions (all historical snapshots permanently protected)
  for (const gv of guideVersions) {
    addKey(gv.video_storage_key);
    addKey(gv.pdf_storage_key);
    if (Array.isArray(gv.steps)) {
      for (const s of gv.steps) {
        addKey(s?.screenshot);
        addKey(s?.videoLink);
        addKey(s?.pdfReference);
      }
    }
  }

  // 3. SOPs (active AND soft-deleted)
  for (const sop of sops) {
    if (Array.isArray(sop.steps)) {
      for (const s of sop.steps) {
        addKey(s?.screenshot);
        addKey(s?.videoLink);
        addKey(s?.pdfReference);
      }
    }
  }

  // 4. Issues (active AND soft-deleted)
  for (const iss of issues) {
    if (Array.isArray(iss.attachments)) {
      for (const a of iss.attachments) {
        if (typeof a === 'string') {
          addKey(a);
        } else if (a && typeof a === 'object') {
          addKey(a.storage_key);
          addKey(a.url);
          addKey(a.key);
          addKey(a.path);
        }
      }
    }
  }

  return protectedSet;
}

// -----------------------------------------------------------------------------
// Core: Recursive Storage Object Listing
// -----------------------------------------------------------------------------
export async function listAllStorageObjects(client, bucket, prefix = '') {
  const items = [];
  const { data, error } = await client.storage.from(bucket).list(prefix, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  });

  if (error) throw error;
  if (!data) return items;

  for (const item of data) {
    const itemPath = prefix ? `${prefix}/${item.name}` : item.name;
    // Folders in Supabase Storage have null id or metadata
    if (item.id === null || !item.metadata) {
      const subItems = await listAllStorageObjects(client, bucket, itemPath);
      items.push(...subItems);
    } else {
      items.push({
        name: itemPath,
        id: item.id,
        created_at: item.created_at,
        updated_at: item.updated_at,
        size: item.metadata?.size || 0,
        mimetype: item.metadata?.mimetype || 'application/octet-stream',
      });
    }
  }

  return items;
}

// -----------------------------------------------------------------------------
// Core: Audit Orphan Media
// -----------------------------------------------------------------------------
export async function auditOrphanMedia({ client, bucket = 'support-assets', graceHours = 24 }) {
  // Attempt 1: Call RPC fn_audit_orphan_media if deployed
  try {
    const { data: rpcData, error: rpcErr } = await client.rpc('fn_audit_orphan_media', {
      p_grace_hours: graceHours,
    });
    if (!rpcErr && Array.isArray(rpcData)) {
      return {
        candidates: rpcData.map(row => ({
          storage_key: row.storage_key,
          created_at: row.created_at,
          size_bytes: Number(row.size_bytes),
          content_type: row.content_type,
          age_hours: Number(row.age_hours),
          has_media_files_row: Boolean(row.has_media_files_row),
          media_file_id: row.media_file_id || null,
          sop_id: row.sop_id || null,
          guide_id: row.guide_id || null,
          guide_version_id: row.guide_version_id || null,
          issue_id: row.issue_id || null,
        })),
        method: 'rpc',
      };
    }
  } catch {
    // Fall back to client-side audit if RPC is not available
  }

  // Attempt 2: Fallback to client-side authoritative table queries
  const [guidesRes, gvRes, sopsRes, issuesRes, mfRes, storageObjects] = await Promise.all([
    client.from('guides').select('video_storage_key, pdf_storage_key, steps'),
    client.from('guide_versions').select('video_storage_key, pdf_storage_key, steps'),
    client.from('sops').select('steps'),
    client.from('issues').select('attachments'),
    client.from('media_files').select('id, storage_key, sop_id, guide_id, guide_version_id, issue_id, filename'),
    listAllStorageObjects(client, bucket),
  ]);

  if (guidesRes.error) throw new Error(`Failed to query guides: ${guidesRes.error.message}`);
  if (gvRes.error) throw new Error(`Failed to query guide_versions: ${gvRes.error.message}`);
  if (sopsRes.error) throw new Error(`Failed to query sops: ${sopsRes.error.message}`);
  if (issuesRes.error) throw new Error(`Failed to query issues: ${issuesRes.error.message}`);
  if (mfRes.error) throw new Error(`Failed to query media_files: ${mfRes.error.message}`);

  const protectedKeys = extractProtectedKeys({
    guides: guidesRes.data || [],
    guideVersions: gvRes.data || [],
    sops: sopsRes.data || [],
    issues: issuesRes.data || [],
  });

  const mfMap = new Map();
  for (const row of mfRes.data || []) {
    mfMap.set(row.storage_key, row);
  }

  const now = Date.now();
  const candidates = [];

  for (const obj of storageObjects) {
    if (protectedKeys.has(obj.name)) {
      continue; // Protected by current entity or historical snapshot
    }

    const createdTime = new Date(obj.created_at).getTime();
    const ageHours = (now - createdTime) / (1000 * 3600);

    if (ageHours <= graceHours) {
      continue; // Protected by grace period
    }

    const mfRow = mfMap.get(obj.name);

    candidates.push({
      storage_key: obj.name,
      created_at: obj.created_at,
      size_bytes: obj.size,
      content_type: obj.mimetype,
      age_hours: Math.round(ageHours * 100) / 100,
      has_media_files_row: Boolean(mfRow),
      media_file_id: mfRow ? mfRow.id : null,
      sop_id: mfRow ? mfRow.sop_id : null,
      guide_id: mfRow ? mfRow.guide_id : null,
      guide_version_id: mfRow ? mfRow.guide_version_id : null,
      issue_id: mfRow ? mfRow.issue_id : null,
    });
  }

  return { candidates, method: 'fallback', totalInspected: storageObjects.length };
}

// -----------------------------------------------------------------------------
// Core: Safe Single Object Deletion (Storage first, then metadata)
// -----------------------------------------------------------------------------
export async function deleteOrphanObject({ client, bucket, candidate }) {
  // Step 1: Delete from Supabase Storage API
  const { error: storageErr } = await client.storage.from(bucket).remove([candidate.storage_key]);
  if (storageErr) {
    return {
      storage_key: candidate.storage_key,
      success: false,
      error: `Storage deletion failed: ${storageErr.message}`,
    };
  }

  // Step 2: Delete matching media_files row ONLY after Storage deletion succeeds
  let mfDeleted = false;
  if (candidate.has_media_files_row) {
    const { error: mfErr } = await client
      .from('media_files')
      .delete()
      .eq('storage_key', candidate.storage_key);

    if (mfErr) {
      return {
        storage_key: candidate.storage_key,
        success: true,
        storageDeleted: true,
        mediaFilesDeleted: false,
        warning: `Storage deleted, but media_files metadata cleanup failed: ${mfErr.message}`,
      };
    }
    mfDeleted = true;
  }

  return {
    storage_key: candidate.storage_key,
    success: true,
    storageDeleted: true,
    mediaFilesDeleted: mfDeleted,
  };
}

// -----------------------------------------------------------------------------
// Main CLI Runner
// -----------------------------------------------------------------------------
export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(`
Iceberg Playbook - Safe Orphan Media Maintenance
================================================
Usage:
  npm run storage:audit-orphans                     # Dry run audit (default)
  npm run storage:audit-orphans -- --grace-hours 48 # Dry run with 48h grace
  npm run storage:audit-orphans -- --apply          # Execute confirmed deletion

Environment Variables:
  SUPABASE_URL (or VITE_SUPABASE_URL)
  SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)
`);
    return 0;
  }

  const env = loadEnvFiles();
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    console.error('Error: Missing required environment variable SUPABASE_URL (or VITE_SUPABASE_URL).');
    return 1;
  }

  if (!serviceKey) {
    console.error('Error: Missing required environment variable SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).');
    console.error('Storage maintenance operations require service_role privileges to inspect and clean private bucket assets.');
    return 1;
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Starting media orphan audit...`);
  console.log(`Bucket: ${options.bucket}`);
  console.log(`Grace period: ${options.graceHours} hours`);
  console.log(`Mode: ${options.apply ? 'APPLY (DESTRUCTIVE)' : 'DRY RUN (READ ONLY)'}\n`);

  const { candidates, method } = await auditOrphanMedia({
    client,
    bucket: options.bucket,
    graceHours: options.graceHours,
  });

  console.log(`Audit method: ${method}`);
  console.log(`Orphan candidates found: ${candidates.length}\n`);

  let totalReclaimableBytes = 0;

  if (candidates.length > 0) {
    console.log('ORPHAN CANDIDATES:');
    console.log('--------------------------------------------------------------------------------');
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      totalReclaimableBytes += c.size_bytes;
      const ageDays = (c.age_hours / 24).toFixed(1);
      console.log(`${i + 1}. ${c.storage_key}`);
      console.log(`   Size: ${formatBytes(c.size_bytes)} | Type: ${c.content_type} | Age: ${c.age_hours}h (~${ageDays}d)`);
      console.log(`   media_files row: ${c.has_media_files_row ? 'YES' : 'NO'}`);
      if (c.has_media_files_row) {
        console.log(`   Ownership: sop_id=${c.sop_id || 'null'}, guide_id=${c.guide_id || 'null'}, issue_id=${c.issue_id || 'null'}`);
      }
      console.log('');
    }
    console.log('--------------------------------------------------------------------------------');
  }

  console.log(`Total Reclaimable Space: ${formatBytes(totalReclaimableBytes)} (${totalReclaimableBytes} bytes)`);

  if (!options.apply) {
    console.log('\n[DRY RUN ONLY] Zero files were deleted.');
    console.log('To perform deletion, rerun with explicit --apply flag:');
    console.log('  npm run storage:audit-orphans -- --apply\n');
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Apply Mode: Revalidate and execute deletions
  // ---------------------------------------------------------------------------
  console.log('\n[APPLY MODE] Re-validating candidates before deletion...');
  const revalidated = await auditOrphanMedia({
    client,
    bucket: options.bucket,
    graceHours: options.graceHours,
  });

  console.log(`Confirmed candidates to delete: ${revalidated.candidates.length}`);

  let successCount = 0;
  let failCount = 0;

  for (const candidate of revalidated.candidates) {
    process.stdout.write(`Deleting ${candidate.storage_key}... `);
    const result = await deleteOrphanObject({ client, bucket: options.bucket, candidate });
    if (result.success) {
      successCount++;
      console.log('OK');
      if (result.warning) {
        console.warn(`  Warning: ${result.warning}`);
      }
    } else {
      failCount++;
      console.log('FAILED');
      console.error(`  Error: ${result.error}`);
    }
  }

  console.log('\nCLEANUP SUMMARY:');
  console.log(`- Successfully deleted: ${successCount}`);
  console.log(`- Failed deletions:     ${failCount}`);

  return failCount > 0 ? 1 : 0;
}

// Execute if run directly from CLI
const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (invokedFile && (currentFile === invokedFile || pathToFileURL(invokedFile).href === import.meta.url)) {
  run().then(code => {
    if (code !== 0) process.exit(code);
  }).catch(err => {
    console.error('Fatal error during orphan media maintenance:', err);
    process.exit(1);
  });
}
