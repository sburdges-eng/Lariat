/**
 * Recipe photo storage — filesystem + DB pairing.
 *
 * Files live OFF-tree at `data/uploads/recipes/<slug>/<uuid>.<ext>` so they
 * are gitignored and survive recipe-cache rebuilds. The `recipe_photos`
 * table holds the metadata (original name, mime, size, caption, audit).
 *
 * Why not `public/uploads/`:
 *   - Lariat is ops-data sensitive (vendor product photos, plated dishes —
 *     all proprietary). Anything in `public/` is served to anonymous LAN
 *     callers with no PIN gate. We serve photos through an authenticated
 *     `/api/recipes/[slug]/photos/[id]/raw` route instead.
 *   - Keeps the public/ tree clean and grep-able.
 *
 * Storage failure mode: writes to disk are best-effort; the DB row only
 * lands after the file is flushed. A caller that crashes between disk
 * write and DB insert leaves an orphan file (cheap to garbage-collect
 * later by scanning the dir vs the DB). The inverse — DB row without a
 * file — never happens because we never insert before write succeeds.
 */

import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { extname } from 'node:path';
import { uuidv7 } from './uuid.ts';
import { resolveDataDir } from './dataDir.ts';

// Resolve at call time — prod desktop wrapper sets LARIAT_DATA_DIR; dev
// falls back to cwd/data. Photos live in <dataDir>/uploads/recipes/.
function uploadsRoot(): string {
  return path.join(resolveDataDir(), 'uploads', 'recipes');
}

/** 10 MB — covers iPhone/Android JPEGs at full resolution. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Allowed MIME types — image only, mainstream formats. */
export const ALLOWED_PHOTO_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
]);

/** Result of a successful disk write. */
export interface StoredPhoto {
  readonly stored_path: string;   // absolute path on disk
  readonly relative_path: string; // path under data/uploads/recipes
  readonly size_bytes: number;
}

function safeSlug(slug: string): string {
  // The slug comes from a route param. Strip path-separators and dots
  // even though Next decodes URL components — never trust caller input
  // when it lands in a fs.path.join().
  return slug.replace(/[^a-z0-9_-]/gi, '_').slice(0, 64);
}

function extFromMime(mime: string, originalName: string): string {
  // Prefer extension from the original filename when present; fall
  // back to the mime's canonical extension. Both are sanitized.
  const fromName = extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '');
  if (fromName && fromName.length <= 6) return fromName;
  switch (mime) {
    case 'image/jpeg': return '.jpg';
    case 'image/png':  return '.png';
    case 'image/webp': return '.webp';
    case 'image/heic': return '.heic';
    case 'image/heif': return '.heif';
    case 'image/gif':  return '.gif';
    default:           return '.bin';
  }
}

/**
 * Write an uploaded image to disk under data/uploads/recipes/<slug>/.
 * Returns the absolute + relative paths for the DB row.
 *
 * Does NOT touch the DB — caller is responsible for INSERTing the
 * `recipe_photos` row inside its transaction.
 */
export async function storePhoto(
  slug: string,
  bytes: Uint8Array,
  mime: string,
  originalName: string,
): Promise<StoredPhoto> {
  const sslug = safeSlug(slug);
  const dir = path.join(uploadsRoot(), sslug);
  await mkdir(dir, { recursive: true });
  const id = uuidv7();
  const ext = extFromMime(mime, originalName);
  const filename = `${id}${ext}`;
  const abs = path.join(dir, filename);
  await writeFile(abs, bytes);
  return {
    stored_path: abs,
    relative_path: path.join('recipes', sslug, filename),
    size_bytes: bytes.byteLength,
  };
}

/**
 * Stream a stored photo back. Returns the bytes + size, or null when
 * the file is missing (deleted out-of-band or never landed).
 */
export async function readPhoto(storedPath: string): Promise<{ bytes: Buffer; size: number } | null> {
  try {
    const s = await stat(storedPath);
    if (!s.isFile()) return null;
    const bytes = await readFile(storedPath);
    return { bytes, size: s.size };
  } catch {
    return null;
  }
}
