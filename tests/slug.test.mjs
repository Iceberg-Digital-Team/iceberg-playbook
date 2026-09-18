import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const js = ts.transpileModule(readFileSync(new URL('../src/slug.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText;
const { toSlug } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('Turkish playbook names produce readable Latin slugs instead of an empty string', () => {
  assert.equal(toSlug('Çözüm Süreçleri'), 'cozum-surecleri');
  assert.equal(toSlug('İş Süreçleri'), 'is-surecleri');
  assert.equal(toSlug('Müşteri Görüşmeleri'), 'musteri-gorusmeleri');
});

test('a name made only of Turkish-specific characters no longer collapses to an empty slug', () => {
  assert.equal(toSlug('Çığşöü'), 'cigsou');
});

test('plain ASCII names keep behaving exactly as before', () => {
  assert.equal(toSlug('WhatsApp'), 'whatsapp');
  assert.equal(toSlug('  Meta   Business  '), 'meta-business');
});
