import type { Issue } from '../data';
import { getSearchData } from './dataSource';
import { searchKnowledge, matchTroubleshootingIssue, type SearchOptions, type ContentItem } from './searchCore';

export function executeSearch(query: string, options: SearchOptions = {}): ContentItem[] {
  const data = getSearchData();
  return searchKnowledge(query, data, options);
}

export function resolveTroubleshooting(
  playbookId: string | null,
  category: string | null,
  symptom: string | null
): Issue | null {
  if (!playbookId || !category || !symptom) {
    return null;
  }
  const { issues } = getSearchData();
  return matchTroubleshootingIssue(playbookId, category, symptom, issues);
}

export type { SearchOptions, ContentItem };
