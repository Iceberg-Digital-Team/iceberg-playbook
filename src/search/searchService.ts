import { getSearchData } from './dataSource';
import { searchKnowledge, type SearchOptions, type ContentItem } from './searchCore';

export function executeSearch(query: string, options: SearchOptions = {}): ContentItem[] {
  const data = getSearchData();
  return searchKnowledge(query, data, options);
}

export type { SearchOptions, ContentItem };
