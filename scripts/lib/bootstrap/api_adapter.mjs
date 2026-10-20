// ==============================================================================
// ICEBERG PLAYBOOK - BOOTSTRAP CONTENT IMPORTER
// scripts/lib/bootstrap/api_adapter.mjs
//
// Bootstrap adapter for the Iceberg Playbook API (server/), i.e. the plain
// PostgreSQL / Docker / Railway deployment. It signs in as an Admin over HTTPS and
// reuses the Supabase-shaped adapter logic: same RPCs (fn_restore_playbook,
// fn_generate_sop_code, fn_link_sop_media), same tables, same RLS rules as any
// Admin user of the app. Nothing is written around the database's own rules.
//
// Needs: BOOTSTRAP_API_URL (e.g. https://your-app.up.railway.app),
//        BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD (an active Admin).
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { SupabaseBootstrapAdapter } from './supabase_adapter.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The browser client is TypeScript; compile it on the fly so the CLI uses the exact same code.
async function loadApiClient() {
  const source = fs.readFileSync(path.join(root, 'src', 'lib', 'apiClient.ts'), 'utf8');
  const { code } = transformSync(source, { loader: 'ts', format: 'esm', target: 'node20' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

export class ApiBootstrapAdapter extends SupabaseBootstrapAdapter {
  static async connect({ apiUrl, email, password, bucket = 'support-assets' }) {
    const { createApiClient } = await loadApiClient();
    const memory = new Map();
    const client = createApiClient({
      baseUrl: apiUrl,
      storage: { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) },
    });
    const { data: signedIn, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`Could not sign in to ${apiUrl} as ${email}: ${error.message}`);
    const profile = await client.from('profiles').select('role').eq('id', signedIn.user.id).maybeSingle();
    if (profile.error || profile.data?.role !== 'Admin') {
      throw new Error('The bootstrap user must be an active Admin.');
    }
    return new ApiBootstrapAdapter({ client, bucket });
  }

  // An object exists when the API can sign a URL for it.
  async checkStorageObjectExists(bucket, storageKey) {
    const { data, error } = await this.client.storage.from(bucket || this.bucket).createSignedUrl(String(storageKey || '').trim(), 60);
    return !error && Boolean(data?.signedUrl);
  }

  // The API has no upsert: insert when the storage key is not recorded yet.
  async ensureMediaFileRecord(record) {
    const existing = await this.client.from('media_files').select('id').eq('storage_key', record.storage_key).maybeSingle();
    if (existing.error) throw new Error(`Failed to look up media_files record for '${record.storage_key}': ${existing.error.message}`);
    if (existing.data) return;
    const { error } = await this.client.from('media_files').insert({
      storage_key: record.storage_key,
      bucket: record.bucket || this.bucket,
      filename: record.filename,
      content_type: record.content_type,
      file_size_bytes: record.file_size_bytes,
      media_type: record.media_type,
      sop_id: record.sop_id || null,
      created_by: record.created_by || 'Bootstrap Importer',
    });
    if (error) throw new Error(`Failed to ensure media_files record for '${record.storage_key}': ${error.message}`);
  }
}
