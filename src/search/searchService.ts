import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '../lib/supabase';
import { getIssues, type Issue } from '../data';
import { getSearchData, type RawSearchData } from './dataSource';
import { searchKnowledge, matchTroubleshootingIssue, type SearchOptions, type ContentItem } from './searchCore';

export function executeSearch(
  query: string,
  data: RawSearchData,
  options: SearchOptions = {}
): ContentItem[] {
  return searchKnowledge(query, data, { includePlaybooks: true, ...options });
}

export async function search(
  query: string,
  options: SearchOptions = {},
  client: SupabaseClient = defaultSupabase
): Promise<ContentItem[]> {
  const data = await getSearchData(client);
  return executeSearch(query, data, options);
}

export function resolveTroubleshooting(
  playbookId: string | null,
  category: string | null,
  symptom: string | null
): Issue | null {
  if (!playbookId || !category || !symptom) {
    return null;
  }
  const issues = getIssues();
  return matchTroubleshootingIssue(playbookId, category, symptom, issues);
}

export { getSearchData };
export type { SearchOptions, ContentItem, RawSearchData };
