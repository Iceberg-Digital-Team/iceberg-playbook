import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '../lib/supabase';
import type { SOP, Step, Revision } from '../data';

export interface DatabaseSopRow {
  id: string;
  playbook_id: string;
  title: string;
  owner: string;
  status: 'Verified' | 'Draft';
  estimated_time: string;
  purpose: string;
  when_to_use: string;
  requirements: string[] | null;
  responsible_team: string;
  checklist: string[] | null;
  steps: Step[] | null;
  escalation_rules: string | null;
  completion_criteria: string | null;
  related_issues: string[] | null;
  related_guides: string[] | null;
  internal_notes: string | null;
  revision_history: Revision[] | null;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSopInput {
  playbookId: string;
  title: string;
  purpose: string;
  whenToUse: string;
  status?: 'Verified' | 'Draft';
  estimatedTime?: string;
  requirements?: string[];
  responsibleTeam?: string;
  checklist?: string[];
  steps?: Array<Omit<Step, 'number'>> | Step[];
  escalationRules?: string;
  completionCriteria?: string;
  relatedIssues?: string[];
  relatedGuides?: string[];
  internalNotes?: string;
  owner?: string;
}

export function mapSopRowToSop(row: DatabaseSopRow): SOP {
  return {
    id: row.id,
    playbookId: row.playbook_id,
    title: row.title,
    owner: row.owner || 'Support Team',
    status: row.status,
    estimatedTime: row.estimated_time || '30 min',
    updatedAt: row.updated_at || row.created_at,
    purpose: row.purpose,
    whenToUse: row.when_to_use,
    requirements: Array.isArray(row.requirements) ? row.requirements : [],
    responsibleTeam: row.responsible_team || 'Support & Onboarding Team',
    checklist: Array.isArray(row.checklist) ? row.checklist : [],
    steps: Array.isArray(row.steps) ? row.steps : [],
    escalationRules: row.escalation_rules || '',
    completionCriteria: row.completion_criteria || '',
    relatedIssues: Array.isArray(row.related_issues) ? row.related_issues : [],
    relatedGuides: Array.isArray(row.related_guides) ? row.related_guides : [],
    internalNotes: row.internal_notes || '',
    revisionHistory: Array.isArray(row.revision_history) ? row.revision_history : []
  };
}

export async function listSops(
  client: SupabaseClient = defaultSupabase
): Promise<SOP[]> {
  const { data, error } = await client
    .from('sops')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    if (error.code === '42501') {
      throw new Error('Permission denied. Please verify your account role.');
    }
    throw new Error(`Failed to load SOPs: ${error.message}`);
  }

  return (data || []).map(mapSopRowToSop);
}

export async function listSopsByPlaybook(
  playbookId: string,
  client: SupabaseClient = defaultSupabase
): Promise<SOP[]> {
  const cleanId = playbookId.trim();
  if (!cleanId) {
    return [];
  }

  const { data, error } = await client
    .from('sops')
    .select('*')
    .eq('playbook_id', cleanId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    if (error.code === '42501') {
      throw new Error('Permission denied. Please verify your account role.');
    }
    throw new Error(`Failed to load SOPs for Playbook: ${error.message}`);
  }

  return (data || []).map(mapSopRowToSop);
}

export async function getSopById(
  id: string,
  client: SupabaseClient = defaultSupabase
): Promise<SOP | null> {
  const cleanId = id.trim();
  if (!cleanId) {
    return null;
  }

  const { data, error } = await client
    .from('sops')
    .select('*')
    .eq('id', cleanId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    if (error.code === '42501') {
      throw new Error('Permission denied. Please verify your account role.');
    }
    throw new Error(`Failed to load SOP: ${error.message}`);
  }

  return data ? mapSopRowToSop(data) : null;
}

export async function createSop(
  input: CreateSopInput,
  client: SupabaseClient = defaultSupabase
): Promise<SOP> {
  const trimmedPlaybookId = input.playbookId?.trim() || '';
  const trimmedTitle = input.title?.trim() || '';
  const trimmedPurpose = input.purpose?.trim() || '';
  const trimmedWhenToUse = input.whenToUse?.trim() || '';

  if (!trimmedPlaybookId) {
    throw new Error('Select a Playbook for this SOP.');
  }
  if (!trimmedTitle) {
    throw new Error('Enter an SOP title.');
  }
  if (!trimmedPurpose) {
    throw new Error('Provide an SOP purpose.');
  }
  if (!trimmedWhenToUse) {
    throw new Error('Provide when to use this SOP.');
  }

  // Atomic unique code generation via Supabase RPC
  const { data: codeData, error: codeError } = await client.rpc('fn_generate_sop_code', {
    p_playbook_id: trimmedPlaybookId
  });

  if (codeError || !codeData) {
    throw new Error(codeError?.message || 'Could not generate unique SOP code.');
  }

  const sopId = String(codeData);

  const formattedSteps = (input.steps || []).map((s, i) => ({
    number: i + 1,
    title: s.title?.trim() || '',
    description: s.description?.trim() || ''
  }));

  const initialRevision: Revision = {
    version: '1.0.0',
    date: new Date().toISOString().split('T')[0],
    updatedBy: input.owner?.trim() || 'Support Team',
    changes: 'SOP published via editor.'
  };

  const { data, error } = await client
    .from('sops')
    .insert({
      id: sopId,
      playbook_id: trimmedPlaybookId,
      title: trimmedTitle,
      owner: input.owner?.trim() || 'Support Team',
      status: input.status || 'Draft',
      estimated_time: input.estimatedTime?.trim() || '30 min',
      purpose: trimmedPurpose,
      when_to_use: trimmedWhenToUse,
      requirements: (input.requirements || []).map(r => r.trim()).filter(Boolean),
      responsible_team: input.responsibleTeam?.trim() || 'Support & Onboarding Team',
      checklist: (input.checklist || []).map(c => c.trim()).filter(Boolean),
      steps: formattedSteps,
      escalation_rules: input.escalationRules?.trim() || '',
      completion_criteria: input.completionCriteria?.trim() || '',
      related_issues: input.relatedIssues || [],
      related_guides: input.relatedGuides || [],
      internal_notes: input.internalNotes?.trim() || '',
      revision_history: [initialRevision]
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '42501' || error.message?.includes('Permission denied')) {
      throw new Error('Permission denied. Support or Admin role required.');
    }
    throw new Error(`Failed to create SOP: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to create SOP: No data returned from database.');
  }

  return mapSopRowToSop(data as DatabaseSopRow);
}

export interface UpdateSopInput {
  id: string;
  title: string;
  purpose: string;
  whenToUse: string;
  status?: 'Verified' | 'Draft';
  estimatedTime?: string;
  requirements?: string[];
  responsibleTeam?: string;
  checklist?: string[];
  steps?: Array<Omit<Step, 'number'>> | Step[];
  escalationRules?: string;
  completionCriteria?: string;
  relatedIssues?: string[];
  relatedGuides?: string[];
  internalNotes?: string;
  owner?: string;
  revisionHistory?: Revision[];
}

export async function updateSop(
  input: UpdateSopInput,
  client: SupabaseClient = defaultSupabase
): Promise<SOP> {
  const cleanId = input.id?.trim() || '';
  const trimmedTitle = input.title?.trim() || '';
  const trimmedPurpose = input.purpose?.trim() || '';
  const trimmedWhenToUse = input.whenToUse?.trim() || '';

  if (!cleanId) {
    throw new Error('Enter an SOP ID.');
  }
  if (!trimmedTitle) {
    throw new Error('Enter an SOP title.');
  }
  if (!trimmedPurpose) {
    throw new Error('Provide an SOP purpose.');
  }
  if (!trimmedWhenToUse) {
    throw new Error('Provide when to use this SOP.');
  }

  const formattedSteps = (input.steps || []).map((s, i) => ({
    number: i + 1,
    title: s.title?.trim() || '',
    description: s.description?.trim() || ''
  }));

  const updatePayload: Record<string, unknown> = {
    title: trimmedTitle,
    owner: input.owner?.trim() || 'Support Team',
    status: input.status || 'Draft',
    estimated_time: input.estimatedTime?.trim() || '30 min',
    purpose: trimmedPurpose,
    when_to_use: trimmedWhenToUse,
    requirements: (input.requirements || []).map(r => r.trim()).filter(Boolean),
    responsible_team: input.responsibleTeam?.trim() || 'Support & Onboarding Team',
    checklist: (input.checklist || []).map(c => c.trim()).filter(Boolean),
    steps: formattedSteps,
    escalation_rules: input.escalationRules?.trim() || '',
    completion_criteria: input.completionCriteria?.trim() || '',
    related_issues: input.relatedIssues || [],
    related_guides: input.relatedGuides || [],
    internal_notes: input.internalNotes?.trim() || '',
    updated_at: new Date().toISOString()
  };

  if (input.revisionHistory !== undefined) {
    updatePayload.revision_history = input.revisionHistory;
  }

  const { data, error } = await client
    .from('sops')
    .update(updatePayload)
    .eq('id', cleanId)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle();

  if (error) {
    if (error.code === '42501' || error.message?.includes('Permission denied')) {
      throw new Error('Permission denied. Support or Admin role required.');
    }
    throw new Error(`Failed to update SOP: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to update SOP: SOP not found or already deleted.');
  }

  return mapSopRowToSop(data as DatabaseSopRow);
}

export async function softDeleteSop(
  id: string,
  client: SupabaseClient = defaultSupabase
): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) {
    throw new Error('Invalid SOP ID.');
  }

  const { error } = await client.rpc('fn_soft_delete_sop', {
    p_sop_id: cleanId,
  });

  if (error) {
    if (error.code === '42501' || error.message?.includes('Permission denied')) {
      throw new Error('Permission denied. Support or Admin role required.');
    }
    throw new Error(error.message || 'Could not delete SOP.');
  }
}

