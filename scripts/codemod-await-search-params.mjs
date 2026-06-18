#!/usr/bin/env node
/**
 * One-shot codemod: Next 15+ searchParams is a Promise on server pages.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name === 'page.jsx' || ent.name === 'page.tsx') out.push(p);
  }
  return out;
}

function patchFile(file) {
  let src = fs.readFileSync(file, 'utf8');
  if (!src.includes('searchParams')) return false;
  if (src.includes('await searchParams')) return false;
  if (!/searchParams\?\.|searchParams\./.test(src)) return false;
  if (src.includes("'use client'") || src.includes('"use client"')) return false;

  const fnRe =
    /export default function (\w+)\s*\([^)]*searchParams[^)]*\)\s*\{/;
  if (!fnRe.test(src)) return false;

  src = src.replace(
    /export default function (\w+)\s*\(/,
    'export default async function $1(',
  );

  const fnReAsync =
    /export default async function (\w+)\s*\([^)]*searchParams[^)]*\)\s*\{/;
  const m = src.match(fnReAsync);
  if (!m) return false;

  const braceIdx = src.indexOf(m[0]) + m[0].length - 1;
  const insert = '  const sp = (await searchParams) || {};\n';
  src = `${src.slice(0, braceIdx + 1)}\n${insert}${src.slice(braceIdx + 1)}`;

  const bodyStart = braceIdx + 1 + insert.length + 1;
  const body = src
    .slice(bodyStart)
    .replace(/searchParams\?\./g, 'sp?.')
    .replace(/searchParams\./g, 'sp.');
  src = src.slice(0, bodyStart) + body;

  fs.writeFileSync(file, src);
  return true;
}

const changed = [];
for (const f of walk(ROOT)) {
  if (patchFile(f)) changed.push(path.relative(ROOT, f));
}
console.log(`patched ${changed.length} files`);
