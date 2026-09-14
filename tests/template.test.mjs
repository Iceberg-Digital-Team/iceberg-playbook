import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const js = ts.transpileModule(readFileSync(new URL('../src/guideTemplate.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText;
const {guideChecklist,safeMediaUrl,videoEmbed} = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('legacy requirements merge for display without changing snapshot arrays', () => {
 const content={beforeYouStart:[' Admin access ','ID'],requirements:['ID','Permission','']};
 const before=structuredClone(content);
 assert.deepEqual(guideChecklist(content),['Admin access','ID','Permission']);
 assert.deepEqual(content,before);
});
test('media allows real web references and rejects executable or unsupported schemes', () => {
 assert.equal(safeMediaUrl('javascript:alert(1)'),undefined);
 assert.equal(safeMediaUrl('data:text/html,unsafe'),undefined);
 assert.equal(safeMediaUrl('old screenshot reference'),undefined);
 assert.equal(videoEmbed('https://youtu.be/abcdefghijk'),'https://www.youtube-nocookie.com/embed/abcdefghijk');
 assert.equal(videoEmbed('https://youtube.com.evil.test/watch?v=abcdefghijk'),undefined);
 assert.equal(videoEmbed('https://vimeo.com/123456'),'https://player.vimeo.com/video/123456');
});
