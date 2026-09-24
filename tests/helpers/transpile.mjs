import ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function resolveTs(fromDir, spec) {
  const base = path.resolve(fromDir, spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  throw new Error(`Cannot resolve TS module "${spec}" from ${fromDir}`);
}

// Transpiles a TS entry and every relative import it reaches into node_modules/.cache.
// Each test file passes its own cacheName: node --test runs files in parallel processes.
const cacheDir = cacheName => path.join(root, 'node_modules', '.cache', 'ts-tests', cacheName);

export function transpileTree(entry, cacheName) {
  const outDir = cacheDir(cacheName);
  const outPath = file => path.join(outDir, path.relative(root, file)).replace(/\.tsx?$/, '.mjs');
  rmSync(outDir, { recursive: true, force: true });
  const done = new Set();
  const visit = file => {
    if (done.has(file)) return;
    done.add(file);
    const source = readFileSync(file, 'utf8');
    let js = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    js = js.replace(/(from\s*|import\s*\(\s*|import\s+)(['"])(\.{1,2}\/[^'"]+)\2/g, (_m, pre, q, spec) => {
      const target = resolveTs(path.dirname(file), spec);
      visit(target);
      return `${pre}${q}${pathToFileURL(outPath(target)).href}${q}`;
    });
    mkdirSync(path.dirname(outPath(file)), { recursive: true });
    writeFileSync(outPath(file), js);
  };
  visit(entry);
  return outPath(entry);
}

export const importTs = (relativeToRoot, cacheName) =>
  import(pathToFileURL(transpileTree(path.join(root, relativeToRoot), cacheName)).href);

// Imports a module already emitted by an earlier importTs call, sharing its instance.
export const importTranspiled = (relativeToRoot, cacheName) =>
  import(pathToFileURL(path.join(cacheDir(cacheName), relativeToRoot).replace(/\.tsx?$/, '.mjs')).href);
