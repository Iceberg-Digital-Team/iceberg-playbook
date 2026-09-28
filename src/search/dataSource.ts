import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '../lib/supabase';
import type { Playbook, Issue, VersionedGuide, SOP } from '../data';
import { listPlaybooks } from '../services/playbookService';
import { listIssues } from '../services/issueService';
import { listGuides } from '../services/guideService';
import { listSops } from '../services/sopService';

export interface RawSearchData {
  issues: Issue[];
  guides: VersionedGuide[];
  sops: SOP[];
  playbooks: Playbook[];
}

export async function getSearchData(
  client: SupabaseClient = defaultSupabase
): Promise<RawSearchData> {
  const [playbooks, issues, guides, sops] = await Promise.all([
    listPlaybooks(client),
    listIssues(client),
    listGuides(client),
    listSops(client),
  ]);

  return {
    playbooks,
    issues,
    guides,
    sops,
  };
}
