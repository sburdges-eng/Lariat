"""Both Sysco costing scripts must fail loudly when their output is incomplete.

Each one already detects the problem and prints it to stderr — dropped orders in
the parser, unresolved descriptions in the classifier — and then returned 0
anyway, having already written the output file with that spend missing.

That combination is the dangerous one. A cron or regeneration step checking the
exit status sees success, ingests the short file, and the food numerator is
quietly understated. The classifier's own message says the rows "must be
resolved before quoting a food cost", so the run knows it is not safe to use.

These tests pin the exit contract: silence means complete.
"""

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import classify_sysco_lines, parse_sysco_emails  # noqa: E402

LINE_FIELDS = ['description', 'extended_price', 'order_date']


def _write_lines(path: Path, rows: list[dict]) -> None:
    with path.open('w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=LINE_FIELDS)
        w.writeheader()
        w.writerows(rows)


def _known_description() -> str:
    """A description the classifier already resolves, so it is not a problem row."""
    return next(iter(classify_sysco_lines.OVERRIDES))


class TestClassifierExitCode:
    def test_exits_nonzero_while_spend_is_unresolved(self, tmp_path, monkeypatch, capsys):
        lines = tmp_path / 'lines.csv'
        _write_lines(lines, [
            {'description': _known_description(),
             'extended_price': '100.00', 'order_date': '05/06/2026'},
            # Nothing in OVERRIDES or the keyword table will claim this.
            {'description': 'ZZZ UNCLASSIFIABLE MYSTERY GOODS',
             'extended_price': '250.00', 'order_date': '05/06/2026'},
        ])
        monkeypatch.setattr(sys, 'argv', ['classify_sysco_lines.py', str(lines)])

        assert classify_sysco_lines.main() != 0, (
            'unresolved spend must fail the run, not just warn on stderr'
        )
        assert 'unresolved' in capsys.readouterr().err

    def test_exits_zero_when_every_description_resolves(self, tmp_path, monkeypatch):
        lines = tmp_path / 'lines.csv'
        _write_lines(lines, [
            {'description': _known_description(),
             'extended_price': '100.00', 'order_date': '05/06/2026'},
        ])
        monkeypatch.setattr(sys, 'argv', ['classify_sysco_lines.py', str(lines)])

        assert classify_sysco_lines.main() == 0


class TestParserExitCode:
    """The parser's loss signal is `dedupe`'s second return value.

    Driven through `dedupe` rather than a fabricated order email: the exit
    contract is what is under test, not the HTML parsing that feeds it.
    """

    def _run(self, tmp_path, monkeypatch, lost: list[dict]) -> int:
        thread = tmp_path / 'thread.json'
        thread.write_text(json.dumps({'id': 't1', 'messages': []}))
        out = tmp_path / 'out' / 'lines.csv'
        monkeypatch.setattr(parse_sysco_emails, 'dedupe', lambda orders: ([], lost))
        monkeypatch.setattr(sys, 'argv', [
            'parse_sysco_emails.py', str(thread), '-o', str(out),
        ])
        return parse_sysco_emails.main()

    def test_exits_nonzero_when_an_order_is_dropped(self, tmp_path, monkeypatch, capsys):
        dropped = [{'order_number': '12345', 'state': 'CO',
                    'line_sum': 812.40, 'printed_total': '905.11'}]
        assert self._run(tmp_path, monkeypatch, dropped) != 0, (
            'a dropped order means the CSV is short — the run must fail'
        )
        assert 'dropped' in capsys.readouterr().err

    def test_exits_zero_when_every_order_reconciled(self, tmp_path, monkeypatch):
        assert self._run(tmp_path, monkeypatch, []) == 0
