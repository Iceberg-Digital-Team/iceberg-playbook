import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 1. Authoritative Seed Data Source
const {
  samplePlaybooks,
  sampleIssues,
  sampleGuides,
  sampleGuideVersions,
  sampleSOPs
} = await import('../src/sampleData.ts');

// 2. Pre-generation Invariant Validations
console.log('Validating seed data invariants...');

const playbookIds = new Set(samplePlaybooks.map(p => p.id));
const issueIds = new Set(sampleIssues.map(i => i.id));
const issueMap = new Map(sampleIssues.map(i => [i.id, i]));
const guideIds = new Set(sampleGuides.map(g => g.id));
const guideMap = new Map(sampleGuides.map(g => [g.id, g]));
const versionIds = new Set(sampleGuideVersions.map(v => v.id));

// Validate Issues
for (const i of sampleIssues) {
  if (!playbookIds.has(i.playbookId)) {
    throw new Error(`Validation Error: Issue ${i.id} references non-existent playbookId "${i.playbookId}"`);
  }
}

// Group versions by Guide
const versionsByGuide = new Map();
for (const v of sampleGuideVersions) {
  if (!guideMap.has(v.guideId)) {
    throw new Error(`Validation Error: GuideVersion ${v.id} references non-existent guideId "${v.guideId}"`);
  }
  if (!versionsByGuide.has(v.guideId)) {
    versionsByGuide.set(v.guideId, []);
  }
  versionsByGuide.get(v.guideId).push(v);
}

// Validate Guides and their Version snapshots
for (const g of sampleGuides) {
  // every Guide issueId exists
  if (!issueIds.has(g.issueId)) {
    throw new Error(`Validation Error: Guide ${g.id} references non-existent issueId "${g.issueId}"`);
  }

  // Guide and Issue playbookId match
  const linkedIssue = issueMap.get(g.issueId);
  if (g.playbookId !== linkedIssue.playbookId) {
    throw new Error(
      `Validation Error: Guide ${g.id} playbookId "${g.playbookId}" does not match Issue ${linkedIssue.id} playbookId "${linkedIssue.playbookId}"`
    );
  }

  // every currentVersionId exists in sampleGuideVersions
  if (!versionIds.has(g.currentVersionId)) {
    throw new Error(`Validation Error: Guide ${g.id} currentVersionId "${g.currentVersionId}" does not exist in sampleGuideVersions`);
  }

  const currVersion = sampleGuideVersions.find(v => v.id === g.currentVersionId);

  // currentVersionId belongs to the same Guide
  if (currVersion.guideId !== g.id) {
    throw new Error(
      `Validation Error: Guide ${g.id} currentVersionId "${g.currentVersionId}" belongs to Guide "${currVersion.guideId}", not "${g.id}"`
    );
  }

  // Guide versionNumber matches its current version
  if (g.versionNumber !== currVersion.versionNumber) {
    throw new Error(
      `Validation Error: Guide ${g.id} versionNumber (${g.versionNumber}) does not match current version versionNumber (${currVersion.versionNumber})`
    );
  }

  // version numbers are unique per Guide
  const gVersions = versionsByGuide.get(g.id) || [];
  if (gVersions.length === 0) {
    throw new Error(`Validation Error: Guide ${g.id} has no corresponding snapshots in sampleGuideVersions`);
  }
  const vNums = gVersions.map(v => v.versionNumber);
  const uniqueVNums = new Set(vNums);
  if (uniqueVNums.size !== vNums.length) {
    throw new Error(`Validation Error: Guide ${g.id} has duplicate version numbers: ${JSON.stringify(vNums)}`);
  }
}

// Validate SOP relationships
for (const s of sampleSOPs) {
  if (!playbookIds.has(s.playbookId)) {
    throw new Error(`Validation Error: SOP ${s.id} references non-existent playbookId "${s.playbookId}"`);
  }
  for (const relIssue of s.relatedIssues || []) {
    if (!issueIds.has(relIssue)) {
      throw new Error(`Validation Error: SOP ${s.id} references non-existent relatedIssue "${relIssue}"`);
    }
  }
  for (const relGuide of s.relatedGuides || []) {
    if (!guideIds.has(relGuide)) {
      throw new Error(`Validation Error: SOP ${s.id} references non-existent relatedGuide "${relGuide}"`);
    }
  }
}

console.log('All seed data invariants validated successfully.');

// 3. Helper Functions for SQL formatting
function esc(str) {
  if (str === null || str === undefined) return 'NULL';
  return "'" + String(str).replace(/'/g, "''") + "'";
}

function escJson(obj) {
  return "'" + JSON.stringify(obj).replace(/'/g, "''") + "'::jsonb";
}

function escArray(arr) {
  if (!arr || !arr.length) return "'{}'";
  return 'ARRAY[' + arr.map(s => esc(s)).join(', ') + ']';
}

function cleanStep(s) {
  const step = {
    number: s.number,
    title: s.title,
    description: s.description,
    estimatedTime: s.estimatedTime || '',
    screenshot: '',
    importantNote: s.importantNote || '',
    successIndicator: s.successIndicator || ''
  };

  // If videoLink or pdfReference exists: strip URLs/file paths, preserve non-URL textual references
  if (s.videoLink) {
    if (/^(https?:\/\/|blob:|file:\/\/|\/|\.\/)/i.test(s.videoLink.trim())) {
      // Stripped
    } else {
      step.videoLink = s.videoLink;
    }
  }

  if (s.pdfReference) {
    if (/^(https?:\/\/|blob:|file:\/\/|\/|\.\/|[\w-]+\.pdf)/i.test(s.pdfReference.trim())) {
      // Stripped
    } else {
      step.pdfReference = s.pdfReference;
    }
  }

  return step;
}

// 4. SQL Assembly
let sql = `-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS
-- Migration 05: Clean Seed Data (Text, Structures, Relationships & Versions)
-- Source of Truth: src/sampleData.ts
-- Mode: PROPOSED (DO NOT EXECUTE WITHOUT APPROVAL)
-- Guarantees:
--   - All Playbooks, Issues, Guides, GuideVersions, and SOPs strictly preserved
--   - All old video/PDF/screenshot/blob/external URLs stripped
--   - Idempotent: safe against re-runs, never downgrades active production guides
--   - Zero media_files rows created
-- ==============================================================================

`;

sql += '-- 1. SEED PLAYBOOKS\n';
for (const p of samplePlaybooks) {
  sql += `INSERT INTO public.playbooks (id, slug, name, code, description, icon, owner, visibility, created_at, updated_at)
VALUES (${esc(p.id)}, ${esc(p.slug)}, ${esc(p.name)}, ${esc(p.code)}, ${esc(p.description)}, ${esc(p.icon)}, ${esc(p.owner || 'Support Team')}, ${esc(p.visibility || 'Internal')}, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;\n\n`;
}

sql += '-- 2. SEED ISSUES (Stripped of old external attachments)\n';
for (const i of sampleIssues) {
  sql += `INSERT INTO public.issues (id, playbook_id, title, summary, symptoms, error_message, context, affected_area, information_to_collect, attachments, internal_notes, status, difficulty, estimated_time, author, created_at, updated_at)
VALUES (${esc(i.id)}, ${esc(i.playbookId)}, ${esc(i.title)}, ${esc(i.summary)}, ${escArray(i.symptoms)}, ${esc(i.errorMessage || '')}, ${esc(i.context || '')}, ${esc(i.affectedArea || '')}, ${escArray(i.informationToCollect)}, '[]'::jsonb, ${esc(i.internalNotes || '')}, ${esc(i.status)}, ${esc(i.difficulty)}, ${esc(i.estimatedTime || '')}, ${esc(i.author || 'Support Team')}, ${esc(i.createdAt || new Date().toISOString())}, ${esc(i.updatedAt || new Date().toISOString())})
ON CONFLICT (id) DO NOTHING;\n\n`;
}

sql += '-- 3. SEED GUIDES & IMMUTABLE GUIDE VERSIONS\n';
for (const g of sampleGuides) {
  const cleanGuideSteps = (g.steps || []).map(cleanStep);

  // Step 3a: Insert Guide record with initial NULL current_version_id
  sql += `-- Guide: ${g.id}\n`;
  sql += `INSERT INTO public.guides (
    id, issue_id, playbook_id, current_version_id, version_number,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    revision_history, author, created_by, updated_by, created_at, updated_at
) VALUES (
    ${esc(g.id)}, ${esc(g.issueId)}, ${esc(g.playbookId)}, NULL, ${g.versionNumber},
    ${esc(g.title)}, ${esc(g.summary)}, ${esc(g.status)}, ${esc(g.difficulty)}, ${esc(g.estimatedTime)},
    ${escArray(g.beforeYouStart)}, ${escArray(g.requirements)}, ${esc(g.importantInformation || '')},
    '', NULL, '', NULL,
    ${escJson(cleanGuideSteps)}, ${escJson(g.commonProblems || [])}, ${escJson(g.faq || [])},
    ${escArray(g.relatedItems)}, ${esc(g.internalNotes || '')}, ${escJson(g.revisionHistory || [])},
    ${esc(g.author || 'Support Team')}, ${esc(g.createdBy || 'Support Team')}, ${esc(g.updatedBy || 'Support Team')},
    ${esc(g.createdAt || new Date().toISOString())}, ${esc(g.updatedAt || new Date().toISOString())}
) ON CONFLICT (id) DO NOTHING;\n`;

  // Step 3b: Insert all actual version snapshots belonging to this Guide (sorted by versionNumber ASC)
  const gVersions = (versionsByGuide.get(g.id) || []).slice().sort((a, b) => a.versionNumber - b.versionNumber);

  for (const v of gVersions) {
    const cleanVersionSteps = (v.steps || []).map(cleanStep);
    sql += `INSERT INTO public.guide_versions (
    id, guide_id, version_number, change_summary,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    created_at, created_by, restored_from_version_id
) VALUES (
    ${esc(v.id)}, ${esc(v.guideId)}, ${v.versionNumber}, ${esc(v.changeSummary || 'Historical version snapshot.')},
    ${esc(v.title)}, ${esc(v.summary)}, ${esc(v.status)}, ${esc(v.difficulty)}, ${esc(v.estimatedTime)},
    ${escArray(v.beforeYouStart)}, ${escArray(v.requirements)}, ${esc(v.importantInformation || '')},
    '', NULL, '', NULL,
    ${escJson(cleanVersionSteps)}, ${escJson(v.commonProblems || [])}, ${escJson(v.faq || [])},
    ${escArray(v.relatedItems)}, ${esc(v.internalNotes || '')},
    ${esc(v.createdAt || new Date().toISOString())}, ${esc(v.createdBy || 'Support Team')},
    ${v.restoredFromVersionId ? esc(v.restoredFromVersionId) : 'NULL'}
) ON CONFLICT (id) DO NOTHING;\n`;
  }

  // Step 3c: Set current_version_id and version_number ONLY IF current_version_id IS NULL (never downgrades production edits)
  sql += `UPDATE public.guides
SET current_version_id = ${esc(g.currentVersionId)},
    version_number = ${g.versionNumber}
WHERE id = ${esc(g.id)} AND current_version_id IS NULL;\n\n`;
}

sql += '-- 4. SEED SOPS\n';
for (const s of sampleSOPs) {
  const cleanSOPSteps = (s.steps || []).map(cleanStep);

  sql += `INSERT INTO public.sops (
    id, playbook_id, title, owner, status, estimated_time,
    purpose, when_to_use, requirements, responsible_team,
    checklist, steps, escalation_rules, completion_criteria,
    related_issues, related_guides, internal_notes, revision_history,
    created_at, updated_at
) VALUES (
    ${esc(s.id)}, ${esc(s.playbookId)}, ${esc(s.title)}, ${esc(s.owner || 'Support Team')},
    ${esc(s.status)}, ${esc(s.estimatedTime)}, ${esc(s.purpose)}, ${esc(s.whenToUse)},
    ${escArray(s.requirements)}, ${esc(s.responsibleTeam)}, ${escArray(s.checklist)},
    ${escJson(cleanSOPSteps)}, ${esc(s.escalationRules || '')}, ${esc(s.completionCriteria || '')},
    ${escArray(s.relatedIssues)}, ${escArray(s.relatedGuides)}, ${esc(s.internalNotes || '')},
    ${escJson(s.revisionHistory || [])}, NOW(), ${esc(s.updatedAt || new Date().toISOString().split('T')[0])}
) ON CONFLICT (id) DO NOTHING;\n\n`;
}

// 5. Write to migrations/05_seed_data.sql
const targetPath = path.resolve('supabase/migrations/05_seed_data.sql');
fs.writeFileSync(targetPath, sql, 'utf8');
console.log(`Successfully generated: ${targetPath}`);
console.log(`Summary:
  - Playbooks: ${samplePlaybooks.length}
  - Issues: ${sampleIssues.length}
  - Guides: ${sampleGuides.length}
  - GuideVersions: ${sampleGuideVersions.length}
  - SOPs: ${sampleSOPs.length}
`);
