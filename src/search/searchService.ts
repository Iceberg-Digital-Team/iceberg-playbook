import { getSearchData } from './dataSource';
import { searchKnowledge, type SearchOptions, type ContentItem } from './searchCore';

export function executeSearch(query: string, options: SearchOptions = {}): ContentItem[] {
  const data = getSearchData();
  return searchKnowledge(query, data, options);
}

export const search = executeSearch;
export { searchKnowledge };
export type { SearchOptions, ContentItem };
