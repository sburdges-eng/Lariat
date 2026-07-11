// Static query-name extraction from lib/dbQueryRegistry.ts for plain-Node
// eval tooling (same static-parse approach as
// scripts/validate-db-query-registry.py — the registry is TS, these scripts
// are .mjs with no TS loader).
import { readFileSync } from 'node:fs';

export function loadRegistryQueryNames(
  registryPath = new URL('../../lib/dbQueryRegistry.ts', import.meta.url),
) {
  const src = readFileSync(registryPath, 'utf8');
  // Query entries carry `name:` as a standalone key at 4-space indent; param
  // names appear inline (`{ name: 'hours', … }`) and never match this shape.
  const names = [...src.matchAll(/^ {4}name: '([a-z0-9_]+)',$/gm)].map((m) => m[1]);
  if (names.length === 0) {
    throw new Error(
      `no query names parsed from ${registryPath} — registry format drift; ` +
      'fix this parser or the db_query name gate is void',
    );
  }
  return names;
}
