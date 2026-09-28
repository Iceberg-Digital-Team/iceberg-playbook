import { sampleGuides, sampleGuideVersions, sampleIssues, samplePlaybooks, sampleSOPs } from './sampleData';

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

export interface Attachment { name: string; url: string; }
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
  createdAt: string;
  updatedAt: string;
}

interface LegacyIssue {
  id: string; // e.g. "WA-001"
  playbookId: string; // e.g. "whatsapp"
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
  relatedItems: string[]; // List of related issue/guide codes, e.g. ["WA-003", "META-006"]
  internalNotes: string;
  revisionHistory: Revision[];
}

export interface Guide {
  issueId: string;
  video?: string;
  videoStorageKey?: string;
  pdf?: string;
  pdfStorageKey?: string;
  id: string; // e.g. "WA-G01" or similar
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

export type GuideContent = Pick<Guide, 'title' | 'summary' | 'status' | 'difficulty' | 'estimatedTime' | 'requirements' | 'beforeYouStart' | 'importantInformation' | 'video' | 'videoStorageKey' | 'pdf' | 'pdfStorageKey' | 'steps' | 'commonProblems' | 'faq' | 'relatedItems' | 'internalNotes'>;
export interface GuideIdentity {
  currentVersionId: string;
  versionNumber: number;
  createdAt: string;
  createdBy: string;
  updatedBy: string;
}
// Guide remains the stable identity/current-content projection used by lists.
// Immutable snapshots are separate records and never appear in normal search.
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
export const formatGuideDate = (date: string) => new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...(date.includes('T') ? { hour: '2-digit', minute: '2-digit' } : {}) });
const contentFields = ['title', 'summary', 'status', 'difficulty', 'estimatedTime', 'requirements', 'beforeYouStart', 'importantInformation', 'video', 'videoStorageKey', 'pdf', 'pdfStorageKey', 'steps', 'commonProblems', 'faq', 'relatedItems', 'internalNotes'] as const;
export function guideContent(guide: GuideContent): GuideContent {
  return JSON.parse(JSON.stringify(Object.fromEntries(contentFields.map(key => [key, guide[key] ?? (key === 'video' || key === 'pdf' ? '' : guide[key])]))));
}
function initialVersion(guide: Guide, imported = false): GuideVersion {
  return { ...guideContent(guide), id: `${guide.id}:v1`, guideId: guide.id, versionNumber: 1,
    changeSummary: imported ? 'Existing Guide captured as initial version.' : 'Initial Guide created.', createdAt: guide.updatedAt, createdBy: guide.author };
}
function initialIdentity(guide: Guide): VersionedGuide {
  return { ...guide, currentVersionId: `${guide.id}:v1`, versionNumber: 1, createdAt: guide.updatedAt, createdBy: guide.author, updatedBy: guide.author };
}

export interface SOP {
  id: string; // e.g. "WA-SOP01"
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

export class StorageCorruptedError extends Error {
  key: string;
  constructor(key: string, message?: string) {
    super(message || `Storage corrupted for key: ${key}`);
    this.name = 'StorageCorruptedError';
    this.key = key;
  }
}

// Load from local storage or set default
export const loadData = <T>(key: string, defaults: T[]): T[] => {
  const fullKey = `ib_playbook_${key}`;
  let data: string | null;
  try {
    data = localStorage.getItem(fullKey);
  } catch {
    throw new StorageCorruptedError(fullKey, 'Storage is inaccessible.');
  }
  if (data === null) {
    // Callers mutate the returned list, so never hand out the shared defaults.
    return structuredClone(defaults);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new StorageCorruptedError(fullKey, `Failed to parse ${fullKey} as JSON.`);
  }
  if (!Array.isArray(parsed)) {
    throw new StorageCorruptedError(fullKey, `Expected an array in ${fullKey}.`);
  }
  return parsed as T[];
};

export const saveData = <T>(key: string, data: T[]) => {
  try {
    localStorage.setItem(`ib_playbook_${key}`, JSON.stringify(data));
  } catch {
    throw new Error('Could not save. Browser storage may be full or unavailable. Your changes have been kept open.');
  }
};

export function formatStorageError(error: unknown, fallbackMessage = 'Could not save changes.'): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return fallbackMessage;
}

export interface StorageKeyStatus {
  key: string;
  corrupted: boolean;
  backupKey?: string;
  backupFailed?: boolean;
  error?: string;
}

export interface StorageIntegrityResult {
  status: 'healthy' | 'corrupted' | 'unavailable';
  affectedKeys: string[];
  details: Record<string, StorageKeyStatus>;
  canReset: boolean;
  manifestError?: string;
}

const BACKUP_MANIFEST_KEY = 'ib_playbook_corrupt_manifest';
let backupCounter = 0;

function cleanStorageKey(key: string): string {
  return key.replace(/^ib_playbook_/, '');
}

function getNextBackupKey(cleanKey: string): string {
  const ts = Date.now();
  let candidate = `ib_playbook_corrupt_backup_${cleanKey}_${ts}_${++backupCounter}`;
  while (localStorage.getItem(candidate) !== null) {
    candidate = `ib_playbook_corrupt_backup_${cleanKey}_${ts}_${++backupCounter}`;
  }
  return candidate;
}

interface BackupManifestRecord {
  backupKey: string;
}

function getBackupManifest(): { manifest: Record<string, BackupManifestRecord>; error?: string } {
  try {
    const raw = localStorage.getItem(BACKUP_MANIFEST_KEY);
    if (!raw) return { manifest: {} };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { manifest: parsed as Record<string, BackupManifestRecord> };
    }
    return { manifest: {}, error: 'Corrupt manifest format' };
  } catch (e) {
    return { manifest: {}, error: e instanceof Error ? e.message : 'Corrupt manifest' };
  }
}

function saveBackupManifest(manifest: Record<string, BackupManifestRecord>): string | undefined {
  try {
    localStorage.setItem(BACKUP_MANIFEST_KEY, JSON.stringify(manifest));
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : 'Failed to save backup manifest';
  }
}

// One atomic, versioned envelope keeps Issue/Guide relationships consistent.
// Legacy storage keys are retained as the original backup; SOP storage is unchanged.
interface LegacyKnowledge { version: 2; issues: Issue[]; guides: Guide[]; }
interface Knowledge { version: 3; issues: Issue[]; guides: VersionedGuide[]; guideVersions: GuideVersion[]; }
const knowledgeKey = 'ib_playbook_knowledge_v3';
const legacyKnowledgeKey = 'ib_playbook_knowledge_v2';
// Pre-v2 storage kept Issues and Guides in separate lists.
const legacyIssuesKey = 'ib_playbook_issues';
const legacyGuidesKey = 'ib_playbook_guides';
const playbooksKey = 'ib_playbook_playbooks';
const sopsKey = 'ib_playbook_sops';
// Present once this browser no longer treats a missing Playbook or SOP list as "show the samples".
const explicitDefaultsKey = 'ib_playbook_explicit_defaults';

function writeStorageKey(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    throw new Error('Could not save. Browser storage may be full or unavailable.');
  }
}

// Sample content used to be the implicit value of a missing Playbook or SOP list. An install
// that already holds Knowledge gets those samples written once, so nothing it showed disappears.
// A new, empty install writes nothing until its first save, which records the marker first so
// its own missing lists are never mistaken for an old install later.
function settleImplicitDefaults(beforeWrite: boolean) {
  if (hasStoredKey(explicitDefaultsKey)) return;
  const existingInstall = [knowledgeKey, legacyKnowledgeKey, legacyIssuesKey, legacyGuidesKey].some(hasStoredKey);
  if (!existingInstall && !beforeWrite) return;
  if (existingInstall) {
    if (!hasStoredKey(playbooksKey)) writeStorageKey(playbooksKey, JSON.stringify(samplePlaybooks));
    if (!hasStoredKey(sopsKey)) writeStorageKey(sopsKey, JSON.stringify(sampleSOPs));
  }
  writeStorageKey(explicitDefaultsKey, 'true');
}

export const getPlaybooks = (): Playbook[] => {
  const knowledge = readKnowledge();
  const sops = getSOPs();
  settleImplicitDefaults(false);
  return loadData<Playbook>('playbooks', []).map(p => ({ ...p,
    issueCount: knowledge.issues.filter(i => i.playbookId === p.id).length,
    guideCount: knowledge.guides.filter(g => g.playbookId === p.id).length,
    sopCount: sops.filter(s => s.playbookId === p.id).length,
  }));
};
export const getSOPs = (): SOP[] => {
  settleImplicitDefaults(false);
  return loadData<SOP>('sops', []);
};
export const savePlaybooks = (data: Playbook[]) => {
  settleImplicitDefaults(true);
  saveData('playbooks', data);
};
export const saveSOPs = (data: SOP[]) => {
  settleImplicitDefaults(true);
  saveData('sops', data);
};

export function hasAnyContent(): boolean {
  const knowledge = readKnowledge();
  return knowledge.issues.length > 0 || knowledge.guides.length > 0 || knowledge.guideVersions.length > 0
    || getSOPs().length > 0 || getPlaybooks().length > 0;
}

// Sample data is only ever written into an empty workspace, and all-or-nothing.
export function loadSampleData(): void {
  if (hasAnyContent()) throw new Error('Sample data can only be loaded when there is no content.');
  const sample: Knowledge = structuredClone({ version: 3, issues: sampleIssues, guides: sampleGuides, guideVersions: sampleGuideVersions });
  validateKnowledge(sample);
  const writes: [string, string][] = [
    [explicitDefaultsKey, 'true'],
    [knowledgeKey, JSON.stringify(sample)],
    [playbooksKey, JSON.stringify(samplePlaybooks)],
    [sopsKey, JSON.stringify(sampleSOPs)],
  ];
  const previous = writes.map(([key]) => [key, localStorage.getItem(key)] as const);
  let written = 0;
  try {
    for (const [key, value] of writes) {
      localStorage.setItem(key, value);
      written++;
    }
  } catch {
    try {
      for (const [key, value] of previous.slice(0, written)) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    } catch {
      throw new Error('Could not load sample data, and undoing the partial load also failed. Browser storage may now be inconsistent; reload the page to check it.');
    }
    throw new Error('Could not load sample data. Browser storage may be full or unavailable. Nothing was changed.');
  }
}

function nextCode(ids: string[], prefix: string, digits: number) {
  const numbers = ids.filter(id => id.startsWith(prefix)).map(id => Number(id.slice(prefix.length))).filter(Number.isFinite);
  return prefix + String(Math.max(0, ...numbers) + 1).padStart(digits, '0');
}

export function migrateKnowledge(oldIssues: LegacyIssue[], oldGuides: Omit<Guide, 'issueId'>[], playbooks: Playbook[]): LegacyKnowledge {
  const issues: Issue[] = oldIssues.map(i => ({
    id: i.id, playbookId: i.playbookId, title: i.title, summary: i.summary,
    symptoms: [i.title], errorMessage: '', context: '', affectedArea: '',
    informationToCollect: i.requirements || [], attachments: [],
    internalNotes: '', status: i.status, difficulty: i.difficulty,
    estimatedTime: i.estimatedTime, author: i.author,
    createdAt: i.updatedAt, updatedAt: i.updatedAt,
  }));
  const guides: Guide[] = [];
  const reservedIds = oldGuides.map(g => g.id);
  for (const old of oldIssues) {
    if (!old.steps?.length && !old.importantInformation && !old.beforeYouStart?.length && !old.commonProblems?.length && !old.faq?.length) {
      issues.find(i => i.id === old.id)!.internalNotes = old.internalNotes || '';
      continue;
    }
    const prefix = (playbooks.find(p => p.id === old.playbookId)?.code || 'GD') + '-G';
    const id = nextCode([...reservedIds, ...guides.map(g => g.id)], prefix, 2);
    guides.push({
      id, issueId: old.id, playbookId: old.playbookId,
      title: `How to resolve: ${old.title}`,
      summary: `Follow the documented solution for ${old.title}.`, status: old.status,
      difficulty: old.difficulty, estimatedTime: old.estimatedTime, author: old.author, updatedAt: old.updatedAt,
      requirements: old.requirements || [], beforeYouStart: old.beforeYouStart || [], importantInformation: old.importantInformation || '',
      steps: old.steps || [], commonProblems: old.commonProblems || [], faq: old.faq || [],
      relatedItems: old.relatedItems || [], internalNotes: old.internalNotes || '', revisionHistory: old.revisionHistory || [],
    });
  }
  for (const old of oldGuides) {
    // Retain old Guide IDs so bookmarks and SOP references continue to work.
    let issue = issues.find(i => old.relatedItems?.includes(i.id) && i.playbookId === old.playbookId && !guides.some(g => g.issueId === i.id));
    if (!issue) {
      const prefix = (playbooks.find(p => p.id === old.playbookId)?.code || 'ISS') + '-';
      issue = {
        id: nextCode(issues.map(i => i.id), prefix, 3), playbookId: old.playbookId, title: `Problem documented by: ${old.title}`,
        summary: old.summary, symptoms: [], errorMessage: '', context: '', affectedArea: '',
        informationToCollect: [], attachments: [], internalNotes: 'Imported from an existing Guide. Review and complete the problem description.',
        status: 'Draft', difficulty: old.difficulty, estimatedTime: '',
        author: old.author, createdAt: old.updatedAt, updatedAt: old.updatedAt,
      };
      issues.push(issue);
    }
    guides.push({ ...old, issueId: issue.id, playbookId: issue.playbookId });
  }
  return { version: 2, issues, guides };
}

// Reads v2 or pre-v2 storage as a v3 envelope. Returns null when no legacy data is stored.
function readLegacyKnowledge(): Knowledge | null {
  let previous: string | null;
  try {
    previous = localStorage.getItem(legacyKnowledgeKey);
  } catch {
    throw new StorageCorruptedError(legacyKnowledgeKey, 'Storage is inaccessible.');
  }

  let legacy: LegacyKnowledge;
  if (previous !== null) {
    try {
      legacy = JSON.parse(previous);
      if (!legacy || typeof legacy !== 'object' || legacy.version !== 2 || !Array.isArray(legacy.issues) || !Array.isArray(legacy.guides)) {
        throw new StorageCorruptedError(legacyKnowledgeKey, 'Invalid legacy knowledge format.');
      }
    } catch (e) {
      if (e instanceof StorageCorruptedError) throw e;
      throw new StorageCorruptedError(legacyKnowledgeKey, 'Legacy knowledge contains malformed JSON.');
    }
  } else if (hasStoredKey(legacyIssuesKey) || hasStoredKey(legacyGuidesKey)) {
    // A missing legacy list counts as empty; sample content is never merged into stored records.
    // samplePlaybooks is only read here for the Playbook code prefix of new IDs (WA-G02, not
    // GD-G01), as pre-v2 installs without a stored Playbook list saw it. Nothing is copied from it.
    legacy = migrateKnowledge(loadData<LegacyIssue>('issues', []), loadData<Omit<Guide, 'issueId'>>('guides', []), loadData('playbooks', samplePlaybooks));
  } else {
    return null;
  }

  return { version: 3, issues: legacy.issues, guides: legacy.guides.map(initialIdentity), guideVersions: legacy.guides.map(g => initialVersion(g, true)) };
}

export function validateKnowledge(data: Knowledge) {
  const ids = new Set<string>();
  for (const issue of data.issues) {
    if (!issue.id || ids.has(issue.id)) throw new Error('Issue codes must be unique.');
    ids.add(issue.id);
  }
  const assigned = new Set<string>();
  const guideIds = new Set<string>();
  for (const guide of data.guides) {
    const issue = data.issues.find(i => i.id === guide.issueId);
    if (!issue) throw new Error('Select an existing Related Issue.');
    if (guide.playbookId !== issue.playbookId) throw new Error('The Guide must use its Issue’s Playbook.');
    if (assigned.has(issue.id)) throw new Error('This Issue already has a primary Guide. Open the existing Guide.');
    if (guideIds.has(guide.id)) throw new Error('Guide codes must be unique.');
    const versions = data.guideVersions.filter(v => v.guideId === guide.id);
    const active = versions.find(v => v.id === guide.currentVersionId);
    if (!active || active.versionNumber !== guide.versionNumber || JSON.stringify(guideContent(active)) !== JSON.stringify(guideContent(guide))) throw new Error('Guide version history is inconsistent.');
    if (new Set(versions.map(v => v.id)).size !== versions.length || new Set(versions.map(v => v.versionNumber)).size !== versions.length) throw new Error('Duplicate Guide version.');
    assigned.add(issue.id); guideIds.add(guide.id);
  }
}
function writeKnowledge(data: Knowledge) {
  validateKnowledge(data);
  settleImplicitDefaults(true);
  try { localStorage.setItem(knowledgeKey, JSON.stringify(data)); }
  catch { throw new Error('Could not save. Browser storage may be full or unavailable. Your form has been kept open.'); }
}
function hasStoredKey(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    throw new StorageCorruptedError(key, 'Storage is inaccessible.');
  }
}
function readKnowledge(): Knowledge {
  let stored: string | null;
  try {
    stored = localStorage.getItem(knowledgeKey);
  } catch {
    throw new StorageCorruptedError(knowledgeKey, 'Storage is inaccessible.');
  }

  if (stored !== null) {
    let data: Knowledge;
    try {
      data = JSON.parse(stored) as Knowledge;
    } catch {
      throw new StorageCorruptedError(knowledgeKey, 'Knowledge envelope contains malformed JSON.');
    }
    if (!data || typeof data !== 'object' || data.version !== 3 || !Array.isArray(data.issues) || !Array.isArray(data.guides) || !Array.isArray(data.guideVersions)) {
      throw new StorageCorruptedError(knowledgeKey, 'Knowledge envelope schema is invalid.');
    }
    try {
      validateKnowledge(data);
    } catch (e) {
      throw new StorageCorruptedError(knowledgeKey, e instanceof Error ? e.message : 'Knowledge validation failed.');
    }
    return data;
  }

  const migrated = readLegacyKnowledge();
  if (migrated) {
    writeKnowledge(migrated);
    return migrated;
  }
  // An empty workspace stays empty and unwritten until the user saves something.
  return { version: 3, issues: [], guides: [], guideVersions: [] };
}

export function checkStorageIntegrity(): StorageIntegrityResult {
  try {
    localStorage.getItem(knowledgeKey);
  } catch {
    return {
      status: 'unavailable',
      affectedKeys: [],
      details: {},
      canReset: false,
    };
  }

  const affectedKeys: string[] = [];
  const details: Record<string, StorageKeyStatus> = {};
  let canReset = true;

  const { manifest, error: manifestLoadError } = getBackupManifest();
  let manifestError = manifestLoadError;
  let manifestChanged = false;

  const checkKey = (key: string, validateFn: (raw: string) => void) => {
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return;
    }
    if (raw === null) {
      return;
    }

    let isCorrupted = false;
    let errorMessage: string | undefined;
    try {
      validateFn(raw);
    } catch (e) {
      isCorrupted = true;
      errorMessage = e instanceof Error ? e.message : 'Invalid structure';
    }

    if (isCorrupted) {
      affectedKeys.push(key);
      const existing = manifest[key];
      let backupKey: string | undefined;
      let backupFailed = false;

      if (existing?.backupKey) {
        try {
          const existingVal = localStorage.getItem(existing.backupKey);
          if (existingVal === raw) {
            backupKey = existing.backupKey;
          }
        } catch {
          // ignore error reading backup key
        }
      }

      if (!backupKey) {
        const candidate = getNextBackupKey(cleanStorageKey(key));
        try {
          localStorage.setItem(candidate, raw);
          const readBack = localStorage.getItem(candidate);
          if (readBack === raw) {
            backupKey = candidate;
            manifest[key] = { backupKey: candidate };
            manifestChanged = true;
          } else {
            backupFailed = true;
          }
        } catch {
          backupFailed = true;
        }
      }

      if (backupFailed) {
        canReset = false;
      }

      details[key] = {
        key,
        corrupted: true,
        backupKey,
        backupFailed,
        error: errorMessage,
      };
    }
  };

  checkKey(knowledgeKey, (raw) => {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Knowledge envelope is not an object.');
    }
    if (parsed.version !== 3) {
      throw new Error(`Expected Knowledge version 3, found ${parsed.version}.`);
    }
    if (!Array.isArray(parsed.issues) || !Array.isArray(parsed.guides) || !Array.isArray(parsed.guideVersions)) {
      throw new Error('Knowledge issues, guides, or guideVersions is not an array.');
    }
    validateKnowledge(parsed as Knowledge);
  });

  if (localStorage.getItem(knowledgeKey) === null && localStorage.getItem('ib_playbook_knowledge_v2') !== null) {
    checkKey('ib_playbook_knowledge_v2', (raw) => {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || parsed.version !== 2 || !Array.isArray(parsed.issues) || !Array.isArray(parsed.guides)) {
        throw new Error('Legacy knowledge is invalid.');
      }
    });
  }

  // Pre-v2 lists are only read when neither envelope exists, so only check them then.
  if (localStorage.getItem(knowledgeKey) === null && localStorage.getItem('ib_playbook_knowledge_v2') === null) {
    const checkLegacyList = (label: string) => (raw: string) => {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error(`Legacy ${label} list must be an array.`);
      }
      const ids = new Set<string>();
      for (const r of parsed) {
        if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.playbookId !== 'string' || typeof r.title !== 'string') {
          throw new Error(`Invalid legacy ${label} record.`);
        }
        if (ids.has(r.id)) {
          throw new Error(`Legacy ${label} IDs must be unique.`);
        }
        ids.add(r.id);
      }
    };
    checkKey(legacyIssuesKey, checkLegacyList('Issue'));
    checkKey(legacyGuidesKey, checkLegacyList('Guide'));
  }

  checkKey('ib_playbook_playbooks', (raw) => {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('Playbooks must be an array.');
    }
    const ids = new Set<string>();
    for (const p of parsed) {
      if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.code !== 'string') {
        throw new Error('Invalid playbook record.');
      }
      if (ids.has(p.id)) {
        throw new Error('Playbook IDs must be unique.');
      }
      ids.add(p.id);
    }
  });

  checkKey('ib_playbook_sops', (raw) => {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('SOPs must be an array.');
    }
    const ids = new Set<string>();
    for (const s of parsed) {
      if (!s || typeof s !== 'object' || typeof s.id !== 'string' || typeof s.playbookId !== 'string' || typeof s.title !== 'string') {
        throw new Error('Invalid SOP record.');
      }
      if (ids.has(s.id)) {
        throw new Error('SOP IDs must be unique.');
      }
      ids.add(s.id);
    }
  });

  if (manifestChanged) {
    const saveErr = saveBackupManifest(manifest);
    if (saveErr) {
      manifestError = saveErr;
    }
  }

  return {
    status: affectedKeys.length > 0 ? 'corrupted' : 'healthy',
    affectedKeys,
    details,
    canReset: affectedKeys.length === 0 || canReset,
    ...(manifestError ? { manifestError } : {}),
  };
}

export function getCorruptedBackupData(): Record<string, string> {
  const integrity = checkStorageIntegrity();
  const result: Record<string, string> = {};
  for (const key of integrity.affectedKeys) {
    const detail = integrity.details[key];
    if (detail?.backupKey) {
      const val = localStorage.getItem(detail.backupKey);
      if (val !== null) {
        result[key] = val;
        continue;
      }
    }
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      result[key] = raw;
    }
  }
  return result;
}

export function resetCorruptedStorage(options?: { withoutBackup?: boolean }): StorageIntegrityResult {
  const integrity = checkStorageIntegrity();
  if (integrity.status === 'healthy') {
    return integrity;
  }
  if (!integrity.canReset && !options?.withoutBackup) {
    throw new Error('Cannot reset storage: backup could not be verified. Please download your data before resetting.');
  }

  const { manifest } = getBackupManifest();
  const keysToReset = options?.withoutBackup
    ? integrity.affectedKeys.filter(k => integrity.details[k]?.backupFailed)
    : integrity.affectedKeys;

  for (const key of keysToReset) {
    if (key === knowledgeKey) {
      const emptyKnowledge: Knowledge = { version: 3, issues: [], guides: [], guideVersions: [] };
      localStorage.setItem(knowledgeKey, JSON.stringify(emptyKnowledge));
    } else if (key === 'ib_playbook_playbooks') {
      localStorage.setItem('ib_playbook_playbooks', JSON.stringify([]));
    } else if (key === 'ib_playbook_sops' || key === legacyIssuesKey || key === legacyGuidesKey) {
      localStorage.setItem(key, JSON.stringify([]));
    } else if (key === 'ib_playbook_knowledge_v2') {
      localStorage.setItem('ib_playbook_knowledge_v2', JSON.stringify({ version: 2, issues: [], guides: [] }));
    }
    delete manifest[key];
  }
  saveBackupManifest(manifest);

  return checkStorageIntegrity();
}
export const getIssues = (): Issue[] => readKnowledge().issues;
export const getGuides = (): VersionedGuide[] => readKnowledge().guides;
export const getPrimaryGuide = (issueId: string): VersionedGuide | undefined => getGuides().find(g => g.issueId === issueId);
export const getSolutionState = (issueId: string) => getPrimaryGuide(issueId) ? 'Solution Available' : 'Guide Needed';
export const saveIssues = (issues: Issue[]) => writeKnowledge({ ...readKnowledge(), issues });
export const saveGuides = (guides: Guide[]) => {
  const data = readKnowledge();
  // Bulk replacement must not bypass version creation or erase history.
  for (const guide of guides) {
    if (!data.issues.some(i => i.id === guide.issueId)) throw new Error('Select an existing Related Issue.');
  }
  if (JSON.stringify(guides) !== JSON.stringify(data.guides)) throw new Error('Use Publish Update to change a Guide while retaining version history.');
};
export const getGuideVersions = (guideId: string) => readKnowledge().guideVersions.filter(v => v.guideId === guideId).sort((a, b) => b.versionNumber - a.versionNumber);
export const getGuideVersion = (guideId: string, versionId: string) => getGuideVersions(guideId).find(v => v.id === versionId);

// These mutation boundaries can receive authenticated actors/permissions later.
export const getGuideEditorName = () => 'Tarik Deniz';
function appendGuideVersion(guideId: string, content: GuideContent, expectedVersionId: string, summary: string, restoredFromVersionId?: string): VersionedGuide {
  const data = readKnowledge();
  const current = data.guides.find(g => g.id === guideId);
  if (!current) throw new Error('Guide not found.');
  if (current.currentVersionId !== expectedVersionId) throw new Error('This Guide was updated elsewhere. Reopen the current Guide before publishing. Your changes have not been saved.');
  const snapshot = guideContent(content);
  if (!snapshot.title.trim() || !snapshot.summary.trim() || !snapshot.steps.length || snapshot.steps.some(s => !s.title.trim() || !s.description.trim())) throw new Error('Add a Guide title, summary, and complete solution steps.');
  if (!restoredFromVersionId && JSON.stringify(snapshot) === JSON.stringify(guideContent(current))) throw new Error('No content changes to publish.');
  const number = current.versionNumber + 1;
  const createdAt = new Date().toISOString();
  const createdBy = getGuideEditorName();
  const version: GuideVersion = { ...snapshot, id: `${guideId}:v${number}`, guideId, versionNumber: number, createdAt, createdBy, changeSummary: summary.trim() || 'Guide updated', ...(restoredFromVersionId ? { restoredFromVersionId } : {}) };
  const next: VersionedGuide = { ...current, ...snapshot, currentVersionId: version.id, versionNumber: number, updatedAt: createdAt, updatedBy: createdBy };
  writeKnowledge({ ...data, guides: data.guides.map(g => g.id === guideId ? next : g), guideVersions: [...data.guideVersions, version] });
  return JSON.parse(JSON.stringify(next));
}
export const publishGuideUpdate = (guideId: string, content: GuideContent, expectedVersionId: string, summary = '') => appendGuideVersion(guideId, content, expectedVersionId, summary);
export const restoreGuideVersion = (guideId: string, versionId: string, expectedVersionId: string) => {
  const old = getGuideVersion(guideId, versionId);
  if (!old) throw new Error('Historical version not found.');
  if (versionId === expectedVersionId) throw new Error('This version is already current.');
  return appendGuideVersion(guideId, old, expectedVersionId, `Restored from version ${formatGuideVersion(old.versionNumber)}`, versionId);
};

// Helpers to add data
export const addPlaybook = (p: Omit<Playbook, 'issueCount' | 'guideCount' | 'sopCount' | 'updatedAt'>) => {
  const list = getPlaybooks();
  const newPlaybook: Playbook = {
    ...p,
    issueCount: 0,
    guideCount: 0,
    sopCount: 0,
    updatedAt: 'Just now'
  };
  list.push(newPlaybook);
  savePlaybooks(list);
  return newPlaybook;
};

export const addIssue = (issue: Omit<Issue, 'id' | 'createdAt' | 'updatedAt' | 'author'>) => {
  const data = readKnowledge();
  const playbook = getPlaybooks().find(p => p.id === issue.playbookId);
  if (!playbook || !issue.title.trim() || !issue.summary.trim()) throw new Error('Playbook, Issue title and problem summary are required.');
  const now = new Date().toISOString();
  const newIssue: Issue = { ...issue, id: nextCode(data.issues.map(i => i.id), `${playbook.code}-`, 3), createdAt: now, updatedAt: now, author: 'Tarik Deniz' };
  writeKnowledge({ ...data, issues: [...data.issues, newIssue] });
  return newIssue;
};

export const addGuide = (guide: Omit<Guide, 'id' | 'updatedAt' | 'author'>) => {
  const data = readKnowledge();
  const issue = data.issues.find(i => i.id === guide.issueId);
  if (!issue) throw new Error('Select an existing Related Issue.');
  if (guide.playbookId !== issue.playbookId) throw new Error('The Guide must use its Issue’s Playbook.');
  if (data.guides.some(g => g.issueId === issue.id)) throw new Error('This Issue already has a primary Guide. Open the existing Guide.');
  if (!guide.title.trim() || !guide.summary.trim() || !guide.steps.length || guide.steps.some(s => !s.title.trim() || !s.description.trim())) throw new Error('Add a Guide title, summary, and complete solution steps.');
  const playbook = getPlaybooks().find(p => p.id === issue.playbookId);
  if (!playbook) throw new Error('The selected Issue’s Playbook is unavailable.');
  const newGuide: Guide = { ...guide, playbookId: issue.playbookId, id: nextCode(data.guides.map(g => g.id), `${playbook.code}-G`, 2), updatedAt: new Date().toISOString(), author: 'Tarik Deniz' };
  const versioned = initialIdentity(newGuide);
  writeKnowledge({ ...data, guides: [...data.guides, versioned], guideVersions: [...data.guideVersions, initialVersion(newGuide)] });
  return versioned;
};

export const addSOP = (sop: Omit<SOP, 'id' | 'updatedAt' | 'owner'>) => {
  const list = getSOPs();
  const playbooks = getPlaybooks();

  const playbook = playbooks.find(p => p.id === sop.playbookId);
  const prefix = playbook ? playbook.code : 'SOP';
  
  const samePlaybookSOPs = list.filter(s => s.playbookId === sop.playbookId);
  const nextNum = samePlaybookSOPs.length + 1;
  const formattedCode = `${prefix}-SOP${String(nextNum).padStart(2, '0')}`;

  const newSOP: SOP = {
    ...sop,
    id: formattedCode,
    updatedAt: new Date().toISOString().split('T')[0],
    owner: 'Support Team'
  };

  list.push(newSOP);
  saveSOPs(list);

  // Update count in playbook
  if (playbook) {
    playbook.sopCount += 1;
    playbook.updatedAt = 'Just now';
    savePlaybooks(playbooks);
  }

  return newSOP;
};
