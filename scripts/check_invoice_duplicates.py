#!/usr/bin/env python3
"""Flag re-downloaded duplicate invoice files before anything totals them.

The hazard
----------
Downloading the same invoice twice from a vendor portal leaves
`EnterpriseInvoice-759874280.pdf` beside `EnterpriseInvoice-759874280 (1).pdf`,
`(2)`, `(3)` — byte-identical, different filenames. The invoice archive
currently holds **53 PDFs for 35 invoices**, with 759874280 present four times.

`ingest_sysco_invoice_pdfs.py` is safe from this: it keys on
`(invoice, description)` and reads an explicit invoice list. But anything that
totals the folder — a spreadsheet, an accountant, `du`, a glob in a one-off
script — overstates purchases by the duplicated amount. On the current archive
that is **$56,926 against $112,473 of real spend, a 34% overstatement**.

This is a filesystem hygiene check, not an ingest. It reads nothing but names
and hashes.

Usage
-----
    python scripts/check_invoice_duplicates.py <dir> [<dir> ...] [--json]

Exits 1 when duplicates are found so it can gate a pipeline, 0 when clean.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

# "EnterpriseInvoice-759874280 (2).pdf" -> "759874280"
# "Sysco Invoice 759910400.pdf"         -> "759910400"
# "invoice_15981556P (1).PDF"           -> "15981556P"
COPY_SUFFIX = re.compile(r'\s*\((\d+)\)\s*$')
KNOWN_PREFIXES = re.compile(
    r'^(EnterpriseInvoice[-_]|Sysco[\s_]Invoice[\s_]|invoice[-_])', re.IGNORECASE
)


def invoice_key(path: Path) -> str:
    """Normalise a filename down to the invoice it represents."""
    stem = path.stem
    stem = COPY_SUFFIX.sub('', stem)
    stem = KNOWN_PREFIXES.sub('', stem)
    return stem.strip().upper()


def file_digest(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        while True:
            block = handle.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def scan(directories: list[Path], suffixes: tuple[str, ...] = ('.pdf',)) -> dict:
    groups: dict[str, list[Path]] = defaultdict(list)
    for directory in directories:
        if not directory.exists():
            continue
        for path in sorted(directory.rglob('*')):
            if path.is_file() and path.suffix.lower() in suffixes:
                groups[invoice_key(path)].append(path)

    duplicates = []
    for key, paths in sorted(groups.items()):
        if len(paths) < 2:
            continue
        # Keep the un-suffixed original. Plain sorting does the opposite: a
        # space sorts before a dot, so "...759874280 (1).pdf" lands ahead of
        # "...759874280.pdf" and the copy would be kept over the original.
        paths.sort(key=lambda p: (COPY_SUFFIX.search(p.stem) is not None, p.name))
        digests = {p: file_digest(p) for p in paths}
        identical = len(set(digests.values())) == 1
        duplicates.append({
            'invoice': key,
            'copies': len(paths),
            'identical': identical,
            'keep': str(paths[0]),
            'redundant': [str(p) for p in paths[1:]],
            'wasted_bytes': sum(p.stat().st_size for p in paths[1:]),
        })

    total_files = sum(len(v) for v in groups.values())
    return {
        'files': total_files,
        'invoices': len(groups),
        'duplicate_groups': duplicates,
        'redundant_files': total_files - len(groups),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('directories', nargs='+', help='invoice directories to scan')
    parser.add_argument('--json', action='store_true', help='machine-readable output')
    parser.add_argument('--suffix', action='append', default=None,
                        help='file suffix to consider (default .pdf; repeatable)')
    args = parser.parse_args(argv)

    suffixes = tuple(
        s if s.startswith('.') else f'.{s}'
        for s in (args.suffix or ['.pdf'])
    )
    report = scan([Path(d) for d in args.directories], suffixes)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"{report['files']} file(s), {report['invoices']} distinct invoice(s)")
        if not report['duplicate_groups']:
            print('  no duplicates')
        for group in report['duplicate_groups']:
            state = 'byte-identical' if group['identical'] else 'DIFFERENT CONTENT'
            print(f"  {group['invoice']}: {group['copies']} copies — {state}")
            for redundant in group['redundant']:
                print(f'      redundant: {Path(redundant).name}')
            if not group['identical']:
                print('      ^ same invoice number, different bytes — check before deleting')
        if report['duplicate_groups']:
            print(
                f"\n  {report['redundant_files']} redundant file(s). Any total taken "
                f"over this folder without de-duplicating by invoice number is "
                f"overstated."
            )

    return 1 if report['duplicate_groups'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
