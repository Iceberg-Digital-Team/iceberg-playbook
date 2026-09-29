export interface Playbook {
  id: string;
  slug: string;
  name: string;
  code: string;
  description: string;
  icon: string;
  issueCount: number;
  guideCount: number;
  sopCount: number;
  activeIssuesCount?: number;
  activeGuidesCount?: number;
  activeSopsCount?: number;
  updatedAt: string;
  owner?: string;
  visibility?: 'Internal' | 'Public';
}

export interface Step {
  number: number;
  title: string;
  description: string;
  estimatedTime?: string;
  screenshot?: string;
  importantNote?: string;
  successIndicator?: string;
  videoLink?: string;
  pdfReference?: string;
}

export interface CommonProblem {
  problem: string;
  cause: string;
  solution: string;
  relatedIssue?: string;
}

export interface FAQ {
  question: string;
  answer: string;
}

export interface Revision {
  version: string;
  date: string;
  updatedBy: string;
  changes: string;
}

export interface Attachment {
  name: string;
  url: string;
}

export interface Issue {
  id: string;
  playbookId: string;
  title: string;
  summary: string;
  symptoms: string[];
  errorMessage: string;
  context: string;
  affectedArea: string;
  informationToCollect: string[];
  attachments: Attachment[];
  internalNotes: string;
  status: 'Verified' | 'Draft';
  difficulty: 'Easy' | 'Medium' | 'Advanced';
  estimatedTime: string;
  author: string;
  jiraCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Guide {
  issueId: string;
  video?: string;
  videoStorageKey?: string;
  pdf?: string;
  pdfStorageKey?: string;
  id: string;
  playbookId: string;
  title: string;
  summary: string;
  status: 'Verified' | 'Draft';
  difficulty: 'Easy' | 'Medium' | 'Advanced';
  estimatedTime: string;
  author: string;
  updatedAt: string;
  requirements: string[];
  beforeYouStart: string[];
  importantInformation: string;
  steps: Step[];
  commonProblems: CommonProblem[];
  faq: FAQ[];
  relatedItems: string[];
  internalNotes: string;
  revisionHistory: Revision[];
}

export type GuideContent = Pick<
  Guide,
  | 'title'
  | 'summary'
  | 'status'
  | 'difficulty'
  | 'estimatedTime'
  | 'requirements'
  | 'beforeYouStart'
  | 'importantInformation'
  | 'video'
  | 'videoStorageKey'
  | 'pdf'
  | 'pdfStorageKey'
  | 'steps'
  | 'commonProblems'
  | 'faq'
  | 'relatedItems'
  | 'internalNotes'
>;

export interface GuideIdentity {
  currentVersionId: string;
  versionNumber: number;
  createdAt: string;
  createdBy: string;
  updatedBy: string;
}

export type VersionedGuide = Guide & GuideIdentity;

export interface GuideVersion extends GuideContent {
  id: string;
  guideId: string;
  versionNumber: number;
  changeSummary: string;
  createdAt: string;
  createdBy: string;
  restoredFromVersionId?: string;
}

export const formatGuideVersion = (number: number) => `1.${number - 1}`;

export const formatGuideDate = (date: string) =>
  new Date(date).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(date.includes('T') ? { hour: '2-digit', minute: '2-digit' } : {})
  });

const contentFields = [
  'title',
  'summary',
  'status',
  'difficulty',
  'estimatedTime',
  'requirements',
  'beforeYouStart',
  'importantInformation',
  'video',
  'videoStorageKey',
  'pdf',
  'pdfStorageKey',
  'steps',
  'commonProblems',
  'faq',
  'relatedItems',
  'internalNotes'
] as const;

export function guideContent(guide: GuideContent): GuideContent {
  return JSON.parse(
    JSON.stringify(
      Object.fromEntries(
        contentFields.map(key => [
          key,
          guide[key] ?? (key === 'video' || key === 'pdf' ? '' : guide[key])
        ])
      )
    )
  );
}

export interface SOP {
  id: string;
  playbookId: string;
  title: string;
  owner: string;
  status: 'Verified' | 'Draft';
  estimatedTime: string;
  updatedAt: string;
  purpose: string;
  whenToUse: string;
  requirements: string[];
  responsibleTeam: string;
  checklist: string[];
  steps: Step[];
  escalationRules: string;
  completionCriteria: string;
  relatedIssues: string[];
  relatedGuides: string[];
  internalNotes: string;
  revisionHistory: Revision[];
}
