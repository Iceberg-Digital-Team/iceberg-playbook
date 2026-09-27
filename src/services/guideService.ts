import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '../lib/supabase';
import type { VersionedGuide, Step, CommonProblem, FAQ, Revision } from '../data';

export interface DatabaseGuideRow {
  id: string;
  issue_id: string;
  playbook_id: string;
  current_version_id: string | null;
  version_number: number;
  title: string;
  summary: string;
  status: 'Verified' | 'Draft';
  difficulty: 'Easy' | 'Medium' | 'Advanced';
  estimated_time: string;
  before_you_start: string[] | null;
  requirements: string[] | null;
  important_information: string | null;
  video: string | null;
  video_storage_key: string | null;
  pdf: string | null;
  pdf_storage_key: string | null;
  steps: Step[] | null;
  common_problems: CommonProblem[] | null;
  faq: FAQ[] | null;
  related_items: string[] | null;
  internal_notes: string | null;
  revision_history: Revision[] | null;
  author: string;
  created_by: string;
  updated_by: string;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateGuideInput {
  issueId: string;
  playbookId: string;
  title: string;
  summary: string;
  status?: 'Verified' | 'Draft';
  difficulty?: 'Easy' | 'Medium' | 'Advanced';
  estimatedTime?: string;
  beforeYouStart?: string[];
  requirements?: string[];
  importantInformation?: string;
  video?: string;
  videoStorageKey?: string;
  pdf?: string;
  pdfStorageKey?: string;
  steps: Array<Omit<Step, 'number'>> | Step[];
  commonProblems?: CommonProblem[];
  faq?: FAQ[];
  relatedItems?: string[];
  internalNotes?: string;
}

export function mapGuideRowToGuide(row: DatabaseGuideRow): VersionedGuide {
  return {
    id: row.id,
    issueId: row.issue_id,
    playbookId: row.playbook_id,
    currentVersionId: row.current_version_id || `${row.id}:v1`,
    versionNumber: row.version_number ?? 1,
    title: row.title,
    summary: row.summary,
    status: row.status || 'Draft',
    difficulty: row.difficulty || 'Medium',
    estimatedTime: row.estimated_time || '15 min',
    beforeYouStart: Array.isArray(row.before_you_start) ? row.before_you_start : [],
    requirements: Array.isArray(row.requirements) ? row.requirements : [],
    importantInformation: row.important_information || '',
    video: row.video || '',
    pdf: row.pdf || '',
    steps: Array.isArray(row.steps) ? row.steps : [],
    commonProblems: Array.isArray(row.common_problems) ? row.common_problems : [],
    faq: Array.isArray(row.faq) ? row.faq : [],
    relatedItems: Array.isArray(row.related_items) ? row.related_items : [],
    internalNotes: row.internal_notes || '',
    revisionHistory: Array.isArray(row.revision_history) ? row.revision_history : [],
    author: row.author || 'Support Team',
    createdBy: row.created_by || row.author || 'Support Team',
    updatedBy: row.updated_by || row.author || 'Support Team',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listGuides(
  client: SupabaseClient = defaultSupabase
): Promise<VersionedGuide[]> {
  const { data, error } = await client
    .from('guides')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    if (error.code === '42501') {
      throw new Error('Permission denied. Please verify your account role.');
    }
    throw new Error(`Failed to load Guides: ${error.message}`);
  }

  return (data || []).map(mapGuideRowToGuide);
}

export async function listGuidesByPlaybook(
  playbookId: string,
  client: SupabaseClient = defaultSupabase
): Promise<VersionedGuide[]> {
  const cleanId = playbookId.trim();
  if (!cleanId) {
    return [];
  }

  const { data, error } = await client
    .from('guides')
    .select('*')
    .eq('playbook_id', cleanId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    if (error.code === '42501') {
      throw new Error('Permission denied. Please verify your account role.');
    }
    throw new Error(`Failed to load Guides for Playbook: ${error.message}`);
  }

  return (data || []).map(mapGuideRowToGuide);
}

export async function getGuideById(
  id: string,
  client: SupabaseClient = defaultSupabase
): Promise<VersionedGuide | null> {
  const cleanId = id.trim();
  if (!cleanId) {
    return null;
  }

  const { data, error } = await client
    .from('guides')
    .select('*')
    .eq('id', cleanId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    if (error.code === '42501') {
      throw new Error('Permission denied. Please verify your account role.');
    }
    throw new Error(`Failed to load Guide: ${error.message}`);
  }

  return data ? mapGuideRowToGuide(data) : null;
}

export async function getPrimaryGuideByIssue(
  issueId: string,
  client: SupabaseClient = defaultSupabase
): Promise<VersionedGuide | null> {
  const cleanId = issueId.trim();
  if (!cleanId) {
    return null;
  }

  const { data, error } = await client
    .from('guides')
    .select('*')
    .eq('issue_id', cleanId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    if (error.code === '42501') {
      throw new Error('Permission denied. Please verify your account role.');
    }
    throw new Error(`Failed to load Guide for Issue: ${error.message}`);
  }

  return data ? mapGuideRowToGuide(data) : null;
}

export async function createGuide(
  input: CreateGuideInput,
  client: SupabaseClient = defaultSupabase
): Promise<VersionedGuide> {
  const issueId = input.issueId?.trim();
  const playbookId = input.playbookId?.trim();
  const title = input.title?.trim();
  const summary = input.summary?.trim();

  if (!issueId) {
    throw new Error('Select an existing Related Issue.');
  }

  if (!playbookId) {
    throw new Error('The Guide must use its Issue’s Playbook.');
  }

  if (!title || !summary || !input.steps?.length) {
    throw new Error('Add a Guide title, summary, and complete solution steps.');
  }

  for (const step of input.steps) {
    if (!step.title?.trim() || !step.description?.trim()) {
      throw new Error('Add a Guide title, summary, and complete solution steps.');
    }
  }

  const contentPayload = {
    title,
    summary,
    status: input.status || 'Draft',
    difficulty: input.difficulty || 'Medium',
    estimatedTime: input.estimatedTime?.trim() || '15 min',
    beforeYouStart: input.beforeYouStart?.map(s => s.trim()).filter(Boolean) || [],
    requirements: input.requirements || [],
    importantInformation: input.importantInformation?.trim() || '',
    video: input.video?.trim() || '',
    videoStorageKey: input.videoStorageKey?.trim() || null,
    pdf: input.pdf?.trim() || '',
    pdfStorageKey: input.pdfStorageKey?.trim() || null,
    steps: input.steps.map((s, i) => ({
      number: i + 1,
      title: s.title.trim(),
      description: s.description.trim(),
      screenshot: 'screenshot' in s ? s.screenshot : undefined
    })),
    commonProblems: (input.commonProblems || [])
      .filter(p => p.problem.trim())
      .map(p => ({
        problem: p.problem.trim(),
        cause: p.cause.trim(),
        solution: p.solution.trim()
      })),
    faq: input.faq || [],
    relatedItems: input.relatedItems || [],
    internalNotes: input.internalNotes?.trim() || '',
    revisionHistory: []
  };

  const { data, error } = await client.rpc('fn_create_guide', {
    p_issue_id: issueId,
    p_playbook_id: playbookId,
    p_content: contentPayload
  });

  if (error) {
    if (error.code === '42501' || error.message?.includes('Permission denied')) {
      throw new Error('Permission denied. Support or Admin role required.');
    }
    if (error.message?.includes('already has a primary Guide')) {
      throw new Error('This Issue already has a primary Guide. Open the existing Guide.');
    }
    if (error.message?.includes('Select an existing Related Issue')) {
      throw new Error('Select an existing Related Issue.');
    }
    if (error.message?.includes('The Guide must use its Issue’s Playbook')) {
      throw new Error('The Guide must use its Issue’s Playbook.');
    }
    if (error.message?.includes('complete solution steps')) {
      throw new Error('Add a Guide title, summary, and complete solution steps.');
    }
    throw new Error(error.message || 'Failed to create Guide.');
  }

  if (!data) {
    throw new Error('Failed to create Guide: No data returned from database.');
  }

  return mapGuideRowToGuide(data as DatabaseGuideRow);
}
