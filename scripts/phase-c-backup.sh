#!/usr/bin/env bash
# Phase C Precondition #4 — verified, restore-tested backup of data/lariat.db
# + the JSONL audit dir (docs/superpowers/specs/2026-07-02-lariat-native-
# phase-c-schema-inversion.md, Preconditions #4 and §C6).
#
# SAFE ON A LIVE WAL DATABASE: the DB copy uses sqlite3's `.backup` (the
# online backup API), which takes a consistent snapshot while writers are
# active. NEVER `cp` a live WAL database — the -wal/-shm sidecars race the
# main file and you get a torn copy (scripts/backup.mjs predates this rule).
#
# Usage:
#   scripts/phase-c-backup.sh [backup] [--db PATH] [--audit-dir PATH]
#   scripts/phase-c-backup.sh verify BACKUP_DIR
#
# backup (default mode):
#   - sqlite3 "$DB" ".backup <dest>/lariat.db"
#   - tar -czf <dest>/audit.tar.gz of the audit JSONL dir
#   - SHA256SUMS + manifest.txt, all under
#     ${LARIAT_BACKUP_DIR:-backups}/<UTC timestamp>/
#   Defaults: --db data/lariat.db, --audit-dir data/audit.
#
# verify BACKUP_DIR (the restore drill):
#   - re-checks SHA256SUMS
#   - restores the DB copy to a temp path, runs PRAGMA integrity_check +
#     PRAGMA foreign_key_check
#   - spot-checks that 3 core tables have rows (roster table, locations,
#     audit_events). NB: the web schema has no `staff` table — the roster
#     check resolves the first existing of: staff, entities_employees,
#     sevenshifts_users. Override the whole list with LARIAT_VERIFY_TABLES
#     (space-separated) if the C2 native schema renames them.
#   - checks the audit tarball is readable
#   Prints PASS/FAIL; exit 0 only on PASS.
#
# Exit codes: 0 ok, 1 verification failure, 2 usage/environment error.

set -euo pipefail

die() { echo "phase-c-backup: $*" >&2; exit 2; }

# sha tool: macOS ships shasum, most Linux ships sha256sum. Same format.
if command -v shasum >/dev/null 2>&1; then
  SHA=(shasum -a 256)
elif command -v sha256sum >/dev/null 2>&1; then
  SHA=(sha256sum)
else
  die "need shasum or sha256sum on PATH"
fi

command -v sqlite3 >/dev/null 2>&1 \
  || die "sqlite3 CLI is required (online backup API / integrity_check) — install it first"

MODE="backup"
if [[ $# -gt 0 && "$1" != --* ]]; then
  MODE="$1"
  shift
fi

# ── verify ───────────────────────────────────────────────────────────
if [[ "$MODE" == "verify" ]]; then
  [[ $# -eq 1 ]] || die "usage: phase-c-backup.sh verify BACKUP_DIR"
  BDIR="$1"
  [[ -d "$BDIR" ]] || die "backup dir not found: $BDIR"

  FAIL=0
  note() { echo "  [$1] $2"; [[ "$1" == "FAIL" ]] && FAIL=1 || true; }

  echo "phase-c-backup verify: $BDIR"

  # 1. checksums
  if [[ -f "$BDIR/SHA256SUMS" ]] && (cd "$BDIR" && "${SHA[@]}" -c SHA256SUMS >/dev/null 2>&1); then
    note PASS "SHA256SUMS: all checksums match"
  else
    note FAIL "SHA256SUMS: missing or checksum mismatch"
  fi

  # 2. restore the DB copy to a temp path and check it there
  if [[ -f "$BDIR/lariat.db" ]]; then
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    cp "$BDIR/lariat.db" "$TMP/restored.db"

    IC="$(sqlite3 "$TMP/restored.db" 'PRAGMA integrity_check;' 2>/dev/null || echo 'error')"
    if [[ "$IC" == "ok" ]]; then
      note PASS "integrity_check: ok (restored copy)"
    else
      note FAIL "integrity_check: $IC"
    fi

    FK="$(sqlite3 "$TMP/restored.db" 'PRAGMA foreign_key_check;' 2>/dev/null || echo 'error')"
    if [[ -z "$FK" ]]; then
      note PASS "foreign_key_check: clean"
    else
      note FAIL "foreign_key_check: violations or error: $FK"
    fi

    # 3. core-table row counts > 0
    ROSTER=""
    for cand in staff entities_employees sevenshifts_users; do
      if [[ -n "$(sqlite3 "$TMP/restored.db" "SELECT name FROM sqlite_master WHERE type='table' AND name='$cand';" 2>/dev/null)" ]]; then
        ROSTER="$cand"
        break
      fi
    done
    if [[ -z "$ROSTER" ]]; then
      note FAIL "roster spot-check: none of staff/entities_employees/sevenshifts_users exist"
      ROSTER="staff" # keep the loop below well-formed; it will FAIL on count
    fi
    CORE_TABLES="${LARIAT_VERIFY_TABLES:-$ROSTER locations audit_events}"
    for t in $CORE_TABLES; do
      N="$(sqlite3 "$TMP/restored.db" "SELECT COUNT(*) FROM \"$t\";" 2>/dev/null || echo "-1")"
      if [[ "$N" =~ ^[0-9]+$ && "$N" -gt 0 ]]; then
        note PASS "row count $t: $N"
      else
        note FAIL "row count $t: ${N} (want > 0)"
      fi
    done
  else
    note FAIL "lariat.db missing from backup dir"
  fi

  # 4. audit tarball readable
  if [[ -f "$BDIR/audit.tar.gz" ]] && tar -tzf "$BDIR/audit.tar.gz" >/dev/null 2>&1; then
    note PASS "audit.tar.gz: readable"
  else
    note FAIL "audit.tar.gz: missing or unreadable"
  fi

  if [[ "$FAIL" -eq 0 ]]; then
    echo "phase-c-backup verify: PASS"
    exit 0
  else
    echo "phase-c-backup verify: FAIL"
    exit 1
  fi
fi

# ── backup ───────────────────────────────────────────────────────────
[[ "$MODE" == "backup" ]] || die "unknown mode: $MODE (expected backup|verify)"

DB="data/lariat.db"
AUDIT_DIR="data/audit"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;;
    --audit-dir) AUDIT_DIR="$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -f "$DB" ]] || die "DB not found: $DB"
[[ -d "$AUDIT_DIR" ]] || die "audit dir not found: $AUDIT_DIR (JSONL trail is part of Precondition #4 — refusing a half backup)"

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DEST="${LARIAT_BACKUP_DIR:-backups}/$STAMP"
[[ -e "$DEST" ]] && DEST="${DEST}-$$"
mkdir -p "$DEST"

# Online backup API — consistent even mid-write on a WAL database.
sqlite3 "$DB" ".backup '$DEST/lariat.db'"

tar -czf "$DEST/audit.tar.gz" -C "$(dirname "$AUDIT_DIR")" "$(basename "$AUDIT_DIR")"

(cd "$DEST" && "${SHA[@]}" lariat.db audit.tar.gz > SHA256SUMS)

{
  echo "phase-c backup manifest"
  echo "created_utc: $STAMP"
  echo "source_db: $DB"
  echo "source_audit_dir: $AUDIT_DIR"
  echo "files:"
  ls -l "$DEST" | tail -n +2 | awk '{print "  " $NF "  " $5 " bytes"}'
  echo "sha256:"
  sed 's/^/  /' "$DEST/SHA256SUMS"
} | tee "$DEST/manifest.txt"

echo "phase-c-backup: wrote $DEST"
echo "phase-c-backup: verify with — scripts/phase-c-backup.sh verify '$DEST'"
