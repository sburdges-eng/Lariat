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
import os
from pathlib import Path

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
