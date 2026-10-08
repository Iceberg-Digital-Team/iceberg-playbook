import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '../lib/supabase';
import type { Playbook } from '../data';
import { toSlug } from '../slug';

export interface DatabasePlaybookRow {
  id: string;
  slug: string;
  name: string;
  code: string;
  description: string;
  icon: string | null;
  owner: string | null;
  visibility: 'Internal' | 'Public' | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface CreatePlaybookInput {
  name: string;
  code: string;
  description: string;
  icon?: string;
  owner?: string;
  visibility?: 'Internal' | 'Public';
  slug?: string;
  id?: string;
}

export interface DeletedPlaybookConflict {
  id: string;
  name: string;
  code: string;
  slug: string;
}

export type PlaybookConflictCheckResult =
  | { type: 'AVAILABLE' }
  | { type: 'ACTIVE_CONFLICT'; message: string; field: 'name' | 'code' }
  | { type: 'DELETED_CONFLICT'; playbook: DeletedPlaybookConflict };

export interface PlaybookCounts {
  issueCount?: number;
  guideCount?: number;
  sopCount?: number;
  activeIssuesCount?: number;
  activeGuidesCount?: number;
  activeSopsCount?: number;
}

export function mapPlaybookRowToPlaybook(
  row: DatabasePlaybookRow,
  counts?: PlaybookCounts
): Playbook {
  const issueCount = counts?.activeIssuesCount ?? counts?.issueCount ?? 0;
  const guideCount = counts?.activeGuidesCount ?? counts?.guideCount ?? 0;
  const sopCount = counts?.activeSopsCount ?? counts?.sopCount ?? 0;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    code: row.code,
    description: row.description || '',
    icon: row.icon || 'MessageSquare',
    owner: row.owner || 'Support Team',
    visibility: (row.visibility as 'Internal' | 'Public') || 'Internal',
    updatedAt: row.updated_at || new Date().toISOString(),
    issueCount,
    guideCount,
    sopCount,
    activeIssuesCount: issueCount,
    activeGuidesCount: guideCount,
    activeSopsCount: sopCount,
  };
}

export function aggregatePlaybookCounts(
  issues: Array<{ playbook_id?: string | null; deleted_at?: string | null }>,
  guides: Array<{ playbook_id?: string | null; deleted_at?: string | null }>,
  sops: Array<{ playbook_id?: string | null; deleted_at?: string | null }>
): Record<string, Required<PlaybookCounts>> {
  const counts: Record<string, Required<PlaybookCounts>> = {};

  const ensureEntry = (id: string): Required<PlaybookCounts> => {
    if (!counts[id]) {
      counts[id] = {
        issueCount: 0,
        guideCount: 0,
        sopCount: 0,
        activeIssuesCount: 0,
        activeGuidesCount: 0,
        activeSopsCount: 0,
      };
    }
    return counts[id];
  };

  for (const item of issues) {
    if (item.deleted_at == null && item.playbook_id) {
      const entry = ensureEntry(item.playbook_id);
      entry.issueCount += 1;
      entry.activeIssuesCount += 1;
    }
  }

  for (const item of guides) {
    if (item.deleted_at == null && item.playbook_id) {
      const entry = ensureEntry(item.playbook_id);
      entry.guideCount += 1;
      entry.activeGuidesCount += 1;
    }
  }

  for (const item of sops) {
    if (item.deleted_at == null && item.playbook_id) {
      const entry = ensureEntry(item.playbook_id);
      entry.sopCount += 1;
      entry.activeSopsCount += 1;
    }
  }

  return counts;
}

async function fetchActiveChildRows(
  client: SupabaseClient,
  table: 'issues' | 'guides' | 'sops',
  playbookId?: string
): Promise<Array<{ playbook_id: string; deleted_at: string | null }>> {
  let query: any = client.from(table).select('playbook_id, deleted_at');
  if (playbookId && typeof query.eq === 'function') {
    query = query.eq('playbook_id', playbookId);
  }
  if (typeof query.is === 'function') {
    query = query.is('deleted_at', null);
  }

  const { data, error } = await (typeof query.order === 'function' ? query.order('id') : query);

  if (error) {
    if (error.code === '42501') {
      throw new Error('Permission denied. Please verify your account role.');
    }
    throw new Error(`Failed to load ${table}: ${error.message}`);
  }

  const list = (data || []) as Array<{ playbook_id: string; deleted_at: string | null }>;
  return playbookId ? list.filter(r => r.playbook_id === playbookId) : list;
}

export async function fetchActivePlaybookCounts(
  client: SupabaseClient = defaultSupabase,
  playbookId?: string
): Promise<Record<string, Required<PlaybookCounts>>> {
  const [issues, guides, sops] = await Promise.all([
    fetchActiveChildRows(client, 'issues', playbookId),
    fetchActiveChildRows(client, 'guides', playbookId),
    fetchActiveChildRows(client, 'sops', playbookId),
  ]);

  return aggregatePlaybookCounts(issues, guides, sops);
}

export async function listPlaybooks(
  client: SupabaseClient = defaultSupabase
): Promise<Playbook[]> {
  const pbQuery = client
    .from('playbooks')
    .select('id, slug, name, code, description, icon, owner, visibility, created_at, updated_at, deleted_at, deleted_by')
    .is('deleted_at', null)
    .order('name', { ascending: true });

  const [pbRes, countMap] = await Promise.all([
    pbQuery,
    fetchActivePlaybookCounts(client),
  ]);

  if (pbRes.error) {
    if (pbRes.error.code === '42501') {
      throw new Error('Permission denied. Please verify your account role.');
    }
    throw new Error(`Failed to load Playbooks: ${pbRes.error.message}`);
  }

  return (pbRes.data || []).map(row =>
    mapPlaybookRowToPlaybook(row, countMap[row.id])
  );
}

export async function getPlaybookBySlug(
  slug: string,
  client: SupabaseClient = defaultSupabase
): Promise<Playbook | null> {
  const cleanSlug = slug.trim();
  if (!cleanSlug) {
    return null;
  }

  const { data, error } = await client
    .from('playbooks')
    .select('id, slug, name, code, description, icon, owner, visibility, created_at, updated_at, deleted_at, deleted_by')
    .eq('slug', cleanSlug)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    if (error.code === '42501') {
      throw new Error('Permission denied. Please verify your account role.');
    }
    throw new Error(`Failed to load Playbook: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const countMap = await fetchActivePlaybookCounts(client, data.id);
  return mapPlaybookRowToPlaybook(data, countMap[data.id]);
}

export async function checkPlaybookConflict(
  params: { name: string; code: string; slug?: string },
  client: SupabaseClient = defaultSupabase
): Promise<PlaybookConflictCheckResult> {
  const trimmedName = params.name.trim();
  const trimmedCode = params.code.trim().toUpperCase();
  const slug = params.slug?.trim() || toSlug(trimmedName);

  if (!trimmedName || !slug) {
    throw new Error('Enter a valid Playbook name.');
  }

  if (!trimmedCode) {
    throw new Error('Enter a code prefix.');
  }

  // 1. Try RPC fn_check_playbook_conflict if available
  if (typeof client?.rpc === 'function') {
    try {
      const { data, error } = await client.rpc('fn_check_playbook_conflict', {
        p_name: trimmedName,
        p_slug: slug,
        p_code: trimmedCode,
      });

      if (!error && Array.isArray(data)) {
        if (data.length > 0) {
          const match = data[0];
          if (match.conflict_type === 'ACTIVE_CODE') {
            return {
              type: 'ACTIVE_CONFLICT',
              field: 'code',
              message: 'A Playbook with this code prefix already exists. Choose another.',
            };
          }
          if (match.conflict_type === 'ACTIVE_NAME') {
            return {
              type: 'ACTIVE_CONFLICT',
              field: 'name',
              message: 'A Playbook with this name already exists. Choose another.',
            };
          }
          if (match.conflict_type === 'DELETED_CONFLICT') {
            return {
              type: 'DELETED_CONFLICT',
              playbook: {
                id: match.playbook_id,
                name: match.playbook_name,
                code: match.playbook_code,
                slug: match.playbook_slug,
              },
            };
          }
        }
        return { type: 'AVAILABLE' };
      }
    } catch {
      // Fallback to table queries below if RPC call is not available in mock/test
    }
  }

  // 2. Fallback: Table-level active check
  if (typeof client?.from === 'function') {
    const [codeCheck, slugCheck, nameCheck] = await Promise.all([
      client.from('playbooks').select('id, name, code, slug').eq('code', trimmedCode).is('deleted_at', null).maybeSingle(),
      client.from('playbooks').select('id, name, code, slug').eq('slug', slug).is('deleted_at', null).maybeSingle(),
      client.from('playbooks').select('id, name, code, slug').ilike('name', trimmedName).is('deleted_at', null).maybeSingle(),
    ]);

    if (codeCheck?.data) {
      return {
        type: 'ACTIVE_CONFLICT',
        field: 'code',
        message: 'A Playbook with this code prefix already exists. Choose another.',
      };
    }
    if (slugCheck?.data || nameCheck?.data) {
      return {
        type: 'ACTIVE_CONFLICT',
        field: 'name',
        message: 'A Playbook with this name already exists. Choose another.',
      };
    }

    // Fallback: Table-level soft-deleted check
    try {
      const { data: deletedMatch } = await client
        .from('playbooks')
        .select('id, name, code, slug')
        .not('deleted_at', 'is', null)
        .or(`code.eq.${trimmedCode},slug.eq.${slug},id.eq.${slug}`)
        .maybeSingle();

      if (deletedMatch) {
        return {
          type: 'DELETED_CONFLICT',
          playbook: {
            id: deletedMatch.id,
            name: deletedMatch.name,
            code: deletedMatch.code,
            slug: deletedMatch.slug,
          },
        };
      }
    } catch {
      // Ignore if RLS blocks soft-deleted select
    }
  }

  return { type: 'AVAILABLE' };
}

export async function findDeletedPlaybookConflict(
  input: { name: string; code: string; slug?: string },
  client: SupabaseClient = defaultSupabase
): Promise<DeletedPlaybookConflict | null> {
  const result = await checkPlaybookConflict(input, client);
  if (result.type === 'DELETED_CONFLICT') {
    return result.playbook;
  }
  return null;
}

export async function createPlaybook(
  input: CreatePlaybookInput,
  client: SupabaseClient = defaultSupabase
): Promise<Playbook> {
  const trimmedName = input.name.trim();
  const trimmedCode = input.code.trim().toUpperCase();
  const trimmedDescription = input.description.trim();
  const slug = input.slug?.trim() || toSlug(trimmedName);

  if (!trimmedName || !slug) {
    throw new Error('Enter a valid Playbook name.');
  }

  if (!trimmedCode) {
    throw new Error('Enter a code prefix.');
  }

  if (trimmedCode.length < 2 || trimmedCode.length > 5 || !/^[A-Z0-9]{2,5}$/.test(trimmedCode)) {
    throw new Error('Code prefix must be 2 to 5 alphanumeric characters (A-Z, 0-9).');
  }

  if (!trimmedDescription) {
    throw new Error('Enter a description.');
  }

  // Pre-insert conflict verification
  const conflict = await checkPlaybookConflict({ name: trimmedName, code: trimmedCode, slug }, client);
  if (conflict.type === 'ACTIVE_CONFLICT') {
    throw new Error(conflict.message);
  }
  if (conflict.type === 'DELETED_CONFLICT') {
    throw new Error(
      `A deleted Playbook with this name or code already exists ('${conflict.playbook.name}' - ${conflict.playbook.code}). Would you like to restore it instead?`
    );
  }

  const id = input.id?.trim() || slug;
  const insertPayload = {
    id,
    slug,
    name: trimmedName,
    code: trimmedCode,
    description: trimmedDescription,
    icon: input.icon || 'MessageSquare',
    owner: input.owner?.trim() || 'Support Team',
    visibility: input.visibility || 'Internal',
  };

  const { data, error } = await client
    .from('playbooks')
    .insert(insertPayload)
    .select('id, slug, name, code, description, icon, owner, visibility, created_at, updated_at, deleted_at, deleted_by')
    .single();

  if (error) {
    if (error.code === '23505') {
      const msg = error.message.toLowerCase();
      if (msg.includes('code')) {
        throw new Error('A Playbook with this code prefix already exists. Choose another.');
      }
      throw new Error('A Playbook with this name already exists. Choose another.');
    }
    if (error.code === '23514') {
      throw new Error('Code prefix must be 2 to 5 alphanumeric characters (A-Z, 0-9).');
    }
    if (error.code === '42501') {
      throw new Error('Permission denied. Support or Admin role required to create Playbooks.');
    }
    throw new Error(error.message || 'Could not create Playbook.');
  }

  return mapPlaybookRowToPlaybook(data);
}

export async function restorePlaybook(
  id: string,
  client: SupabaseClient = defaultSupabase
): Promise<Playbook> {
  const cleanId = id.trim();
  if (!cleanId) {
    throw new Error('Invalid Playbook ID.');
  }

  const { error } = await client.rpc('fn_restore_playbook', {
    p_playbook_id: cleanId,
  });

  if (error) {
    if (error.code === '42501' || error.message.includes('Permission denied')) {
      throw new Error('Permission denied. Support or Admin role required.');
    }
    if (error.message.includes('already active')) {
      throw new Error('Playbook is already active.');
    }
    throw new Error(error.message || 'Could not restore Playbook.');
  }

  const { data, error: fetchError } = await client
    .from('playbooks')
    .select('id, slug, name, code, description, icon, owner, visibility, created_at, updated_at, deleted_at, deleted_by')
    .eq('id', cleanId)
    .is('deleted_at', null)
    .maybeSingle();

  if (fetchError || !data) {
    throw new Error(fetchError?.message || 'Could not load restored Playbook.');
  }

  const countMap = await fetchActivePlaybookCounts(client, data.id);
  return mapPlaybookRowToPlaybook(data, countMap[data.id]);
}

export async function softDeletePlaybook(
  id: string,
  client: SupabaseClient = defaultSupabase
): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) {
    throw new Error('Invalid Playbook ID.');
  }

  const { error } = await client.rpc('fn_soft_delete_playbook', {
    p_playbook_id: cleanId,
  });

  if (error) {
    if (error.message.includes('contains content')) {
      throw new Error('This Playbook contains content and cannot be deleted.');
    }
    if (error.code === '42501' || error.message.includes('Permission denied')) {
      throw new Error('Permission denied. Support or Admin role required.');
    }
    throw new Error(error.message || 'Could not delete Playbook.');
  }
}
