import {
  fts,
  escapeFtsPhrase,
  available,
  stats,
  getUsdaFood,
  usdaNutrientsFor,
  getOffProduct,
  getFdaSection,
  getWikibooksPage,
} from '../../../../lib/datapackSearch';

export const dynamic = 'force-dynamic';

const ALLOWED_SOURCES = new Set(['usda', 'off', 'wikibooks', 'fda', 'all']);

const clipQuery = (s) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  // Cap at 240 chars — FTS5 doesn't care, but this stops accidental
  // query-DoS via huge MATCH expressions and bounds latency.
  return t.slice(0, 240);
};

const parseLimit = (raw) => {
  const n = Number.parseInt(raw ?? '20', 10);
  if (!Number.isFinite(n) || n < 1) return 20;
  return Math.min(n, 100);
};

export async function GET(req) {
  if (!available()) {
    return Response.json(
      {
        error: 'Data pack not mounted on this machine',
        hint:
          'Mount the SSD or symlink data/lariat-data and rebuild the indexes.',
      },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const op = url.searchParams.get('op') ?? 'search';

  try {
    if (op === 'stats') {
      return Response.json({ ok: true, stats: stats() });
    }

    if (op === 'usda_food') {
      const fdc = Number.parseInt(url.searchParams.get('fdc_id') ?? '', 10);
      if (!Number.isFinite(fdc)) {
        return Response.json(
          { error: 'fdc_id (int) required' },
          { status: 400 }
        );
      }
      const food = getUsdaFood(fdc);
      if (!food) return Response.json({ error: 'not found' }, { status: 404 });
      const nutrients = usdaNutrientsFor(fdc);
      return Response.json({ ok: true, food, nutrients });
    }

    if (op === 'off_product') {
      const code = clipQuery(url.searchParams.get('code'));
      if (!code) {
        return Response.json({ error: 'code required' }, { status: 400 });
      }
      const product = getOffProduct(code);
      if (!product) {
        return Response.json({ error: 'not found' }, { status: 404 });
      }
      return Response.json({ ok: true, product });
    }

    if (op === 'fda_section') {
      const sectionId = clipQuery(url.searchParams.get('section_id'));
      const rowidRaw = url.searchParams.get('rowid');
      let row = null;
      if (sectionId) {
        row = getFdaSection({ section_id: sectionId });
      } else if (rowidRaw) {
        const rowid = Number.parseInt(rowidRaw, 10);
        if (Number.isFinite(rowid)) row = getFdaSection({ rowid });
      } else {
        return Response.json(
          { error: 'section_id or rowid required' },
          { status: 400 }
        );
      }
      if (!row) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json({ ok: true, section: row });
    }

    if (op === 'wikibooks_page') {
      const title = clipQuery(url.searchParams.get('title'));
      const pageRaw = url.searchParams.get('page_id');
      let row = null;
      if (title) {
        row = getWikibooksPage({ title });
      } else if (pageRaw) {
        const pageId = Number.parseInt(pageRaw, 10);
        if (Number.isFinite(pageId)) row = getWikibooksPage({ page_id: pageId });
      } else {
        return Response.json(
          { error: 'page_id or title required' },
          { status: 400 }
        );
      }
      if (!row) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json({ ok: true, page: row });
    }

    // Default: lexical search.
    const q = clipQuery(url.searchParams.get('q'));
    if (!q) {
      return Response.json({ error: 'q required' }, { status: 400 });
    }

    const sourceParam = url.searchParams.get('source') ?? 'all';
    if (!ALLOWED_SOURCES.has(sourceParam)) {
      return Response.json(
        { error: `invalid source; allowed: ${[...ALLOWED_SOURCES].join(', ')}` },
        { status: 400 }
      );
    }

    const limit = parseLimit(url.searchParams.get('limit'));

    // raw=1 lets the caller pass an FTS5 expression directly (phrase
    // queries, AND/OR/NOT, column filters). Default behavior is to
    // wrap the input as a quoted phrase — safer when the input came
    // from an end user.
    const raw = url.searchParams.get('raw') === '1';
    const ftsQuery = raw ? q : escapeFtsPhrase(q);

    let hits;
    try {
      hits = fts(ftsQuery, { source: sourceParam, limit });
    } catch (err) {
      // FTS5 returns a SQLite error for bad MATCH syntax — surface
      // that as a 400 so the client can fix its query.
      return Response.json(
        { error: 'fts query failed', detail: String(err?.message ?? err) },
        { status: 400 }
      );
    }

    return Response.json({ ok: true, query: q, source: sourceParam, hits });
  } catch (err) {
    console.error('GET /api/datapack/search failed:', err);
    return Response.json(
      { error: 'datapack search failed' },
      { status: 500 }
    );
  }
}
