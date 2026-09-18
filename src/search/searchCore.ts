import type { Playbook, Issue, VersionedGuide, SOP } from '../data';

export type ContentItem = Issue | VersionedGuide | SOP;

export interface SearchData {
  issues: Issue[];
  guides: VersionedGuide[];
  sops: SOP[];
  playbooks: Playbook[];
}

export interface SearchOptions {
  type?: string;
  playbookId?: string;
}

export const SEARCH_WEIGHTS = {
  exactCode: 100,
  title: 30,
  symptomsOrError: 20,
  summaryOrPurpose: 10,
  contentOrPlaybook: 5,
} as const;

export function getItemType(item: ContentItem): 'Issues' | 'Guides' | 'SOPs' {
  if ('issueId' in item) return 'Guides';
  if ('owner' in item) return 'SOPs';
  return 'Issues';
}

const PUNCTUATION = '()[]{}*\\/.,:;!?"\'`~^+=|<>@#$%&';

export function tokenize(query: string): string[] {
  if (!query) return [];
  const normalized = query.toLowerCase().trim();
  if (!normalized) return [];

  const rawParts = normalized.split(/\s+/);
  const tokens: string[] = [];

  for (const part of rawParts) {
    let start = 0;
    let end = part.length;

    while (start < end && PUNCTUATION.includes(part[start])) {
      start++;
    }
    while (end > start && PUNCTUATION.includes(part[end - 1])) {
      end--;
    }

    const cleaned = part.slice(start, end);
    if (cleaned.length > 0) {
      tokens.push(cleaned);
    }
  }

  return tokens;
}

export function searchKnowledge(
  query: string,
  data: SearchData,
  options: SearchOptions = {}
): ContentItem[] {
  const issues = data.issues ?? [];
  const guides = data.guides ?? [];
  const sops = data.sops ?? [];
  const playbooks = data.playbooks ?? [];

  const validPlaybookIds = new Set(playbooks.map(p => p.id));
  const playbookMap = new Map(playbooks.map(p => [p.id, p]));
  const issueMap = new Map(issues.map(i => [i.id, i]));

  const rawList: ContentItem[] = [...issues, ...guides, ...sops];

  const filterType = options.type ?? 'All';
  const filterPlaybookId = options.playbookId ?? 'All';

  const candidates: { item: ContentItem; originalIndex: number }[] = [];

  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!validPlaybookIds.has(item.playbookId)) {
      continue;
    }
    if (filterType !== 'All' && getItemType(item) !== filterType) {
      continue;
    }
    if (filterPlaybookId !== 'All' && item.playbookId !== filterPlaybookId) {
      continue;
    }
    candidates.push({ item, originalIndex: i });
  }

  const tokens = tokenize(query);

  if (tokens.length === 0) {
    return candidates.map(c => c.item);
  }

  const scoredResults: { item: ContentItem; score: number; originalIndex: number }[] = [];

  for (const { item, originalIndex } of candidates) {
    const idLower = item.id.toLowerCase();
    const titleLower = item.title.toLowerCase();

    let symptomsOrError = '';
    if ('symptoms' in item || 'errorMessage' in item) {
      const issue = item as Issue;
      const symptoms = (issue.symptoms ?? []).join(' ').toLowerCase();
      const err = (issue.errorMessage ?? '').toLowerCase();
      symptomsOrError = `${symptoms} ${err}`;
    }

    let summaryOrPurpose = '';
    if ('summary' in item && typeof item.summary === 'string') {
      summaryOrPurpose = item.summary.toLowerCase();
    } else if ('purpose' in item && typeof item.purpose === 'string') {
      summaryOrPurpose = item.purpose.toLowerCase();
    }

    const contentParts: string[] = [];
    const pb = playbookMap.get(item.playbookId);
    if (pb?.name) {
      contentParts.push(pb.name.toLowerCase());
    }

    if ('issueId' in item) {
      const guide = item as VersionedGuide;
      const linked = issueMap.get(guide.issueId);
      if (linked) {
        contentParts.push(linked.id.toLowerCase());
        contentParts.push(linked.title.toLowerCase());
      }
      if (guide.steps) {
        for (const s of guide.steps) {
          if (s.title) contentParts.push(s.title.toLowerCase());
          if (s.description) contentParts.push(s.description.toLowerCase());
        }
      }
      if (guide.commonProblems) {
        for (const cp of guide.commonProblems) {
          if (cp.problem) contentParts.push(cp.problem.toLowerCase());
          if (cp.cause) contentParts.push(cp.cause.toLowerCase());
          if (cp.solution) contentParts.push(cp.solution.toLowerCase());
        }
      }
    }

    const contentOrPlaybook = contentParts.join(' ');

    let matchesAllTokens = true;
    for (const t of tokens) {
      const matched =
        idLower.includes(t) ||
        titleLower.includes(t) ||
        symptomsOrError.includes(t) ||
        summaryOrPurpose.includes(t) ||
        contentOrPlaybook.includes(t);

      if (!matched) {
        matchesAllTokens = false;
        break;
      }
    }

    if (!matchesAllTokens) {
      continue;
    }

    let score = 0;

    if (tokens.length === 1 && tokens[0] === idLower) {
      score += SEARCH_WEIGHTS.exactCode;
    }

    for (const t of tokens) {
      let tokenWeight = 0;
      if (titleLower.includes(t) || idLower.includes(t)) {
        tokenWeight = Math.max(tokenWeight, SEARCH_WEIGHTS.title);
      }
      if (symptomsOrError.includes(t)) {
        tokenWeight = Math.max(tokenWeight, SEARCH_WEIGHTS.symptomsOrError);
      }
      if (summaryOrPurpose.includes(t)) {
        tokenWeight = Math.max(tokenWeight, SEARCH_WEIGHTS.summaryOrPurpose);
      }
      if (contentOrPlaybook.includes(t)) {
        tokenWeight = Math.max(tokenWeight, SEARCH_WEIGHTS.contentOrPlaybook);
      }
      score += tokenWeight;
    }

    scoredResults.push({ item, score, originalIndex });
  }

  scoredResults.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.originalIndex - b.originalIndex;
  });

  return scoredResults.map(r => r.item);
}

export const TROUBLESHOOTING_STOPWORDS = new Set([
  'and', 'are', 'for', 'from', 'has', 'its', 'that',
  'the', 'was', 'were', 'will', 'with', 'other', 'issue', 'problem'
]);

export function matchTroubleshootingIssue(
  playbookId: string,
  category: string,
  symptom: string,
  issues: Issue[]
): Issue | null {
  if (!playbookId || !category || !symptom) {
    return null;
  }

  const rawSymptom = symptom.trim();
  if (rawSymptom.toLowerCase() === 'other') {
    return null;
  }

  const playbookIssues = (issues ?? []).filter(i => i.playbookId === playbookId);
  if (playbookIssues.length === 0) {
    return null;
  }

  let manualTargetId: string | null = null;
  if (playbookId === 'whatsapp' && category === 'Phone Number') {
    if (rawSymptom === 'Number already registered') {
      manualTargetId = 'WA-001';
    } else if (rawSymptom === 'OTP not received') {
      manualTargetId = 'WA-002';
    }
  } else if (playbookId === 'whatsapp' && category === 'Embedded Signup') {
    if (rawSymptom === 'Popup closes abruptly' || rawSymptom === 'Blank window displays') {
      manualTargetId = 'WA-003';
    }
  } else if (playbookId === 'meta-business' && category === 'Business Verification') {
    if (rawSymptom === 'Document rejected') {
      manualTargetId = 'META-006';
    }
  } else if (playbookId === 'zoom' && category === 'Meetings') {
    manualTargetId = 'ZOOM-002';
  }

  if (manualTargetId) {
    const manualIssue = playbookIssues.find(i => i.id === manualTargetId);
    if (manualIssue) {
      return manualIssue;
    }
  }

  const rawTokens = tokenize(rawSymptom);
  const meaningfulTokens = rawTokens.filter(
    t => t.length > 2 && !TROUBLESHOOTING_STOPWORDS.has(t)
  );

  if (meaningfulTokens.length === 0) {
    return null;
  }

  const matchingCandidates: { item: Issue; score: number; originalIndex: number }[] = [];

  for (let idx = 0; idx < playbookIssues.length; idx++) {
    const item = playbookIssues[idx];
    const titleLower = item.title.toLowerCase();
    const symptomsLower = (item.symptoms ?? []).join(' ').toLowerCase();
    const errorLower = (item.errorMessage ?? '').toLowerCase();

    let matchesAll = true;
    for (const token of meaningfulTokens) {
      const inTitle = titleLower.includes(token);
      const inSymptomsOrError = symptomsLower.includes(token) || errorLower.includes(token);
      if (!inTitle && !inSymptomsOrError) {
        matchesAll = false;
        break;
      }
    }

    if (!matchesAll) {
      continue;
    }

    let score = 0;
    for (const token of meaningfulTokens) {
      let tokenWeight = 0;
      if (titleLower.includes(token)) {
        tokenWeight = Math.max(tokenWeight, SEARCH_WEIGHTS.title);
      }
      if (symptomsLower.includes(token) || errorLower.includes(token)) {
        tokenWeight = Math.max(tokenWeight, SEARCH_WEIGHTS.symptomsOrError);
      }
      score += tokenWeight;
    }

    matchingCandidates.push({ item, score, originalIndex: idx });
  }

  if (matchingCandidates.length === 0) {
    return null;
  }

  matchingCandidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.originalIndex - b.originalIndex;
  });

  return matchingCandidates[0].item;
}
