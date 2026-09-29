import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '../lib/supabase';
import { getSearchData, type RawSearchData } from './dataSource';
import { searchKnowledge, type SearchOptions, type ContentItem } from './searchCore';

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

export { getSearchData };
export type { SearchOptions, ContentItem, RawSearchData };
