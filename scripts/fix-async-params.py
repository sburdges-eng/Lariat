#!/usr/bin/env python3
"""
Fix Next 16 async-params bug across API routes.

Next 15+ made `{ params }` a Promise. Routes that destructure inline and
then access `params.X` / `params?.X` / `const { id } = params` get
undefined at runtime because Promise.id is undefined.

Patch: insert `params = await params;` at the top of each handler that
takes `{ params }` in its second argument. The rest of the handler body
works unchanged because the local `params` binding is now the resolved
object.

Idempotent — skips files that already have `await params`.
"""
import re
import sys
from pathlib import Path

FILES = [
    "app/api/kds/tickets/[id]/bump/route.js",
    "app/api/host/waitlist/[id]/route.js",
    "app/api/reservations/[id]/route.js",
    "app/api/specials/saved/[id]/route.js",
    "app/api/specials/saved/[id]/export/route.js",
    "app/api/gold-stars/[id]/route.ts",
    "app/api/cloud-bridge/dead-letters/[id]/drop/route.js",
    "app/api/cloud-bridge/dead-letters/[id]/requeue/route.js",
    "app/api/performance-reviews/[id]/route.ts",
    "app/api/inventory/counts/[id]/route.js",
    "app/api/inventory/counts/[id]/lines/route.js",
    "app/api/beo/courses/[id]/route.js",
    "app/api/beo/[id]/share-token/route.js",
    "app/api/beo/share/[token]/route.js",
    "app/api/beo/share/[token]/sign/route.js",
    "app/api/dining-tables/[id]/route.js",
    "app/api/prep-tasks/[id]/route.js",
    "app/api/shows/[id]/deal/route.js",
    "app/api/shows/[id]/settlement/route.js",
    "app/api/shows/[id]/settlement/pdf/route.js",
    "app/api/shows/[id]/box-office/route.js",
    "app/api/shows/[id]/box-office/[lineId]/route.js",
    "app/api/shows/[id]/capacity/route.js",
    "app/api/shows/[id]/stage/route.js",
    "app/api/shows/[id]/sound/route.js",
    "app/api/shows/[id]/sound/spl/route.js",
    "app/api/shows/[id]/sound/[sceneId]/route.js",
    "app/api/recipes/[slug]/route.js",
    "app/api/recipes/[slug]/photos/route.js",
    "app/api/recipes/[slug]/photos/[id]/route.js",
    "app/api/recipes/[slug]/photos/[id]/raw/route.js",
]

# Match: optional "export ", then "async function NAME(... { params }... ) {"
# Captures the whole line so we can preserve indentation.
SIG = re.compile(
    r'^(?P<indent>\s*)(?P<head>(?:export\s+)?async\s+function\s+\w+\s*\([^)]*\{\s*params\s*[},][^)]*\)\s*\{)\s*$',
    re.M,
)


def patch(text: str) -> tuple[str, int]:
    """Insert `params = await params;` after each handler open-brace.
    Returns (new_text, count_patched). Skips handlers that already have
    `await params` somewhere in their body."""
    out = []
    last = 0
    patched = 0
    for m in SIG.finditer(text):
        # Locate the body of this function: from the matched `{` to the
        # matching `}` (naive — fine for these route files which don't
        # nest function bodies inside the handler at top level).
        body_start = m.end()
        depth = 1
        i = body_start
        while i < len(text) and depth > 0:
            ch = text[i]
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
            i += 1
        body_end = i  # one past the closing }
        body = text[body_start:body_end]
        if 'await params' in body:
            continue  # already migrated, skip
        out.append(text[last:m.end()])
        out.append('\n' + m.group('indent') + '  params = await params;')
        last = m.end()
        patched += 1
    out.append(text[last:])
    return ''.join(out), patched


def main():
    repo = Path(__file__).resolve().parents[1]
    total = 0
    for rel in FILES:
        p = repo / rel
        if not p.exists():
            print(f"SKIP (missing): {rel}", file=sys.stderr)
            continue
        text = p.read_text()
        new, count = patch(text)
        if count == 0:
            print(f"  noop: {rel}")
            continue
        p.write_text(new)
        print(f"  +{count}: {rel}")
        total += count
    print(f"\ntotal handlers patched: {total}")


if __name__ == '__main__':
    main()
