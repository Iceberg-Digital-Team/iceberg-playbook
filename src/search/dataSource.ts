import { getPlaybooks, getIssues, getGuides, getSOPs } from '../data';
import type { Playbook, Issue, VersionedGuide, SOP } from '../data';

export interface RawSearchData {
  issues: Issue[];
  guides: VersionedGuide[];
  sops: SOP[];
  playbooks: Playbook[];
}

export function getSearchData(): RawSearchData {
  return {
    issues: getIssues(),
    guides: getGuides(),
    sops: getSOPs(),
    playbooks: getPlaybooks(),
  };
}
