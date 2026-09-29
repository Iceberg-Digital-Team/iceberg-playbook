import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const srcDir = join(__dirname, '../src');

function getAllFiles(dir, exts = ['.ts', '.tsx']) {
  let results = [];
  const list = readdirSync(dir);
  for (const file of list) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(filePath, exts));
    } else if (exts.some(ext => file.endsWith(ext))) {
      results.push(filePath);
    }
  }
  return results;
}

test('active source code does not import legacy get*/add*/save* persistence helpers from data', () => {
  const files = getAllFiles(srcDir);
  const legacyNames = [
    'getPlaybooks',
    'getIssues',
    'getGuides',
    'getSOPs',
    'getPrimaryGuide',
    'getSolutionState',
    'addPlaybook',
    'addIssue',
    'addGuide',
    'addSOP',
    'savePlaybooks',
    'saveIssues',
    'saveGuides',
    'saveSOPs',
    'loadSampleData',
    'hasAnyContent',
    'checkStorageIntegrity',
    'resetCorruptedStorage'
  ];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const name of legacyNames) {
      const importRegex = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`);
      assert.ok(
        !importRegex.test(content),
        `File ${file} must not import legacy persistence helper "${name}"`
      );
    }
  }
});

test('no production runtime uses ib_playbook_* localStorage keys', () => {
  const files = getAllFiles(srcDir);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    assert.ok(
      !content.includes('ib_playbook_'),
      `File ${file} must not reference legacy "ib_playbook_" key`
    );
  }
});

test('no production runtime in src/ uses localStorage for application data persistence', () => {
  const files = getAllFiles(srcDir);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    assert.ok(
      !content.includes('localStorage.getItem'),
      `File ${file} must not call localStorage.getItem directly`
    );
    assert.ok(
      !content.includes('localStorage.setItem'),
      `File ${file} must not call localStorage.setItem directly`
    );
    assert.ok(
      !content.includes('localStorage.clear'),
      `File ${file} must not call localStorage.clear`
    );
  }
});

test('src/data.ts exports only types, models and pure formatters without persistence or sample imports', () => {
  const dataFile = join(srcDir, 'data.ts');
  const content = readFileSync(dataFile, 'utf8');

  assert.ok(!content.includes("from './sampleData'"), 'src/data.ts must not import sampleData');
  assert.ok(!content.includes('localStorage'), 'src/data.ts must not reference localStorage');
  assert.ok(!content.includes('loadData'), 'src/data.ts must not export loadData');
  assert.ok(!content.includes('saveData'), 'src/data.ts must not export saveData');
  assert.ok(!content.includes('getPlaybooks'), 'src/data.ts must not export getPlaybooks');
  assert.ok(!content.includes('addPlaybook'), 'src/data.ts must not export addPlaybook');

  // Verify pure formatters and models are preserved
  assert.ok(content.includes('export interface Playbook'), 'src/data.ts must export Playbook interface');
  assert.ok(content.includes('export interface Issue'), 'src/data.ts must export Issue interface');
  assert.ok(content.includes('export interface Guide'), 'src/data.ts must export Guide interface');
  assert.ok(content.includes('export interface SOP'), 'src/data.ts must export SOP interface');
  assert.ok(content.includes('export const formatGuideVersion'), 'src/data.ts must export formatGuideVersion');
  assert.ok(content.includes('export const formatGuideDate'), 'src/data.ts must export formatGuideDate');
  assert.ok(content.includes('export function guideContent'), 'src/data.ts must export guideContent');
});

test('Settings page does not retain sample data loader or sample modal', () => {
  const settingsFile = join(srcDir, 'pages/Settings.tsx');
  const content = readFileSync(settingsFile, 'utf8');

  assert.ok(!content.includes('Sample Data'), 'Settings.tsx must not contain Sample Data section');
  assert.ok(!content.includes('loadSampleData'), 'Settings.tsx must not import or call loadSampleData');
  assert.ok(!content.includes('SampleDataDialog'), 'Settings.tsx must not declare or render SampleDataDialog');
  assert.ok(!content.includes('loadSamples'), 'Settings.tsx must not contain loadSamples function');
});

test('legacy mockAuthAdapter is completely removed while AuthSession/validateSignIn remain intact', () => {
  const authFile = join(srcDir, 'auth/auth.ts');
  const content = readFileSync(authFile, 'utf8');

  assert.ok(!content.includes('mockAuthAdapter'), 'auth.ts must not contain mockAuthAdapter');
  assert.ok(content.includes('export function validateSignIn'), 'auth.ts must retain validateSignIn');
  assert.ok(content.includes('export function getAuthActor'), 'auth.ts must retain getAuthActor');
});

test('Supabase services remain the sole source of truth for active entities', () => {
  const services = ['playbookService.ts', 'issueService.ts', 'guideService.ts', 'sopService.ts', 'homeService.ts', 'mediaService.ts'];
  for (const service of services) {
    const filePath = join(srcDir, 'services', service);
    const content = readFileSync(filePath, 'utf8');
    assert.ok(content.includes("from '../lib/supabase'"), `${service} must query Supabase client`);
    assert.ok(!content.includes('localStorage'), `${service} must not use localStorage`);
    assert.ok(!content.includes('sampleData'), `${service} must not use sampleData`);
  }
});
