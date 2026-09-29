import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '../lib/supabase';
import { listPlaybooks } from './playbookService';
import { listIssues } from './issueService';
import { listGuides } from './guideService';
import { listSops } from './sopService';

export interface RecentSolutionItem {
  id: string;
  title: string;
  type: 'Issue' | 'Guide' | 'SOP';
  folder: 'issues' | 'guides' | 'sops';
  playbookId: string;
  playbookSlug: string;
  href: string;
  updatedAt: string;
}

export async function listRecentSolutions(
  client: SupabaseClient = defaultSupabase,
  limit: number = 4
): Promise<RecentSolutionItem[]> {
  const [playbooks, issues, guides, sops] = await Promise.all([
    listPlaybooks(client),
    listIssues(client),
    listGuides(client),
    listSops(client)
  ]);

  const playbookMap = new Map(playbooks.map(pb => [pb.id, pb]));

  const allItems: RecentSolutionItem[] = [
    ...issues.map(item => {
      const pb = playbookMap.get(item.playbookId);
      const slug = pb?.slug || item.playbookId;
      return {
        id: item.id,
        title: item.title,
        type: 'Issue' as const,
        folder: 'issues' as const,
        playbookId: item.playbookId,
        playbookSlug: slug,
        href: `#/playbooks/${slug}/issues/${encodeURIComponent(item.id)}`,
        updatedAt: item.updatedAt
      };
    }),
    ...guides.map(item => {
      const pb = playbookMap.get(item.playbookId);
      const slug = pb?.slug || item.playbookId;
      return {
        id: item.id,
        title: item.title,
        type: 'Guide' as const,
        folder: 'guides' as const,
        playbookId: item.playbookId,
        playbookSlug: slug,
        href: `#/playbooks/${slug}/guides/${encodeURIComponent(item.id)}`,
        updatedAt: item.updatedAt
      };
    }),
    ...sops.map(item => {
      const pb = playbookMap.get(item.playbookId);
      const slug = pb?.slug || item.playbookId;
      return {
        id: item.id,
        title: item.title,
        type: 'SOP' as const,
        folder: 'sops' as const,
        playbookId: item.playbookId,
        playbookSlug: slug,
        href: `#/playbooks/${slug}/sops/${encodeURIComponent(item.id)}`,
        updatedAt: item.updatedAt
      };
    })
  ];

  return allItems
    .filter(item => playbookMap.has(item.playbookId))
    .sort((a, b) => {
      const diff = (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}
