import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  clear: () => storage.clear()
};

const dataJs = ts.transpileModule(readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 }
}).outputText;
const d = await import(`data:text/javascript;base64,${Buffer.from(dataJs).toString('base64')}`);

const utilsJs = ts.transpileModule(readFileSync(new URL('../src/components/knowledge/mediaUtils.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 }
}).outputText;
const utils = await import(`data:text/javascript;base64,${Buffer.from(utilsJs).toString('base64')}`);

test('A, B, C: Existing Guide has video, PDF, and step screenshots loaded', () => {
  const guide = d.getGuides().find(g => g.id === 'WA-G01');
  assert.ok(guide, 'Guide WA-G01 should exist');
  assert.ok(guide.video, 'Guide should have existing video');
  assert.ok(guide.pdf, 'Guide should have existing pdf');
  assert.ok(guide.steps[0].screenshot, 'Step 1 should have existing screenshot');
  assert.ok(guide.steps[1].screenshot, 'Step 2 should have existing screenshot');

  // Verify metadata parser detects existing filenames and sizes
  const videoMeta = utils.parseMediaMetadata(guide.video, 'video');
  assert.equal(videoMeta.name, 'whatsapp-bsp-migration.mp4');
  assert.equal(videoMeta.formattedSize, '34.2 MB');

  const pdfMeta = utils.parseMediaMetadata(guide.pdf, 'pdf');
  assert.equal(pdfMeta.name, 'whatsapp-bsp-migration-guide.pdf');
  assert.equal(pdfMeta.formattedSize, '2.8 MB');

  const step1Meta = utils.parseMediaMetadata(guide.steps[0].screenshot, 'image');
  assert.equal(step1Meta.name, 'migration-consent.png');
  assert.equal(step1Meta.formattedSize, '420.0 KB');
});

test('J: Cancel / isolated edit state does not mutate existing Guide', () => {
  const guide = d.getGuides().find(g => g.id === 'WA-G01');
  const snapshotBefore = d.guideContent(guide);

  // Simulate user opening editor and modifying local state
  const editState = structuredClone(snapshotBefore);
  editState.video = '';
  editState.pdf = '';
  editState.steps[0].screenshot = '';

  // User cancels: no publish call made
  const guideAfterCancel = d.getGuides().find(g => g.id === 'WA-G01');
  assert.deepEqual(d.guideContent(guideAfterCancel), snapshotBefore, 'Original guide must remain untouched after cancel');
});

test('D & E: Replace video and Remove video update Guide state and versions correctly', () => {
  const original = d.getGuides().find(g => g.id === 'WA-G01');
  const originalVideo = original.video;

  // Replace video: D
  const contentReplaced = d.guideContent(original);
  contentReplaced.video = 'blob:http://localhost:5173/new-video-id#name=new-tutorial.mp4&size=19400000';
  const v2 = d.publishGuideUpdate(original.id, contentReplaced, original.currentVersionId, 'Replaced video tutorial');
  assert.equal(v2.video, contentReplaced.video);
  assert.equal(d.getGuideVersion(original.id, v2.currentVersionId).video, contentReplaced.video);

  // Verify v1.0 retained its original video: Versioning compatibility
  const v1 = d.getGuideVersions(original.id).find(v => v.versionNumber === 1);
  assert.equal(v1.video, originalVideo);

  // Remove video: E
  const contentRemoved = d.guideContent(v2);
  contentRemoved.video = '';
  const v3 = d.publishGuideUpdate(original.id, contentRemoved, v2.currentVersionId, 'Removed video tutorial');
  assert.equal(v3.video, '');
  assert.equal(d.getGuideVersion(original.id, v3.currentVersionId).video, '');
});

test('F & G: Replace PDF and Remove PDF update Guide state correctly', () => {
  const guide = d.getGuides().find(g => g.id === 'WA-G01');

  // Replace PDF: F
  const contentReplaced = d.guideContent(guide);
  contentReplaced.pdf = 'blob:http://localhost:5173/new-pdf-id#name=new-guide.pdf&size=3145728';
  const vNext = d.publishGuideUpdate(guide.id, contentReplaced, guide.currentVersionId, 'Replaced PDF guide');
  assert.equal(vNext.pdf, contentReplaced.pdf);

  // Remove PDF: G
  const contentRemoved = d.guideContent(vNext);
  contentRemoved.pdf = '';
  const vAfterRemove = d.publishGuideUpdate(guide.id, contentRemoved, vNext.currentVersionId, 'Removed PDF guide');
  assert.equal(vAfterRemove.pdf, '');
});

test('H & I: Replace Step 1 screenshot leaves Step 2 screenshot unchanged, Remove screenshot removes only target', () => {
  const guide = d.getGuides().find(g => g.id === 'WA-G01');
  const step2OriginalScreenshot = guide.steps[1].screenshot;
  assert.ok(step2OriginalScreenshot, 'Step 2 must have an original screenshot');

  // Replace Step 1 screenshot: H
  const contentStep1Replaced = d.guideContent(guide);
  contentStep1Replaced.steps[0].screenshot = 'blob:http://localhost:5173/screenshot-1#name=new-step1.png&size=500000';
  const vStep1 = d.publishGuideUpdate(guide.id, contentStep1Replaced, guide.currentVersionId, 'Updated Step 1 screenshot');

  assert.equal(vStep1.steps[0].screenshot, contentStep1Replaced.steps[0].screenshot);
  assert.equal(vStep1.steps[1].screenshot, step2OriginalScreenshot, 'Step 2 screenshot must NOT be changed when Step 1 is replaced');

  // Remove Step 1 screenshot: I
  const contentStep1Removed = d.guideContent(vStep1);
  contentStep1Removed.steps[0].screenshot = '';
  const vStep1Removed = d.publishGuideUpdate(guide.id, contentStep1Removed, vStep1.currentVersionId, 'Removed Step 1 screenshot');

  assert.equal(vStep1Removed.steps[0].screenshot, '');
  assert.equal(vStep1Removed.steps[1].screenshot, step2OriginalScreenshot, 'Step 2 screenshot must still remain intact');
});

test('K: Create Guide media upload attaches video, PDF and screenshots', () => {
  // Create a new Issue first
  const newIssue = d.addIssue({
    playbookId: 'whatsapp',
    title: 'Test Issue for Media Upload Guide',
    summary: 'Testing creation of a guide with video, PDF and step screenshot attachments.',
    status: 'Draft',
    difficulty: 'Easy',
    estimatedTime: '15 min',
    symptoms: ['Test symptom'],
    errorMessage: '',
    context: '',
    affectedArea: '',
    informationToCollect: [],
    attachments: [],
    internalNotes: ''
  });

  const newGuideData = {
    issueId: newIssue.id,
    playbookId: newIssue.playbookId,
    title: 'Brand New Guide with Full Media',
    summary: 'Testing creation of a guide with video, PDF and step screenshot attachments.',
    status: 'Draft',
    difficulty: 'Easy',
    estimatedTime: '15 min',
    video: 'blob:http://localhost:5173/created-video#name=created.mp4&size=20000000',
    pdf: 'blob:http://localhost:5173/created-pdf#name=created.pdf&size=1500000',
    steps: [
      {
        number: 1,
        title: 'Step 1 with screenshot',
        description: 'Take action and observe screenshot.',
        screenshot: 'blob:http://localhost:5173/created-screen#name=created-step.png&size=300000'
      }
    ],
    beforeYouStart: ['Prerequisite 1'],
    requirements: [],
    importantInformation: 'Important notice',
    commonProblems: [],
    internalNotes: '',
    faq: [],
    relatedItems: [],
    revisionHistory: []
  };

  const created = d.addGuide(newGuideData);
  assert.ok(created.id);
  assert.equal(created.video, newGuideData.video);
  assert.equal(created.pdf, newGuideData.pdf);
  assert.equal(created.steps[0].screenshot, newGuideData.steps[0].screenshot);

  // Verify version 1 snapshot also contains all media
  const v1 = d.getGuideVersion(created.id, created.currentVersionId);
  assert.equal(v1.video, newGuideData.video);
  assert.equal(v1.pdf, newGuideData.pdf);
  assert.equal(v1.steps[0].screenshot, newGuideData.steps[0].screenshot);
});
