import type { Playbook, Issue, Guide, VersionedGuide, SOP } from '../data';

export type ContentItem = Issue | VersionedGuide | SOP;

export interface SearchData<G extends Guide = VersionedGuide> {
  issues: Issue[];
  guides: G[];
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

export function getItemType(item: Issue | Guide | SOP): 'Issues' | 'Guides' | 'SOPs' {
  if ('issueId' in item) return 'Guides';
  if ('owner' in item) return 'SOPs';
  return 'Issues';
}

const PUNCTUATION = '()[]{}*\\/.,:;!?"\'`~^+=|<>@#$%&';

export function tokenize(query: string): string[] {
  if (!query) return [];
  const normalized = query.toLowerCase().trim();
  if (!normalized) return [];

  // Split on whitespace characters
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

export function searchKnowledge<G extends Guide = VersionedGuide>(
  query: string,
  dataOrIssues: SearchData<G> | Issue[],
  optionsOrGuides?: SearchOptions | G[],
  maybeSops?: SOP[],
  maybePlaybooks?: Playbook[],
  maybeOptions?: SearchOptions
): (Issue | G | SOP)[] {
  type ItemType = Issue | G | SOP;
  let issues: Issue[] = [];
  let guides: G[] = [];
  let sops: SOP[] = [];
  let playbooks: Playbook[] = [];
  let options: SearchOptions = {};

  if (Array.isArray(dataOrIssues)) {
    issues = dataOrIssues;
    guides = Array.isArray(optionsOrGuides) ? (optionsOrGuides as G[]) : [];
    sops = maybeSops ?? [];
    playbooks = maybePlaybooks ?? [];
    options = maybeOptions ?? {};
  } else if (dataOrIssues && typeof dataOrIssues === 'object') {
    issues = dataOrIssues.issues ?? [];
    guides = dataOrIssues.guides ?? [];
    sops = dataOrIssues.sops ?? [];
    playbooks = dataOrIssues.playbooks ?? [];
    const mergedOpts = dataOrIssues as unknown as SearchOptions;
    options = {
      type: (optionsOrGuides as SearchOptions)?.type ?? mergedOpts.type,
      playbookId: (optionsOrGuides as SearchOptions)?.playbookId ?? mergedOpts.playbookId,
    };
  }

  const validPlaybookIds = new Set(playbooks.map(p => p.id));
  const playbookMap = new Map(playbooks.map(p => [p.id, p]));
  const issueMap = new Map(issues.map(i => [i.id, i]));

  const rawList: ItemType[] = [...issues, ...guides, ...sops];

  // 1. Filter out orphans (items whose playbookId does not exist in playbooks)
  // and apply type / playbookId filters
  const filterType = options.type ?? 'All';
  const filterPlaybookId = options.playbookId ?? 'All';

  const candidates: { item: ItemType; originalIndex: number }[] = [];
  let currentIndex = 0;

  for (const item of rawList) {
    const idx = currentIndex++;
    if (!validPlaybookIds.has(item.playbookId)) {
      continue;
    }
    if (filterType !== 'All' && getItemType(item) !== filterType) {
      continue;
    }
    if (filterPlaybookId !== 'All' && item.playbookId !== filterPlaybookId) {
      continue;
    }
    candidates.push({ item, originalIndex: idx });
  }

  const tokens = tokenize(query);
  const normalizedQuery = (query ?? '').toLowerCase().trim();

  // If query yields no tokens (empty, whitespace-only, or punctuation-only),
  // return all filtered items in their original order
  if (tokens.length === 0) {
    return candidates.map(c => c.item);
  }

  const scoredResults: { item: ItemType; score: number; originalIndex: number }[] = [];

  for (const { item, originalIndex } of candidates) {
    const idLower = item.id.toLowerCase();
    const titleLower = item.title.toLowerCase();

    // Field Tier 3: symptomsOrError (Issue only)
    let symptomsOrError = '';
    if ('symptoms' in item || 'errorMessage' in item) {
      const issue = item as Issue;
      const symptoms = (issue.symptoms ?? []).join(' ').toLowerCase();
      const err = (issue.errorMessage ?? '').toLowerCase();
      symptomsOrError = `${symptoms} ${err}`;
    }

    // Field Tier 4: summaryOrPurpose (Issue/Guide: summary, SOP: purpose)
    let summaryOrPurpose = '';
    if ('summary' in item && typeof item.summary === 'string') {
      summaryOrPurpose = item.summary.toLowerCase();
    } else if ('purpose' in item && typeof item.purpose === 'string') {
      summaryOrPurpose = item.purpose.toLowerCase();
    }

    // Field Tier 5: contentOrPlaybook
    const contentParts: string[] = [];
    const pb = playbookMap.get(item.playbookId);
    if (pb?.name) {
      contentParts.push(pb.name.toLowerCase());
    }

    if ('issueId' in item) {
      const guide = item as Guide;
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

    // Check AND logic: every token must match at least one field
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

    // Compute score
    let score = 0;

    // Exact code match check prior to tokenization scoring
    if (idLower === normalizedQuery) {
      score += SEARCH_WEIGHTS.exactCode;
    }

    // Per-token field scoring: choose the highest tier matched for each token
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

  // Stable sort: higher score first, tie broken by initial candidate order
  scoredResults.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.originalIndex - b.originalIndex;
  });

  return scoredResults.map(r => r.item);
}

export const search = searchKnowledge;
