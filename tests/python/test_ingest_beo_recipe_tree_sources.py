"""A recipe the BEO tree cannot read must fail the build, not become an empty node.

`ingest_beo_recipe_tree` fills recipes that the map references but the cache
lacks (Birria, Black Bean Corn Succotash) from source CSVs under
`lariat-data-sources`. It used to fall back to a stub with no ingredients when
that read failed, so a wrong `SRC_DIR` produced a tree where Birria was a real
node with nothing in it — the BEO prep board would show nothing to make for a
braise that takes 8-12 hours.

That was live from the 2026-09-05 root reorganization until this test landed:
`SRC_DIR` pointed at `~/Dev/lariat-data-sources`, and `~/Dev` no longer exists.
It stayed dormant only because `data/cache/recipes.json` happened to carry both
slugs, so the fallback was never reached.

These run against synthetic caches so they do not depend on which slugs the
live cache happens to hold.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    'ingest_beo_recipe_tree', ROOT / 'scripts' / 'ingest_beo_recipe_tree.py'
)


def _load_module():
    """Fresh module instance so a test's monkeypatching cannot leak."""
    module = importlib.util.module_from_spec(_SPEC)
    _SPEC.loader.exec_module(module)
    return module


def _cache_without_gap_slugs(module, tmp: Path) -> Path:
    """The live cache minus the gap slugs, so the source-CSV path is reached."""
    raw = json.loads(module.RECIPES.read_text(encoding='utf-8'))
    rows = raw if isinstance(raw, list) else raw.get('recipes', [])
    thin = [r for r in rows if (r.get('slug') or '') not in module.GAP_META]
    path = tmp / 'recipes.json'
    path.write_text(json.dumps(thin), encoding='utf-8')
    return path


class SourceRecipeGapTests(unittest.TestCase):
    def test_default_source_dir_exists_or_is_overridden(self):
        """The shipped default must point somewhere real on a stock install."""
        module = _load_module()
        self.assertIn(
            'lariat-data-sources',
            str(module.SRC_DIR),
            'SRC_DIR should resolve under lariat-data-sources',
        )
        self.assertNotIn(
            f'{Path.home()}/Dev/',
            f'{module.SRC_DIR}/',
            'SRC_DIR still points at the pre-2026-09-05 ~/Dev root, which does not exist',
        )

    def test_env_var_overrides_the_default(self):
        module = _load_module()
        import os

        prev = os.environ.get('LARIAT_DATA_SOURCES')
        os.environ['LARIAT_DATA_SOURCES'] = '/tmp/some-other-install'
        try:
            reloaded = _load_module()
            self.assertEqual(
                reloaded.SRC_DIR, Path('/tmp/some-other-install/Menu & Recipes')
            )
        finally:
            if prev is None:
                os.environ.pop('LARIAT_DATA_SOURCES', None)
            else:
                os.environ['LARIAT_DATA_SOURCES'] = prev

    def test_unreadable_source_fails_instead_of_stubbing(self):
        module = _load_module()
        with TemporaryDirectory() as td:
            module.RECIPES = _cache_without_gap_slugs(module, Path(td))
            module.SRC_DIR = Path(td) / 'no-such-source'
            with self.assertRaises(module.SourceRecipesMissing) as ctx:
                module.build()
            self.assertEqual(sorted(ctx.exception.slugs), sorted(module.GAP_META))

    def test_real_source_dir_fills_the_gap_with_ingredients(self):
        """Skipped where lariat-data-sources is absent (CI, a fresh clone)."""
        module = _load_module()
        if not module.SRC_DIR.is_dir():
            self.skipTest(f'no source recipes at {module.SRC_DIR}')
        with TemporaryDirectory() as td:
            module.RECIPES = _cache_without_gap_slugs(module, Path(td))
            tree = module.build()
        birria = tree['recipes'].get('birria')
        self.assertIsNotNone(birria, 'birria missing from the rebuilt tree')
        self.assertGreater(
            len(birria.get('ingredients') or []),
            0,
            'birria rebuilt as a node with no ingredients — the prep board would be blank',
        )


if __name__ == '__main__':
    unittest.main()
