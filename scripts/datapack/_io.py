"""Shared low-level helpers for the Lariat data-pack normalizers.

Lives next to ``download_all.py`` and the ``normalize_*.py`` scripts. The
helpers here are intentionally small, dependency-free, and have stable
signatures — every normalizer (and the sanity check) imports from here so
that bug fixes propagate in one place rather than being duplicated four
times. (The chunk-format JSON-escape bug landed in `a6c77c9` was a direct
consequence of pre-extraction copy-paste.)
"""

from __future__ import annotations

import hashlib
import heapq
import os
from pathlib import Path
from typing import Callable, Iterable, Iterator, TextIO

# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------

# REPO_ROOT points at the Lariat checkout root: scripts/datapack/_io.py is at
# depth 2 from the repo root.
REPO_ROOT = Path(__file__).resolve().parents[2]
SYMLINK_PATH = REPO_ROOT / "data" / "lariat-data"
DIRECT_PATH = Path("/Volumes/Sean's SSD/lariat-data")


def default_data_root() -> Path:
    """Resolve the data root: prefer the in-repo symlink, fall back to the
    direct SSD path. Returns the symlink path even when nothing exists yet
    so that the caller's first file-open raises a clear error."""
    if SYMLINK_PATH.exists():
        return SYMLINK_PATH.resolve()
    if DIRECT_PATH.exists():
        return DIRECT_PATH
    return SYMLINK_PATH


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------


def sha256_file(path: Path, chunk_size: int = 1 << 20) -> str:
    """SHA-256 of a file, 1 MB chunked reads by default."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for buf in iter(lambda: f.read(chunk_size), b""):
            h.update(buf)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Atomic writes
# ---------------------------------------------------------------------------


def atomic_write_text(path: Path, text: str) -> None:
    """Write atomically: write to .tmp, fsync, os.replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def atomic_replace(tmp: Path, final: Path) -> None:
    """Move ``tmp`` over ``final`` atomically. Caller is responsible for
    fsyncing ``tmp`` before this if durability matters."""
    final.parent.mkdir(parents=True, exist_ok=True)
    os.replace(tmp, final)


# ---------------------------------------------------------------------------
# External merge sort over (key_tuple, json_line) pairs
# ---------------------------------------------------------------------------


# Currently supported key-component types. Each entry is a parser callable
# that turns a raw split-token string into the target Python value. Parsing
# is strict — int(...) raising ValueError on a corrupt chunk should propagate,
# not silently drop the row, because that indicates the on-disk chunk file
# is wrong and we want a loud failure rather than data loss.
_SUPPORTED_KEY_PARSERS: dict[type, Callable[[str], object]] = {
    int: int,
    str: str,
}


def _flush_sort_chunk(
    buf: list[tuple[tuple, str]],
    tmp_dir: Path,
    idx: int,
    key_arity: int,
) -> Path:
    """Sort ``buf`` by key_tuple and flush to ``tmp_dir/chunk-<idx>.tsv``.

    Chunk format per line: ``<key0>\\t<key1>\\t...\\t<keyN-1>\\t<json_line>\\n``.
    json.dumps always escapes control characters, so the json body never
    contains a literal tab or newline — splitting on the first ``key_arity``
    tabs is unambiguous, no escaping needed.
    """
    buf.sort(key=lambda kv: kv[0])
    cp = tmp_dir / f"chunk-{idx:05d}.tsv"
    with open(cp, "w", encoding="utf-8") as f:
        for key_tuple, line in buf:
            # str(int) for int components and str-pass-through for str
            # components both go through the same join — Python's str(int)
            # output never contains a tab.
            f.write("\t".join(str(k) for k in key_tuple))
            f.write("\t")
            f.write(line)
            f.write("\n")
    return cp


def _read_sort_chunk(
    fh: TextIO,
    chunk_idx: int,
    key_types: tuple[type, ...],
) -> Iterator[tuple[tuple, int, str]]:
    """Iterate ``(key_tuple, chunk_idx, json_line)`` from a chunk file.

    Splits each line on tab with ``maxsplit=len(key_types)``. The trailing
    field is the JSON line; everything before it is a key column parsed by
    its corresponding type parser. ``chunk_idx`` is embedded in the yielded
    tuple so heapq.merge has a stable secondary key — when the same
    key_tuple appears in multiple chunks, the earlier-flushed chunk wins
    (which corresponds to earlier-in-source order, the property dedup
    relies on).
    """
    parsers = [_SUPPORTED_KEY_PARSERS[t] for t in key_types]
    arity = len(key_types)
    for raw in fh:
        if not raw:
            continue
        line = raw[:-1] if raw.endswith("\n") else raw
        parts = line.split("\t", arity)
        if len(parts) != arity + 1:
            continue
        key_parts = parts[:arity]
        body = parts[arity]
        key_tuple = tuple(parser(p) for parser, p in zip(parsers, key_parts))
        yield key_tuple, chunk_idx, body


def external_sort_jsonl(
    source: Iterable[tuple[tuple, str]],
    output_path: Path,
    *,
    chunk_rows: int,
    tmp_dir: Path,
    key_types: tuple[type, ...],
    dedup_by_key: bool = False,
    on_emit: Callable[[tuple, str], None] | None = None,
) -> tuple[int, int]:
    """External merge sort of an iterator of ``(key_tuple, json_line)`` pairs.

    Writes the merged sorted output atomically to ``output_path`` (write to
    ``output_path.with_suffix(output_path.suffix + ".tmp")``, fsync, then
    ``os.replace``). Returns ``(emitted, duplicates_skipped)`` — the second
    component is always 0 when ``dedup_by_key=False``.

    Source contract:
        ``source`` yields ``(key_tuple, json_line)``. ``key_tuple``'s
        components must match ``key_types`` in length and type. Supported
        types: ``int``, ``str`` (extend ``_SUPPORTED_KEY_PARSERS`` to add
        more — e.g. ``float`` would need careful round-trip handling).

    Algorithm:
        Buffer ``chunk_rows`` rows in memory, sort by key_tuple, flush to
        a TSV chunk file in ``tmp_dir``. Repeat until the source is
        exhausted. Then ``heapq.merge`` over all chunk iterators streams
        the final sorted output. The merge key is
        ``(key_tuple, chunk_idx, json_line)`` — chunk_idx breaks ties on
        key_tuple by flush order, so the lowest-numbered chunk (= earliest
        source row) wins when ``dedup_by_key=True``.

    Chunk format:
        ``<key0>\\t<key1>\\t...\\t<keyN-1>\\t<json_line>\\n``. No tab or
        newline escaping is done because json.dumps' output cannot contain
        literal tabs or newlines (control chars are always escaped) and
        ``str(int)`` output is digits-only. Splitting on the first N tabs
        is unambiguous.

    Dedup:
        With ``dedup_by_key=True``, when a merged row's key_tuple equals
        the previously-emitted key_tuple, the row is skipped (not written,
        ``on_emit`` not called) and the duplicates_skipped counter is
        incremented. Equality is full-tuple equality.

    on_emit hook:
        If provided, ``on_emit(key_tuple, json_line)`` is called for each
        row that is actually written to output (post-dedup). It is the
        caller's hook for in-merge aggregations (e.g. OFF's allergen
        counter, which must only count emitted rows).

    Empty source:
        Still produces an empty ``output_path`` (atomically) and returns
        ``(0, 0)`` — caller's downstream sha256 / manifest steps don't
        need to special-case the empty case.

    Errors:
        Source-iterator exceptions propagate. Chunk-write exceptions
        propagate. ``on_emit`` exceptions propagate. Corrupt chunk lines
        (wrong column count) are silently skipped — this matches the
        prior in-script behavior. Corrupt key types raise ``ValueError``
        from the parser, which propagates; that indicates the on-disk
        chunk file is malformed and we want a loud failure rather than
        data loss. On any exception raised during the merge phase
        (including ``KeyboardInterrupt``), the partial
        ``output_path.with_suffix(... + ".tmp")`` file is unlinked
        before the exception propagates — callers can rely on no stale
        ``.tmp`` output being left behind. ``tmp_dir`` chunk cleanup
        remains the caller's responsibility.

    Caller responsibilities:
        - Create ``tmp_dir`` before calling (must be on the same
          filesystem as ``output_path`` for the atomic-replace to be
          atomic).
        - Clean ``tmp_dir`` afterwards — recommend
          ``shutil.rmtree(tmp_dir, ignore_errors=True)`` in a
          ``try/finally`` wrapping the call.
        - Sweep stale ``.tmp_*_sort_*`` siblings of ``output_path`` at
          ``normalize()`` startup (handles SIGKILL'd prior runs that
          skipped the finally cleanup).
    """
    if len(key_types) == 0:
        raise ValueError("external_sort_jsonl requires at least one key column")
    for t in key_types:
        if t not in _SUPPORTED_KEY_PARSERS:
            raise ValueError(
                f"external_sort_jsonl: unsupported key type {t!r}; "
                f"supported: {sorted(p.__name__ for p in _SUPPORTED_KEY_PARSERS)}"
            )
    if chunk_rows < 1:
        raise ValueError(f"chunk_rows must be >= 1, got {chunk_rows}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    chunk_paths: list[Path] = []
    arity = len(key_types)
    buf: list[tuple[tuple, str]] = []
    for key_tuple, line in source:
        buf.append((key_tuple, line))
        if len(buf) >= chunk_rows:
            chunk_paths.append(_flush_sort_chunk(buf, tmp_dir, len(chunk_paths), arity))
            buf = []
    if buf:
        chunk_paths.append(_flush_sort_chunk(buf, tmp_dir, len(chunk_paths), arity))
        buf = []

    emitted = 0
    duplicates_skipped = 0
    last_emitted_key: tuple | None = None
    tmp_out = output_path.with_suffix(output_path.suffix + ".tmp")

    readers: list[TextIO] = []
    try:
        iters: list[Iterator[tuple[tuple, int, str]]] = []
        for i, cp in enumerate(chunk_paths):
            fh = open(cp, "r", encoding="utf-8")
            readers.append(fh)
            iters.append(_read_sort_chunk(fh, i, key_types))

        try:
            with open(tmp_out, "w", encoding="utf-8") as out_f:
                # heapq.merge sorts on natural tuple ordering: first key_tuple,
                # then chunk_idx (so earlier-flushed chunk wins ties), then
                # json_line. The chunk_idx tie-break is what makes
                # dedup_by_key=True deterministic.
                for key_tuple, _chunk_idx, json_line in heapq.merge(*iters):
                    if dedup_by_key and last_emitted_key is not None and key_tuple == last_emitted_key:
                        duplicates_skipped += 1
                        continue
                    out_f.write(json_line)
                    out_f.write("\n")
                    emitted += 1
                    last_emitted_key = key_tuple
                    if on_emit is not None:
                        on_emit(key_tuple, json_line)
                out_f.flush()
                os.fsync(out_f.fileno())
        except BaseException:
            # Don't leave a half-written .tmp behind. tmp_dir cleanup is the
            # caller's responsibility; the .tmp output file is ours.
            try:
                tmp_out.unlink(missing_ok=True)
            except OSError:
                pass
            raise
    finally:
        for r in readers:
            r.close()

    atomic_replace(tmp_out, output_path)
    return emitted, duplicates_skipped


# ---------------------------------------------------------------------------
# Display
# ---------------------------------------------------------------------------


def human_bytes(n: int) -> str:
    """Format a byte count as B / KB / MB / GB / TB / PB (1024-based)."""
    if n < 0:
        return f"{n} B"
    units = ("B", "KB", "MB", "GB", "TB", "PB")
    val = float(n)
    for u in units:
        if val < 1024.0 or u == units[-1]:
            if u == "B":
                return f"{int(val)} {u}"
            return f"{val:.1f} {u}"
        val /= 1024.0
    return f"{n} B"
