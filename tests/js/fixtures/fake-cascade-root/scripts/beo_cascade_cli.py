#!/usr/bin/env python3
"""Test stub for lib/beoCascade.ts — NOT the real cascade engine.

Ignores its CLI argument and stdin payload and emits a canned cascade response
that includes the `warnings` (graceful-degradation) channel. This lets
tests/js/test-beo-cascade.mjs pin that the TS wrapper actually *parses*
`warnings` out of the CLI output, without depending on live recipe data that
happens to degrade.

Selected via `LARIAT_ROOT` pointing at this fixture root, so the wrapper builds
`<root>/scripts/beo_cascade_cli.py` == this file and runs it under real python3.
"""

import json
import sys

# Drain stdin so the wrapper's stdin.end() never triggers EPIPE.
sys.stdin.read()

json.dump(
    {
        "order_guide": [],
        "prep_demands": [],
        "unmapped": [],
        "warnings": [
            "recipe 'beer_batter' yields in 'qt' but demand asked for 5.0 'lb'"
        ],
        "manifest_warnings": [],
    },
    sys.stdout,
)
sys.stdout.write("\n")
