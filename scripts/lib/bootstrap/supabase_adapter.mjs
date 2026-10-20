// ==============================================================================
// ICEBERG PLAYBOOK - BOOTSTRAP CONTENT IMPORTER
// scripts/lib/bootstrap/supabase_adapter.mjs
//
// Purpose:
// Concrete Supabase adapter implementing the Bootstrap Adapter Contract.
// Isolates all Supabase-specific dependencies, RPCs, and query syntax so that
// the orchestrator and bundle remain vendor-neutral.
//
// Invariants:
// 1. All @supabase/supabase-js usage is encapsulated within this file.
// 2. Playbook restoration uses project canonical RPC `fn_restore_playbook`.
// 3. SOP code generation uses canonical RPC `fn_generate_sop_code`.
// 4. Media attribution uses canonical RPC `fn_link_sop_media`.
// 5. Zero hard-delete or destructive operations.
// 6. Zero hardcoded secrets in source code.
// ==============================================================================

import { createClient } from '@supabase/supabase-js';

export class SupabaseBootstrapAdapter {
  /**
   * @param {Object} options
   * @param {import('@supabase/supabase-js').SupabaseClient} [options.client] Pre-configured Supabase client
   * @param {string} [options.supabaseUrl] Supabase endpoint URL
   * @param {string} [options.serviceRoleKey] Supabase service-role key
   * @param {string} [options.bucket='support-assets'] Default storage bucket
   */
  constructor({ client, supabaseUrl, serviceRoleKey, bucket = 'support-assets' } = {}) {
    if (client) {
      this.client = client;
    } else {
      if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('SupabaseBootstrapAdapter requires supabaseUrl and serviceRoleKey (or a pre-configured client).');
      }
      this.client = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    this.bucket = bucket;
  }

  // ---------------------------------------------------------------------------
  // Playbook Operations
  // ---------------------------------------------------------------------------

  /**
   * Look up a Playbook by canonical key/slug/id/code.
   * Checks both active and soft-deleted rows.
   * @param {string} key
   * @returns {Promise<{ found: boolean, playbook: Object|null, isDeleted: boolean }>}
   */
  async getPlaybook(key) {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) {
      return { found: false, playbook: null, isDeleted: false };
    }

    const { data, error } = await this.client
      .from('playbooks')
      .select('id, slug, name, code, description, icon, owner, visibility, created_at, updated_at, deleted_at, deleted_by')
      .or(`id.eq.${cleanKey},slug.eq.${cleanKey}`)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query playbook '${cleanKey}': ${error.message}`);
    }

    if (!data) {
      return { found: false, playbook: null, isDeleted: false };
    }

    return {
      found: true,
      playbook: data,
      isDeleted: data.deleted_at !== null,
    };
  }

  /**
   * Create a new Playbook row.
   * @param {Object} playbookData
   * @returns {Promise<Object>}
   */
  async createPlaybook(playbookData) {
    const id = (playbookData.id || playbookData.key || '').trim();
    const slug = (playbookData.slug || playbookData.key || '').trim();

    const insertPayload = {
      id,
      slug,
      name: playbookData.name?.trim(),
      code: playbookData.code?.trim().toUpperCase(),
      description: playbookData.description?.trim(),
      icon: playbookData.icon?.trim() || 'Compass',
      owner: playbookData.owner?.trim() || 'Support Operations',
      visibility: playbookData.visibility || 'Internal',
    };

    const { data, error } = await this.client
      .from('playbooks')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create playbook '${id}': ${error.message}`);
    }

    return data;
  }

  /**
   * Safely restore a soft-deleted Playbook using canonical RPC fn_restore_playbook.
   * @param {string} playbookId
   * @returns {Promise<void>}
   */
  async restorePlaybook(playbookId) {
    const cleanId = String(playbookId || '').trim();
    const { error } = await this.client.rpc('fn_restore_playbook', {
      p_playbook_id: cleanId,
    });

    if (error) {
      if (!error.message?.includes('already active')) {
        throw new Error(`Failed to restore playbook '${cleanId}': ${error.message}`);
      }
    }
  }

  /**
   * Synchronize canonical metadata for an existing Playbook.
   * Does NOT touch children or unrelated fields.
   * @param {string} playbookId
   * @param {Object} metadata
   * @returns {Promise<Object>}
   */
  async updatePlaybook(playbookId, metadata) {
    const cleanId = String(playbookId || '').trim();
    const updatePayload = {
      updated_at: new Date().toISOString(),
    };

    if (metadata.name !== undefined) updatePayload.name = metadata.name.trim();
    if (metadata.code !== undefined) updatePayload.code = metadata.code.trim().toUpperCase();
    if (metadata.description !== undefined) updatePayload.description = metadata.description.trim();
    if (metadata.icon !== undefined) updatePayload.icon = metadata.icon.trim();
    if (metadata.visibility !== undefined) updatePayload.visibility = metadata.visibility;

    const { data, error } = await this.client
      .from('playbooks')
      .update(updatePayload)
      .eq('id', cleanId)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to update playbook '${cleanId}': ${error.message}`);
    }

    return data;
  }

  // ---------------------------------------------------------------------------
  // SOP Operations
  // ---------------------------------------------------------------------------

  /**
   * Look up an SOP by playbook_id + bootstrap_key.
   * Authoritative lookup; inspects both active and soft-deleted rows.
   * @param {string} playbookId
   * @param {string} bootstrapKey
   * @returns {Promise<{ found: boolean, sop: Object|null, isDeleted: boolean }>}
   */
  async findSopByBootstrapKey(playbookId, bootstrapKey) {
    const cleanPlaybookId = String(playbookId || '').trim();
    const cleanKey = String(bootstrapKey || '').trim();

    const { data, error } = await this.client
      .from('sops')
      .select('*')
      .eq('playbook_id', cleanPlaybookId)
      .eq('bootstrap_key', cleanKey)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to look up SOP by bootstrap_key '${cleanKey}' in playbook '${cleanPlaybookId}': ${error.message}`);
    }

    if (!data) {
      return { found: false, sop: null, isDeleted: false };
    }

    return {
      found: true,
      sop: data,
      isDeleted: data.deleted_at !== null,
    };
  }

  /**
   * Check if an UNTAGGED SOP (bootstrap_key IS NULL) exists with the same canonical title.
   * @param {string} playbookId
   * @param {string} title
   * @returns {Promise<{ found: boolean, sop: Object|null, isDeleted: boolean }>}
   */
  async findUntaggedSopByTitle(playbookId, title) {
    const cleanPlaybookId = String(playbookId || '').trim();
    const cleanTitle = String(title || '').trim();

    const { data, error } = await this.client
      .from('sops')
      .select('id, playbook_id, title, bootstrap_key, deleted_at')
      .eq('playbook_id', cleanPlaybookId)
      .eq('title', cleanTitle)
      .is('bootstrap_key', null)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to check untagged SOP with title '${cleanTitle}' in playbook '${cleanPlaybookId}': ${error.message}`);
    }

    if (!data) {
      return { found: false, sop: null, isDeleted: false };
    }

    return {
      found: true,
      sop: data,
      isDeleted: data.deleted_at !== null,
    };
  }

  /**
   * Generate canonical unique SOP code via RPC fn_generate_sop_code.
   * @param {string} playbookId
   * @returns {Promise<string>}
   */
  async generateSopCode(playbookId) {
    const cleanId = String(playbookId || '').trim();
    const { data, error } = await this.client.rpc('fn_generate_sop_code', {
      p_playbook_id: cleanId,
    });

    if (error || !data) {
      throw new Error(`Failed to generate SOP code for playbook '${cleanId}': ${error?.message || 'No code returned'}`);
    }

    return String(data);
  }

  /**
   * Create an SOP with explicit bootstrap_key ownership.
   * @param {Object} sopData
   * @returns {Promise<Object>}
   */
  async createSop(sopData) {
    const insertPayload = {
      id: sopData.id,
      playbook_id: sopData.playbook_id,
      bootstrap_key: sopData.bootstrap_key,
      title: sopData.title?.trim(),
      owner: sopData.owner?.trim() || 'Support Operations',
      status: sopData.status || 'Verified',
      estimated_time: sopData.estimated_time || '10 min',
      purpose: sopData.purpose?.trim() || '',
      when_to_use: sopData.when_to_use?.trim() || '',
      requirements: Array.isArray(sopData.requirements) ? sopData.requirements : [],
      responsible_team: sopData.responsible_team?.trim() || 'Support Operations & Enablement',
      checklist: Array.isArray(sopData.checklist) ? sopData.checklist : [],
      steps: Array.isArray(sopData.steps) ? sopData.steps : [],
      escalation_rules: sopData.escalation_rules?.trim() || '',
      completion_criteria: sopData.completion_criteria?.trim() || '',
      related_issues: Array.isArray(sopData.related_issues) ? sopData.related_issues : [],
      related_guides: Array.isArray(sopData.related_guides) ? sopData.related_guides : [],
      internal_notes: sopData.internal_notes?.trim() || '',
      revision_history: Array.isArray(sopData.revision_history) ? sopData.revision_history : [],
    };

    const { data, error } = await this.client
      .from('sops')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create SOP '${sopData.title}' (${sopData.bootstrap_key}): ${error.message}`);
    }

    return data;
  }

  /**
   * Update canonical fields of an existing active SOP by ID.
   * Preserves existing SOP id and bootstrap_key.
   * @param {string} sopId
   * @param {Object} sopData
   * @returns {Promise<Object>}
   */
  async updateSop(sopId, sopData) {
    const cleanId = String(sopId || '').trim();
    const updatePayload = {
      updated_at: new Date().toISOString(),
    };

    if (sopData.title !== undefined) updatePayload.title = sopData.title.trim();
    if (sopData.owner !== undefined) updatePayload.owner = sopData.owner.trim();
    if (sopData.status !== undefined) updatePayload.status = sopData.status;
    if (sopData.estimated_time !== undefined) updatePayload.estimated_time = sopData.estimated_time;
    if (sopData.purpose !== undefined) updatePayload.purpose = sopData.purpose.trim();
    if (sopData.when_to_use !== undefined) updatePayload.when_to_use = sopData.when_to_use.trim();
    if (sopData.requirements !== undefined) updatePayload.requirements = sopData.requirements;
    if (sopData.responsible_team !== undefined) updatePayload.responsible_team = sopData.responsible_team.trim();
    if (sopData.checklist !== undefined) updatePayload.checklist = sopData.checklist;
    if (sopData.steps !== undefined) updatePayload.steps = sopData.steps;
    if (sopData.escalation_rules !== undefined) updatePayload.escalation_rules = sopData.escalation_rules.trim();
    if (sopData.completion_criteria !== undefined) updatePayload.completion_criteria = sopData.completion_criteria.trim();
    if (sopData.related_issues !== undefined) updatePayload.related_issues = sopData.related_issues;
    if (sopData.related_guides !== undefined) updatePayload.related_guides = sopData.related_guides;
    if (sopData.internal_notes !== undefined) updatePayload.internal_notes = sopData.internal_notes.trim();
    if (sopData.revision_history !== undefined) updatePayload.revision_history = sopData.revision_history;

    const { data, error } = await this.client
      .from('sops')
      .update(updatePayload)
      .eq('id', cleanId)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to update SOP '${cleanId}': ${error.message}`);
    }

    return data;
  }

  /**
   * Safely restore a soft-deleted SOP and synchronize bundle fields.
   * @param {string} sopId
   * @param {Object} [sopUpdates={}]
   * @returns {Promise<Object>}
   */
  async restoreSop(sopId, sopUpdates = {}) {
    const cleanId = String(sopId || '').trim();
    const updatePayload = {
      deleted_at: null,
      deleted_by: null,
      updated_at: new Date().toISOString(),
      ...sopUpdates,
    };

    const { data, error } = await this.client
      .from('sops')
      .update(updatePayload)
      .eq('id', cleanId)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to restore SOP '${cleanId}': ${error.message}`);
    }

    return data;
  }

  // ---------------------------------------------------------------------------
  // Storage & Media Operations
  // ---------------------------------------------------------------------------

  /**
   * Check if a storage key already exists in the given bucket.
   * @param {string} bucket
   * @param {string} storageKey
   * @returns {Promise<boolean>}
   */
  async checkStorageObjectExists(bucket, storageKey) {
    const targetBucket = bucket || this.bucket;
    const cleanKey = String(storageKey || '').trim();
    const lastSlash = cleanKey.lastIndexOf('/');
    const folder = lastSlash !== -1 ? cleanKey.slice(0, lastSlash) : '';
    const filename = lastSlash !== -1 ? cleanKey.slice(lastSlash + 1) : cleanKey;

    try {
      const { data, error } = await this.client.storage
        .from(targetBucket)
        .list(folder, { search: filename });

      if (error || !Array.isArray(data)) {
        return false;
      }

      return data.some(item => item.name === filename);
    } catch {
      return false;
    }
  }

  /**
   * Upload binary buffer to Supabase Storage.
   * @param {string} bucket
   * @param {string} storageKey
   * @param {Buffer|Uint8Array} fileBuffer
   * @param {string} contentType
   * @returns {Promise<void>}
   */
  async uploadStorageObject(bucket, storageKey, fileBuffer, contentType) {
    const targetBucket = bucket || this.bucket;
    const cleanKey = String(storageKey || '').trim();

    const { error } = await this.client.storage
      .from(targetBucket)
      .upload(cleanKey, fileBuffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      throw new Error(`Failed to upload storage object '${cleanKey}': ${error.message}`);
    }
  }

  /**
   * Ensure metadata record exists in public.media_files prior to attribution linking.
   * @param {Object} record
   * @returns {Promise<void>}
   */
  async ensureMediaFileRecord(record) {
    const insertPayload = {
      storage_key: record.storage_key,
      bucket: record.bucket || this.bucket,
      filename: record.filename,
      content_type: record.content_type,
      file_size_bytes: record.file_size_bytes,
      media_type: record.media_type,
      sop_id: record.sop_id || null,
      created_by: record.created_by || 'Bootstrap Importer',
    };

    const { error } = await this.client
      .from('media_files')
      .upsert(insertPayload, { onConflict: 'storage_key' });

    if (error) {
      throw new Error(`Failed to ensure media_files record for '${record.storage_key}': ${error.message}`);
    }
  }

  /**
   * Atomically link storage keys in public.media_files to target SOP via canonical RPC fn_link_sop_media.
   * @param {string} sopId
   * @param {string[]} storageKeys
   * @returns {Promise<number>} Number of rows updated
   */
  async linkSopMedia(sopId, storageKeys) {
    const cleanId = String(sopId || '').trim();
    const validKeys = Array.from(new Set((storageKeys || []).map(k => String(k || '').trim()).filter(Boolean)));

    if (!cleanId || validKeys.length === 0) {
      return 0;
    }

    const { data, error } = await this.client.rpc('fn_link_sop_media', {
      p_sop_id: cleanId,
      p_storage_keys: validKeys,
    });

    if (error) {
      throw new Error(`Failed to associate media with SOP '${cleanId}': ${error.message}`);
    }

    return typeof data === 'number' ? data : validKeys.length;
  }
}
