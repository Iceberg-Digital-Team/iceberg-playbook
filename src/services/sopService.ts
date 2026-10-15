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

import { isStorageKey } from './mediaService';
export { resolveStepMedia, resolveSopMedia } from './mediaService';

export const MEDIA_LINKING_WARNING = 'The SOP was saved, but media ownership metadata could not be linked.';

export function extractStepStorageKeys(
  steps?: Step[] | Array<Omit<Step, 'number'>> | null
): string[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    return [];
  }
  const keys = new Set<string>();
  for (const step of steps) {
    if (step.screenshot && isStorageKey(step.screenshot)) {
      keys.add(step.screenshot.trim());
    }
    if (step.videoLink && isStorageKey(step.videoLink)) {
      keys.add(step.videoLink.trim());
    }
    if (step.pdfReference && isStorageKey(step.pdfReference)) {
      keys.add(step.pdfReference.trim());
    }
  }
  return Array.from(keys);
}

export async function linkSopMedia(
  sopId: string,
  storageKeys: string[],
  client: SupabaseClient = defaultSupabase
): Promise<void> {
  const cleanId = sopId?.trim();
  const validKeys = Array.from(
    new Set(
      (storageKeys || [])
        .map(k => k?.trim())
        .filter((k): k is string => Boolean(k && isStorageKey(k)))
    )
  );

  if (!cleanId || validKeys.length === 0) {
    return;
  }

  const { error: rpcError } = await client.rpc('fn_link_sop_media', {
    p_sop_id: cleanId,
    p_storage_keys: validKeys
  });

  if (rpcError) {
    if (rpcError.code === '42501' || rpcError.message?.includes('Permission denied')) {
      throw new Error('Permission denied. Support or Admin role required.');
    }
    throw new Error(`Failed to associate media with SOP: ${rpcError.message}`);
  }
}

export function formatSopStep(s: Step | Omit<Step, 'number'>, index: number): Step {
  const step: Step = {
    number: typeof (s as Step).number === 'number' && (s as Step).number > 0 ? (s as Step).number : index + 1,
    title: s.title?.trim() || '',
    description: s.description?.trim() || ''
  };

  const estimatedTime = s.estimatedTime?.trim();
  if (estimatedTime) {
    step.estimatedTime = estimatedTime;
  }

  const screenshot = s.screenshot?.trim();
  if (screenshot) {
    step.screenshot = screenshot;
  }

  const importantNote = s.importantNote?.trim();
  if (importantNote) {
    step.importantNote = importantNote;
  }

  const successIndicator = s.successIndicator?.trim();
  if (successIndicator) {
    step.successIndicator = successIndicator;
  }

  const videoLink = s.videoLink?.trim();
  if (videoLink) {
    step.videoLink = videoLink;
  }

  const pdfReference = s.pdfReference?.trim();
  if (pdfReference) {
    step.pdfReference = pdfReference;
  }

  return step;
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

  const formattedSteps = (input.steps || []).map((s, i) => formatSopStep(s, i));

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

  const createdSop = mapSopRowToSop(data as DatabaseSopRow);

  const stepStorageKeys = extractStepStorageKeys(formattedSteps);
  if (stepStorageKeys.length > 0) {
    try {
      await linkSopMedia(sopId, stepStorageKeys, client);
    } catch (err) {
      console.warn('Could not link media to created SOP:', err);
      return {
        ...createdSop,
        warning: MEDIA_LINKING_WARNING,
        mediaWarning: MEDIA_LINKING_WARNING
      };
    }
  }

  return createdSop;
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

  const formattedSteps = (input.steps || []).map((s, i) => formatSopStep(s, i));

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

  const updatedSop = mapSopRowToSop(data as DatabaseSopRow);

  const stepStorageKeys = extractStepStorageKeys(formattedSteps);
  if (stepStorageKeys.length > 0) {
    try {
      await linkSopMedia(cleanId, stepStorageKeys, client);
    } catch (err) {
      console.warn('Could not link media to updated SOP:', err);
      return {
        ...updatedSop,
        warning: MEDIA_LINKING_WARNING,
        mediaWarning: MEDIA_LINKING_WARNING
      };
    }
  }

  return updatedSop;
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

