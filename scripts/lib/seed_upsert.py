"""Shared upsert driver for the data/seeds/*.csv → sqlite seed scripts.

Rationale (debt D2 from docs/MAPPING_ENGINE_GAPS.md)
----------------------------------------------------
`scripts/seed_ingredient_{densities,yields,unit_weights}.py` and
`scripts/ingest_catch_weights.py` all share the same skeleton:

    1. Verify CSV exists; verify DB exists.
    2. Pre-check CSV shape (header exact match + per-row field count)
       — "I1 shape guard" that catches pandas silently padding a
       hand-edited row with a missing column.
    3. `pd.read_csv(..., dtype=str, keep_default_na=False)`.
    4. Per-row validation loop. Skip + warn on empty normalized key;
       raise ValueError on any validation failure.
    5. Single-transaction batch UPSERT with rollback on exception.
    6. Write a `"<script>: read=N upserted=N skipped=N"` stderr summary.

Pre-refactor, that skeleton was copy-pasted four times. The I1 shape
guard was added to two of the four in lockstep; a drift-risk flagged
as debt D2. This module collapses the skeleton into a single
``SeedSpec`` dataclass + ``seed_upsert_main`` driver so a future fix
lands in one place.

Design
------
Each row of a seed CSV is described by a tuple of ``ColumnSpec``s.
Each column carries:

  - ``csv_name``: the CSV header column label
  - ``db_column``: the SQL column it maps to (defaults to csv_name)
  - ``coerce``:  str → typed value (float / str / …); default str
  - ``validate``: typed value → bool; raises ValueError if False
  - ``null_on_empty``: if True, empty-string CSV cells become SQL NULL
  - ``persist``: if False, the column is read (so shape-check still
    validates its presence) but not written to the DB — used for
    provenance-only columns like ``notes`` in the densities CSV
  - ``normalize_to_key``: if True, the value is run through
    ``normalize_fn`` and the result becomes the primary-key piece.
    Rows whose normalized key is empty are skipped with a warning.
  - ``post_normalize``: optional callable applied after coerce/validate
    for things like ``normalize_unit`` on the unit weights CSV.
  - ``required``: if True (default), the value must be non-empty
    after coerce.  ``null_on_empty=True`` implicitly sets this False.

A ``SeedSpec`` pulls those columns together with the table name,
the ON CONFLICT target, the shared normalize function, any injected
constant columns (e.g. ``vendor='sysco'``), and a friendly script
name used for the stderr summary line.

The four existing scripts become ~40-line thin callers; the
CSV-shape pre-check, the per-row validation, the UPSERT SQL
construction, and the transaction/rollback boundary all live here.

Byte-exact compatibility
------------------------
The existing tests in tests/python/test_seed_ingredient_*.py and
tests/python/test_ingest_catch_weights.py are the ground truth;
this module is implemented to keep every stderr line, every
ValueError message substring, every exit code, and every UPSERT
side-effect byte-identical to the pre-refactor scripts.
"""
from __future__ import annotations

import argparse
import csv
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Sequence

import pandas as pd


# ---------------------------------------------------------------------------
# Source-enum constants shared across the seed scripts
# ---------------------------------------------------------------------------

# densities + unit_weights share this triple; yields uses a different one.
ALLOWED_SEED_SOURCES: frozenset[str] = frozenset({"seed", "measured", "vendor"})


# ---------------------------------------------------------------------------
# ColumnSpec / SeedSpec
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ColumnSpec:
    """Describes one column of the seed CSV.

    Attributes:
        csv_name:       Header label in the CSV.
        db_column:      Target SQL column; defaults to csv_name.  Used when
                        the CSV column name doesn't match the DB column
                        (e.g. ``sysco_net_wt_lb`` → ``catalog_wt_lb``).
        coerce:         str → typed value.  Defaults to ``str``.
        validate:       Typed value → bool.  Return False to fail the row.
                        None means no extra validation.  Validation runs
                        after ``post_normalize`` (if any).
        validate_msg:   Suffix appended to the ValueError when ``validate``
                        returns False.  ``"must be > 0"`` / etc.
        persist:        If False, the column is read (so shape-check still
                        validates its presence) but not written to the DB.
        null_on_empty:  If True, empty-string CSV cells are stored as SQL NULL
                        instead of raising.  Only makes sense with ``persist``.
        normalize_to_key: If True, the coerced value is run through the
                        SeedSpec's ``normalize_fn`` and contributes to
                        the primary key tuple.  Rows whose normalized key
                        is empty are skipped with a stderr warning.
        post_normalize: Optional callable applied after coerce and BEFORE
                        validate.  Used for ``normalize_unit`` on the
                        ``unit`` column of ingredient_unit_weights.
        post_normalize_empty_msg: Error message if post_normalize returns
                        an empty string (typo at seed time).
        required:       If True, the raw stripped cell must be non-empty
                        when persist=True and null_on_empty=False.
    """

    csv_name: str
    db_column: str | None = None
    coerce: Callable[[str], Any] = str
    validate: Callable[[Any], bool] | None = None
    validate_msg: str = "validation failed"
    persist: bool = True
    null_on_empty: bool = False
    normalize_to_key: bool = False
    post_normalize: Callable[[str], str] | None = None
    post_normalize_empty_msg: str | None = None
    required: bool = True

    @property
    def target_column(self) -> str:
        return self.db_column if self.db_column is not None else self.csv_name


@dataclass(frozen=True)
class SeedSpec:
    """Describes one seed script's table, CSV contract, and validation.

    Attributes:
        script_name:        Used for the stderr summary line
                            (``"<script_name>: read=N upserted=N skipped=N"``).
                            Matches the existing pre-refactor log prefix.
        table_name:         SQL table name.
        columns:            Ordered tuple of ColumnSpecs, in CSV-header order.
        on_conflict_columns: Columns used in the ``ON CONFLICT(...)`` target.
                            Composite PKs are supported
                            (e.g. ``('vendor', 'sku')``).
        normalize_fn:       Callable for any column with
                            ``normalize_to_key=True``.  Default: identity.
        injected_columns:   Mapping of db-column → static Python value
                            prepended to every row's INSERT
                            (e.g. ``{'vendor': <cli arg>}``).  These don't
                            appear in the CSV.
        default_db:         Default value for ``--db`` CLI arg.
        default_csv:        Default value for ``--csv`` CLI arg.
        extra_cli_args:     Optional callable that registers additional CLI
                            args (e.g. ``--vendor``) and returns a dict of
                            the parsed values to be merged into
                            ``injected_columns`` at runtime.
        empty_key_message_override: If set, replaces the default
                            ``"WARN row {idx}: {id_label}={raw!r} normalizes
                            to empty key; skipping"`` stderr message when a
                            normalize_to_key column produces an empty key.
                            The override must be a format string accepting
                            ``{idx}`` as a single positional replacement.
                            Example: ``"WARN row {idx}: empty sku; skipping"``.
    """

    script_name: str
    table_name: str
    columns: tuple[ColumnSpec, ...]
    on_conflict_columns: tuple[str, ...]
    normalize_fn: Callable[[str], str] = lambda s: s
    injected_columns: dict[str, Any] = field(default_factory=dict)
    default_db: Path | None = None
    default_csv: Path | None = None
    extra_cli_args: Callable[[argparse.ArgumentParser], None] | None = None
    empty_key_message_override: str | None = None


# ---------------------------------------------------------------------------
# Core driver
# ---------------------------------------------------------------------------


def assert_csv_shape(csv_path: Path, expected_columns: Sequence[str]) -> None:
    """Verify CSV header exactly matches ``expected_columns`` and every
    data row has exactly ``len(expected_columns)`` fields.

    pandas.read_csv silently pads missing fields when using dtype=str /
    keep_default_na=False, so a hand-edited row with a missing column
    would shift downstream values (e.g. notes land in source) and
    produce a misleading validation error. This pre-check fails loud,
    naming the CSV path, the offending line number, and the actual
    vs expected field count.

    Raises:
        ValueError: if the CSV is empty, the header is wrong, or any
            data row has the wrong number of fields.
    """
    expected = list(expected_columns)
    n_expected = len(expected)
    with csv_path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        try:
            header = next(reader)
        except StopIteration:
            raise ValueError(f"CSV {csv_path} is empty (no header row)")
        if header != expected:
            raise ValueError(
                f"CSV {csv_path} header mismatch: got {header!r}, "
                f"expected {expected!r}"
            )
        # line 1 = header; data rows start at line 2
        for line_no, fields in enumerate(reader, start=2):
            # Skip completely blank trailing lines (e.g. final newline).
            if len(fields) == 0:
                continue
            if len(fields) != n_expected:
                raise ValueError(
                    f"CSV {csv_path} line {line_no}: got {len(fields)} "
                    f"fields, expected {n_expected} "
                    f"(columns={expected}); offending row={fields!r}"
                )


def _build_upsert_sql(
    spec: SeedSpec,
    effective_injected: dict[str, Any] | None = None,
) -> tuple[str, list[str]]:
    """Build the INSERT ... ON CONFLICT statement + ordered bind-names.

    Returns (sql_text, bind_column_names) where bind_column_names is
    the list of DB columns in INSERT-value order.  Callers build the
    per-row tuple by iterating bind_column_names in order.

    ``effective_injected`` overrides ``spec.injected_columns`` at
    call time — used when CLI args (e.g. ``--vendor``) override the
    spec's static defaults.  Pass ``None`` to use ``spec.injected_columns``
    directly (default, for callers that don't inject at runtime).

    The SQL always appends ``updated_at = datetime('now')`` on both
    INSERT and UPDATE paths — every seed table has this column in the
    pre-refactor DDL.
    """
    persisted_cols = [c.target_column for c in spec.columns if c.persist]
    # Injected columns go first so constant values (e.g. vendor) precede
    # CSV-sourced values; this matches the pre-refactor ordering in
    # ingest_catch_weights.
    resolved_injected = effective_injected if effective_injected is not None else spec.injected_columns
    injected_cols = list(resolved_injected.keys())
    all_cols = injected_cols + persisted_cols

    col_sql = ", ".join(all_cols + ["updated_at"])
    placeholders = ", ".join(["?"] * len(all_cols) + ["datetime('now')"])
    conflict_target = ", ".join(spec.on_conflict_columns)
    # UPDATE-set for every column NOT in the ON CONFLICT target; every
    # seed schema also bumps updated_at on conflict.
    set_cols = [c for c in all_cols if c not in spec.on_conflict_columns]
    set_parts = [f"{c} = excluded.{c}" for c in set_cols]
    set_parts.append("updated_at = datetime('now')")
    set_sql = ",\n                    ".join(set_parts)

    sql = (
        f"\n                INSERT INTO {spec.table_name} ({col_sql})\n"
        f"                VALUES ({placeholders})\n"
        f"                ON CONFLICT({conflict_target}) DO UPDATE SET\n"
        f"                    {set_sql}\n                "
    )
    return sql, all_cols


def _validate_row(
    spec: SeedSpec,
    idx: int,
    row: pd.Series,
) -> tuple[dict[str, Any] | None, bool, str]:
    """Validate one CSV row.

    Returns (value_map, skip, reason) where:
      - value_map: dict[db_column -> Python value] or None if skipping.
      - skip: True iff the row should be skipped (empty normalized key).
      - reason: identifier key used for the `raw_name` in error prefixes
        (first normalize_to_key column's raw CSV value; falls back to
        the first column's raw value).
    """
    # Pick an identifying raw value for error messages. Matches the
    # pre-refactor "ingredient_name=..." / "sku=..." prefix shape.
    key_source_col: ColumnSpec | None = None
    for c in spec.columns:
        if c.normalize_to_key:
            key_source_col = c
            break
    if key_source_col is None:
        # No normalization column; use the first column as identifier.
        key_source_col = spec.columns[0]
    raw_key_value = str(row[key_source_col.csv_name])
    # Error prefix's "name=<repr>" uses the column label for the key.
    id_label = key_source_col.csv_name
    err_prefix_name = f"{id_label}={raw_key_value!r}"

    values: dict[str, Any] = {}
    skipped_key_empty = False
    # Track the identifier as we go; used for empty-sku / empty-key
    # warning messages.
    for col in spec.columns:
        raw = row[col.csv_name]
        # Every pre-refactor script stringifies + strips before coerce.
        s = str(raw).strip() if raw is not None else ""

        if col.normalize_to_key:
            # Apply normalize_fn to the unstripped raw value (pre-refactor
            # behavior: normalize_one handles lower/strip itself, and the
            # ingest_catch_weights sku path uses the raw stripped string).
            raw_for_norm = str(raw)
            normalized = spec.normalize_fn(raw_for_norm)
            if not normalized:
                # Skip + warn.  Use the override message if provided,
                # otherwise emit the generic "normalizes to empty key" text.
                if spec.empty_key_message_override is not None:
                    warn_msg = spec.empty_key_message_override.format(idx=idx)
                else:
                    warn_msg = (
                        f"WARN row {idx}: {id_label}={raw!r} normalizes to empty key; skipping"
                    )
                print(warn_msg, file=sys.stderr)
                skipped_key_empty = True
                return None, True, err_prefix_name
            if col.persist:
                values[col.target_column] = normalized
            continue

        # Non-key column.
        if col.null_on_empty and s == "":
            if col.persist:
                values[col.target_column] = None
            continue

        if col.persist and col.required and s == "":
            # This happens when a row has a truly empty cell for a
            # required-non-nullable column.  The pre-refactor scripts
            # fall through to coerce("") which float("") raises on.
            # Preserve that behavior: let coerce raise.
            pass

        # Coerce.  Wrap numeric coercion failures in the pre-refactor
        # ValueError shape:
        #   row <idx>: <id_label>=<raw_key!r> <csv_name>=<s!r> is not a number
        try:
            coerced = col.coerce(s)
        except ValueError as e:
            if col.coerce is float:
                raise ValueError(
                    f"row {idx}: {err_prefix_name} {col.csv_name}={s!r} is not a number"
                ) from e
            raise

        # Post-normalize (e.g. normalize_unit on the unit column).
        # Track the pre-normalize value so validate errors can show
        # both the raw CSV value and the canonical form.
        pre_normalize_coerced: Any = None
        if col.post_normalize is not None:
            normalized = col.post_normalize(coerced)
            if not normalized:
                msg = col.post_normalize_empty_msg or (
                    f"{col.csv_name} normalizes to empty"
                )
                raise ValueError(
                    f"row {idx}: {err_prefix_name} {col.csv_name}={coerced!r} "
                    + msg
                )
            pre_normalize_coerced = coerced
            coerced = normalized

        # Validate.
        if col.validate is not None:
            if not col.validate(coerced):
                # When post_normalize was applied, preserve the
                # <csv_name>=<raw!r> (canonical=<coerced!r>) shape so
                # the error shows both what the user typed and what it
                # normalized to.
                if pre_normalize_coerced is not None:
                    col_repr = (
                        f"{col.csv_name}={pre_normalize_coerced!r}"
                        f" (canonical={coerced!r})"
                    )
                else:
                    col_repr = f"{col.csv_name}={coerced!r}"
                raise ValueError(
                    f"row {idx}: {err_prefix_name} {col_repr} {col.validate_msg}"
                )

        if col.persist:
            values[col.target_column] = coerced
        # Non-persisted columns are intentionally dropped (e.g. notes on
        # densities / unit_weights).

    _ = skipped_key_empty
    return values, False, err_prefix_name


def seed_upsert_main(
    spec: SeedSpec,
    db_path: Path,
    csv_path: Path,
    **injected: Any,
) -> int:
    """Execute the seed for ``spec`` against ``db_path`` and ``csv_path``.

    ``injected`` keyword args override ``spec.injected_columns`` values
    at call time — used by ingest_catch_weights's ``--vendor`` CLI arg.

    Returns:
        0 on success.
        1 if the CSV or DB is missing on disk (after writing a stderr
          message, matching pre-refactor behavior).

    Raises:
        ValueError: on shape mismatch, header mismatch, or any per-row
            validation failure.  Transaction is rolled back before the
            exception bubbles out.
    """
    if not csv_path.is_file():
        print(f"CSV not found: {csv_path}", file=sys.stderr)
        return 1
    if not db_path.exists():
        print(f"DB not found: {db_path}", file=sys.stderr)
        return 1

    expected_columns = tuple(c.csv_name for c in spec.columns)
    assert_csv_shape(csv_path, expected_columns)

    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    required = set(expected_columns)
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"CSV missing required columns: {sorted(missing)}")

    # Resolve injected-column values: CLI-time overrides trump spec defaults.
    effective_injected: dict[str, Any] = dict(spec.injected_columns)
    effective_injected.update(injected)

    sql, bind_cols = _build_upsert_sql(spec, effective_injected)

    n_read = len(df)
    n_skipped = 0
    validated_rows: list[tuple] = []

    for idx, row in df.iterrows():
        value_map, skip, _name = _validate_row(spec, idx, row)
        if skip:
            n_skipped += 1
            continue
        assert value_map is not None
        # Merge injected constants.
        for k, v in effective_injected.items():
            value_map.setdefault(k, v)
        # Build the tuple in the INSERT-bind order.
        validated_rows.append(tuple(value_map[c] for c in bind_cols))

    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("BEGIN")
        for params in validated_rows:
            conn.execute(sql, params)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    n_upserted = len(validated_rows)
    print(
        f"{spec.script_name}: read={n_read} upserted={n_upserted} skipped={n_skipped}",
        file=sys.stderr,
    )
    return 0


# ---------------------------------------------------------------------------
# CLI helper (used by the thin seed scripts)
# ---------------------------------------------------------------------------


def build_cli(spec: SeedSpec, doc: str | None) -> tuple[Path, Path, dict[str, Any]]:
    """Parse --db / --csv / any extra_cli_args for ``spec`` and return
    (db_path, csv_path, injected_kwargs).

    Thin seed scripts call this in their ``_cli()`` wrapper; keeps each
    script's CLI footprint to ~3 lines.
    """
    p = argparse.ArgumentParser(description=doc)
    p.add_argument(
        "--db", type=Path, default=spec.default_db, help="SQLite DB path"
    )
    p.add_argument(
        "--csv", type=Path, default=spec.default_csv, help="Input CSV path"
    )
    extra_keys: list[str] = []
    if spec.extra_cli_args is not None:
        # The spec's extra_cli_args callable registers extra args on `p`
        # and returns the list of dest-names to harvest.
        maybe_keys = spec.extra_cli_args(p)
        if maybe_keys:
            extra_keys = list(maybe_keys)
    args = p.parse_args()
    injected: dict[str, Any] = {k: getattr(args, k) for k in extra_keys}
    return args.db, args.csv, injected
