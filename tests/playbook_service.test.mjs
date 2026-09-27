import { test } from 'node:test';
import assert from 'node:assert/strict';

// Provide dummy env for transpiler module loading in test environment
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dummy.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key-for-unit-tests';

import { importTs } from './helpers/transpile.mjs';

test('mapPlaybookRowToPlaybook correctly maps database fields to frontend playbook shape', async () => {
  const { mapPlaybookRowToPlaybook } = await importTs('src/services/playbookService.ts', 'playbook-service');
  const dbRow = {
    id: 'whatsapp',
    slug: 'whatsapp',
    name: 'WhatsApp',
    code: 'WA',
    description: 'WhatsApp support playbook',
    icon: 'MessageSquare',
    owner: 'Support Team',
    visibility: 'Internal',
    created_at: '2026-09-27T00:00:00Z',
    updated_at: '2026-09-27T00:00:00Z',
    deleted_at: null,
    deleted_by: null,
  };

  const playbook = mapPlaybookRowToPlaybook(dbRow);
  assert.equal(playbook.id, 'whatsapp');
  assert.equal(playbook.slug, 'whatsapp');
  assert.equal(playbook.name, 'WhatsApp');
  assert.equal(playbook.code, 'WA');
  assert.equal(playbook.description, 'WhatsApp support playbook');
  assert.equal(playbook.icon, 'MessageSquare');
  assert.equal(playbook.owner, 'Support Team');
  assert.equal(playbook.visibility, 'Internal');
  assert.equal(playbook.updatedAt, '2026-09-27T00:00:00Z');
  assert.equal(playbook.issueCount, 0);
  assert.equal(playbook.guideCount, 0);
  assert.equal(playbook.sopCount, 0);
});

test('createPlaybook validates required inputs before sending query', async () => {
  const { createPlaybook } = await importTs('src/services/playbookService.ts', 'playbook-service');
  const mockClient = {};

  await assert.rejects(
    () => createPlaybook({ name: '', code: 'WA', description: 'Desc' }, mockClient),
    /Enter a valid Playbook name/
  );

  await assert.rejects(
    () => createPlaybook({ name: 'Test', code: '', description: 'Desc' }, mockClient),
    /Enter a code prefix/
  );

  await assert.rejects(
    () => createPlaybook({ name: 'Test', code: 'W', description: 'Desc' }, mockClient),
    /Code prefix must be 2 to 5 alphanumeric characters/
  );

  await assert.rejects(
    () => createPlaybook({ name: 'Test', code: 'TOOLONGPREFIX', description: 'Desc' }, mockClient),
    /Code prefix must be 2 to 5 alphanumeric characters/
  );

  await assert.rejects(
    () => createPlaybook({ name: 'Test', code: 'WA-1', description: 'Desc' }, mockClient),
    /Code prefix must be 2 to 5 alphanumeric characters/
  );

  await assert.rejects(
    () => createPlaybook({ name: 'Test', code: 'WA', description: '' }, mockClient),
    /Enter a description/
  );
});

test('getPlaybookBySlug returns null for empty or whitespace slug', async () => {
  const { getPlaybookBySlug } = await importTs('src/services/playbookService.ts', 'playbook-service');
  const mockClient = {};
  const result = await getPlaybookBySlug('   ', mockClient);
  assert.equal(result, null);
});

test('softDeletePlaybook throws for empty id', async () => {
  const { softDeletePlaybook } = await importTs('src/services/playbookService.ts', 'playbook-service');
  const mockClient = {};
  await assert.rejects(
    () => softDeletePlaybook('', mockClient),
    /Invalid Playbook ID/
  );
});
