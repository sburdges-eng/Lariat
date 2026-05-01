#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

SKIP_DIRS = {
    ".git",
    ".next",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "build",
    "CMakeFiles",
    "dist",
    "external",
    "node_modules",
    "target",
}

CANONICAL_TOP_LEVEL = ["schemaVersion", "seed", "text", "intent"]
CANONICAL_INTENT = ["harmonic", "rhythmic", "dynamic", "tempo"]


def repo_root() -> Path:
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if result.returncode == 0:
        return Path(result.stdout.strip())
    return Path.cwd()


def is_candidate(path: Path) -> bool:
    lowered_parts = {part.lower() for part in path.parts}
    lowered_name = path.name.lower()
    return (
        "schema" in lowered_parts
        or "schemas" in lowered_parts
        or "contracts" in lowered_parts
        or "schema" in lowered_name
        or "contract" in lowered_name
        or "canonical" in lowered_name
    )


def iter_json_candidates(root: Path):
    for current, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        current_path = Path(current)
        for filename in files:
            if not filename.endswith(".json"):
                continue
            path = current_path / filename
            relative = path.relative_to(root)
            if is_candidate(relative):
                yield relative, path


def check_file(relative: Path, path: Path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"{relative}: invalid JSON: {exc}"]

    if not isinstance(data, dict):
        return []

    keys = list(data.keys())
    violations = []

    if "schemaVersion" in data and keys[0] != "schemaVersion":
        violations.append(f"{relative}: schemaVersion must be the first key")

    if is_candidate(relative) and "schema" in str(relative).lower() and "schemaVersion" not in data:
        violations.append(f"{relative}: schema files must define schemaVersion")

    if all(key in data for key in CANONICAL_TOP_LEVEL):
        prefix = keys[: len(CANONICAL_TOP_LEVEL)]
        if prefix != CANONICAL_TOP_LEVEL:
            violations.append(
                f"{relative}: canonical top-level order must be {', '.join(CANONICAL_TOP_LEVEL)}"
            )

        intent = data.get("intent")
        if isinstance(intent, dict):
            intent_keys = list(intent.keys())[: len(CANONICAL_INTENT)]
            if intent_keys != CANONICAL_INTENT:
                violations.append(
                    f"{relative}: intent order must be {', '.join(CANONICAL_INTENT)}"
                )
        else:
            violations.append(f"{relative}: intent must be an object")

    return violations


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="run read-only validation")
    parser.add_argument("--json", action="store_true", help="emit machine-readable report")
    args = parser.parse_args()

    root = repo_root()
    violations = []
    checked = 0
    for relative, path in iter_json_candidates(root):
        checked += 1
        violations.extend(check_file(relative, path))

    if args.json:
        status = "fail" if violations else "pass"
        print(
            json.dumps(
                {
                    "schemaVersion": "lariat.governance.report.v1",
                    "status": status,
                    "check": "json-order",
                    "checked": checked,
                    "violations": violations,
                },
                separators=(",", ":"),
            )
        )
    elif violations:
        print("BUILD_BLOCKED: canonical JSON ordering violations found")
        for violation in violations:
            print(violation)
    else:
        print(f"Canonical JSON order OK ({checked} candidate files checked).")

    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
