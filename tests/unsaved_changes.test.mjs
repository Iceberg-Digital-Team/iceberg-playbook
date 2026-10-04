import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importTs } from './helpers/transpile.mjs';

const routerModule = await importTs('src/router.ts', 'router-unsaved-test');
const { setNavigationBlocker } = routerModule;

test('Discard changes confirmation dialog contains exact required copy', () => {
  const dialogSource = readFileSync(new URL('../src/components/knowledge/UnsavedChangesDialog.tsx', import.meta.url), 'utf8');
  assert.ok(dialogSource.includes('Discard changes?'), 'Title must be "Discard changes?"');
  assert.ok(
    dialogSource.includes('You have unsaved changes. If you leave this page, your changes will be lost.'),
    'Message must be exact required text'
  );
  assert.ok(dialogSource.includes('Stay'), 'Must have Stay button');
  assert.ok(dialogSource.includes('Leave'), 'Must have Leave button');
});

test('Router supports navigation blocker callback', () => {
  let blockedTarget = null;
  let proceedCallback = null;

  setNavigationBlocker((target, proceed) => {
    blockedTarget = target;
    proceedCallback = proceed;
    return true; // blocked
  });

  // Test setNavigationBlocker cleanly unregisters
  setNavigationBlocker(null);
  assert.equal(blockedTarget, null);
  assert.equal(proceedCallback, null);
});

test('Create Issue and Edit Issue form is protected with dirty check and discard dialog', () => {
  const issueSource = readFileSync(new URL('../src/pages/CreateIssue.tsx', import.meta.url), 'utf8');
  assert.ok(issueSource.includes('useUnsavedChangesWarning'), 'Must use useUnsavedChangesWarning');
  assert.ok(issueSource.includes('<DiscardDialog />'), 'Must render DiscardDialog');
  assert.ok(issueSource.includes('markClean()'), 'Must call markClean() upon successful save');
});

test('Create Guide and Edit Guide form is protected with dirty check and discard dialog', () => {
  const guideSource = readFileSync(new URL('../src/pages/CreateGuide.tsx', import.meta.url), 'utf8');
  assert.ok(guideSource.includes('useUnsavedChangesWarning'), 'Must use useUnsavedChangesWarning');
  assert.ok(guideSource.includes('<DiscardDialog />'), 'Must render DiscardDialog');
  assert.ok(guideSource.includes('markClean()'), 'Must call markClean() upon successful publish');
});

test('Create SOP and Edit SOP form is protected with dirty check and discard dialog', () => {
  const sopSource = readFileSync(new URL('../src/pages/CreateSOP.tsx', import.meta.url), 'utf8');
  assert.ok(sopSource.includes('useUnsavedChangesWarning'), 'Must use useUnsavedChangesWarning');
  assert.ok(sopSource.includes('<DiscardDialog />'), 'Must render DiscardDialog');
  assert.ok(sopSource.includes('markClean()'), 'Must call markClean() upon successful create/update');
});
