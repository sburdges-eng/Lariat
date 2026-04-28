// Test-only resolve hook. Next.js routes use extensionless relative
// imports (e.g. `import { getDb } from '../../../lib/db'`) that its
// bundler walks. Node's ESM resolver doesn't, so we add the extensions
// back for test runs. Only touches relative specifiers; bare packages
// go through the default resolver unchanged.
//
// Rules:
// - Extensionless: try `.js`, then `.mjs`, then `.ts`, then `.tsx`,
//   `.jsx`. JS-before-TS matches Next.js convention — a project that
//   has both `foo.js` and `foo.ts` should pick the `.js` that Next
//   would ship.
// - Specifier already ends in `.js`: DO NOT remap to `.ts`. Authors
//   who wrote `.js` explicitly get a Node loader error instead of a
//   silent TS match — which is what we want, because those imports
//   also won't work under Next's bundler if the target is really a
//   `.ts` file.
// - Other known extensions (`.mjs`, `.ts`, etc.): pass through.

import { stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const EXT_ORDER = ['.js', '.mjs', '.ts', '.tsx', '.jsx'];
const INDEX_ORDER = EXT_ORDER.map((e) => `index${e}`);
const KNOWN_EXTS = new Set([...EXT_ORDER, '.cjs', '.json']);

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveRelative(specifier, parentURL) {
  if (!parentURL) return null;
  const base = fileURLToPath(parentURL);
  const abs = path.resolve(path.dirname(base), specifier);

  const ext = path.extname(abs);
  // Has a known extension already — let the default handler deal with
  // it. In particular: `.js` does NOT get auto-remapped to `.ts`.
  if (ext && KNOWN_EXTS.has(ext)) return null;
  // Only pass through if the path resolves to a *file*. If it's a
  // directory, fall through to the INDEX_ORDER probe below so that
  // `import '…/computeEngine'` resolves to `computeEngine/index.ts`.
  const s = await stat(abs).catch(() => null);
  if (s && s.isFile()) return null;

  for (const e of EXT_ORDER) {
    const candidate = abs + e;
    if (await exists(candidate)) return pathToFileURL(candidate).href;
  }
  for (const name of INDEX_ORDER) {
    const candidate = path.join(abs, name);
    if (await exists(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const resolved = await resolveRelative(specifier, context.parentURL);
    if (resolved) return nextResolve(resolved, context);
  }
  return nextResolve(specifier, context);
}
