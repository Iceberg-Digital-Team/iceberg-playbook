import type { DbClient } from '../lib/apiClient';
import { supabase as defaultSupabase } from '../lib/supabase';
import type { Issue, Attachment } from '../data';

export interface DatabaseIssueRow {
  id: string;
  playbook_id: string;
  title: string;
  summary: string;
  symptoms: string[] | null;
  error_message: string | null;
  context: string | null;
  affected_area: string | null;
  information_to_collect: string[] | null;
  attachments: Attachment[] | null;
  internal_notes: string | null;
  status: 'Verified' | 'Draft';
  difficulty: 'Easy' | 'Medium' | 'Advanced';
  estimated_time: string | null;
  author: string;
  jira_code?: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateIssueInput {
  playbookId: string;
  title: string;
  summary: string;
  jiraCode?: string;
  status?: 'Verified' | 'Draft';
  difficulty?: 'Easy' | 'Medium' | 'Advanced';
  estimatedTime?: string;
  symptoms?: string[];
  errorMessage?: string;
  context?: string;
  affectedArea?: string;
  informationToCollect?: string[];
  attachments?: Attachment[];
  internalNotes?: string;
  author?: string;
}

export interface UpdateIssueInput {
  id: string;
  title: string;
  summary: string;
  jiraCode?: string | null;
  status?: 'Verified' | 'Draft';
  difficulty?: 'Easy' | 'Medium' | 'Advanced';
  estimatedTime?: string;
  symptoms?: string[];
  errorMessage?: string;
  context?: string;
  affectedArea?: string;
  informationToCollect?: string[];
  attachments?: Attachment[];
  internalNotes?: string;
  author?: string;
}

export function mapIssueRowToIssue(row: DatabaseIssueRow): Issue {
  return {
    id: row.id,
    playbookId: row.playbook_id,
    title: row.title,
    summary: row.summary,
    jiraCode: row.jira_code?.trim() || undefined,
    symptoms: Array.isArray(row.symptoms) ? row.symptoms : [],
    errorMessage: row.error_message || '',
    context: row.context || '',
    affectedArea: row.affected_area || '',
    informationToCollect: Array.isArray(row.information_to_collect) ? row.information_to_collect : [],
    attachments: Array.isArray(row.attachments)
      ? row.attachments.map(a => ({ name: a.name || '', url: a.url || '' }))
      : [],
    internalNotes: row.internal_notes || '',
    status: row.status || 'Draft',
    difficulty: row.difficulty || 'Medium',
    estimatedTime: row.estimated_time || '',
    author: row.author || 'Support Team',
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

export async function listIssues(
  client: DbClient = defaultSupabase
): Promise<Issue[]> {
  const { data, error } = await client
    .from('issues')
    .select('id, playbook_id, title, summary, symptoms, error_message, context, affected_area, information_to_collect, attachments, internal_notes, status, difficulty, estimated_time, author, jira_code, deleted_at, deleted_by, created_at, updated_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    if (error.code === '42501') {
      throw new Error('Permission denied. Please verify your account role.');
    }
    throw new Error(`Failed to load Issues: ${error.message}`);
  }

  return (data || []).map(mapIssueRowToIssue);
}

export async function listIssuesByPlaybook(
  playbookId: string,
  client: DbClient = defaultSupabase
): Promise<Issue[]> {
  const cleanId = playbookId.trim();
  if (!cleanId) {
    return [];
  }

  const { data, error } = await client
    .from('issues')
    .select('id, playbook_id, title, summary, symptoms, error_message, context, affected_area, information_to_collect, attachments, internal_notes, status, difficulty, estimated_time, author, jira_code, deleted_at, deleted_by, created_at, updated_at')
    .eq('playbook_id', cleanId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    if (error.code === '42501') {
      throw new Error('Permission denied. Please verify your account role.');
    }
    throw new Error(`Failed to load Issues for playbook: ${error.message}`);
  }

  return (data || []).map(mapIssueRowToIssue);
}

export async function getIssueById(
  id: string,
  client: DbClient = defaultSupabase
): Promise<Issue | null> {
  const cleanId = id.trim();
  if (!cleanId) {
    return null;
  }

  const { data, error } = await client
    .from('issues')
    .select('id, playbook_id, title, summary, symptoms, error_message, context, affected_area, information_to_collect, attachments, internal_notes, status, difficulty, estimated_time, author, jira_code, deleted_at, deleted_by, created_at, updated_at')
    .eq('id', cleanId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    if (error.code === '42501') {
      throw new Error('Permission denied. Please verify your account role.');
    }
    throw new Error(`Failed to load Issue: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapIssueRowToIssue(data);
}

export async function createIssue(
  input: CreateIssueInput,
  client: DbClient = defaultSupabase
): Promise<Issue> {
  const trimmedPlaybookId = input.playbookId?.trim() || '';
  const trimmedTitle = input.title?.trim() || '';
  const trimmedSummary = input.summary?.trim() || '';
  const trimmedJiraCode = input.jiraCode?.trim() || null;

  if (!trimmedPlaybookId) {
    throw new Error('Select a Playbook for this Issue.');
  }
  if (!trimmedTitle) {
    throw new Error('Enter an Issue title.');
  }
  if (!trimmedSummary) {
    throw new Error('Provide a problem summary.');
  }

  // Atomic unique code generation via Supabase RPC
  const { data: codeData, error: codeError } = await client.rpc('fn_generate_issue_code', {
    p_playbook_id: trimmedPlaybookId,
  });

  if (codeError || !codeData) {
    throw new Error(codeError?.message || 'Could not generate unique Issue code.');
  }

  const issueId = String(codeData);

  const { data, error } = await client
    .from('issues')
    .insert({
      id: issueId,
      playbook_id: trimmedPlaybookId,
      title: trimmedTitle,
      summary: trimmedSummary,
      jira_code: trimmedJiraCode,
      status: input.status || 'Draft',
      difficulty: input.difficulty || 'Medium',
      estimated_time: input.estimatedTime?.trim() || '',
      symptoms: (input.symptoms || []).map(s => s.trim()).filter(Boolean),
      error_message: input.errorMessage?.trim() || '',
      context: input.context?.trim() || '',
      affected_area: input.affectedArea?.trim() || '',
      information_to_collect: (input.informationToCollect || []).map(s => s.trim()).filter(Boolean),
      attachments: (input.attachments || []).filter(a => a.url?.trim()),
      internal_notes: input.internalNotes?.trim() || '',
      author: input.author?.trim() || 'Support Team',
    })
    .select('id, playbook_id, title, summary, symptoms, error_message, context, affected_area, information_to_collect, attachments, internal_notes, status, difficulty, estimated_time, author, jira_code, deleted_at, deleted_by, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '42501') {
      throw new Error('Permission denied. Support or Admin role required.');
    }
    throw new Error(`Failed to create Issue: ${error.message}`);
  }

  return mapIssueRowToIssue(data);
}

export async function updateIssue(
  input: UpdateIssueInput,
  client: DbClient = defaultSupabase
): Promise<Issue> {
  const cleanId = input.id?.trim() || '';
  const trimmedTitle = input.title?.trim() || '';
  const trimmedSummary = input.summary?.trim() || '';

  if (!cleanId) {
    throw new Error('Enter an Issue ID.');
  }
  if (!trimmedTitle) {
    throw new Error('Enter an Issue title.');
  }
  if (!trimmedSummary) {
    throw new Error('Provide a problem summary.');
  }

  const trimmedJiraCode = input.jiraCode?.trim() || null;

  const updatePayload: Record<string, unknown> = {
    title: trimmedTitle,
    summary: trimmedSummary,
    jira_code: trimmedJiraCode,
    status: input.status || 'Draft',
    difficulty: input.difficulty || 'Medium',
    estimated_time: input.estimatedTime?.trim() || '',
    symptoms: (input.symptoms || []).map(s => s.trim()).filter(Boolean),
    error_message: input.errorMessage?.trim() || '',
    context: input.context?.trim() || '',
    affected_area: input.affectedArea?.trim() || '',
    information_to_collect: (input.informationToCollect || []).map(s => s.trim()).filter(Boolean),
    attachments: (input.attachments || []).filter(a => a.url?.trim()),
    internal_notes: input.internalNotes?.trim() || '',
    updated_at: new Date().toISOString(),
  };

  if (input.author?.trim()) {
    updatePayload.author = input.author.trim();
  }

  const { data, error } = await client
    .from('issues')
    .update(updatePayload)
    .eq('id', cleanId)
    .is('deleted_at', null)
    .select('id, playbook_id, title, summary, symptoms, error_message, context, affected_area, information_to_collect, attachments, internal_notes, status, difficulty, estimated_time, author, jira_code, deleted_at, deleted_by, created_at, updated_at')
    .maybeSingle();

  if (error) {
    if (error.code === '42501' || error.message?.includes('Permission denied')) {
      throw new Error('Permission denied. Support or Admin role required.');
    }
    throw new Error(`Failed to update Issue: ${error.message}`);
  }

  if (!data) {
    throw new Error('Issue not found or has been deleted.');
  }

  return mapIssueRowToIssue(data);
}

export async function softDeleteIssue(
  id: string,
  client: DbClient = defaultSupabase
): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) {
    throw new Error('Invalid Issue ID.');
  }

  const { error } = await client.rpc('fn_soft_delete_issue', {
    p_issue_id: cleanId,
  });

  if (error) {
    if (error.message.includes('active linked Guide')) {
      throw new Error('Cannot delete Issue with an active linked Guide. Remove or reassign the Guide first.');
    }
    if (error.code === '42501' || error.message.includes('Permission denied')) {
      throw new Error('Permission denied. Support or Admin role required.');
    }
    throw new Error(error.message || 'Could not delete Issue.');
  }
}
