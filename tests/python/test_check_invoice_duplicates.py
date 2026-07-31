"""Duplicate invoice-file detection.

Filenames mirror the real archive, where 759874280 is present four times as
byte-identical portal re-downloads.
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.check_invoice_duplicates import (  # noqa: E402
    invoice_key,
    main,
    scan,
)


def write_pdf(directory: Path, name: str, body: bytes = b'%PDF-1.4 invoice') -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_bytes(body)
    return path


def test_copy_suffix_and_vendor_prefix_normalise_to_one_invoice():
    assert invoice_key(Path('EnterpriseInvoice-759874280.pdf')) == '759874280'
    assert invoice_key(Path('EnterpriseInvoice-759874280 (1).pdf')) == '759874280'
    assert invoice_key(Path('EnterpriseInvoice-759874280 (3).pdf')) == '759874280'
    assert invoice_key(Path('Sysco Invoice 759910400.pdf')) == '759910400'
    # Alphanumeric invoice numbers survive intact.
    assert invoice_key(Path('EnterpriseInvoice-15981556P (2).pdf')) == '15981556P'


def test_distinct_invoices_are_never_grouped():
    assert invoice_key(Path('EnterpriseInvoice-759874280.pdf')) != invoice_key(
        Path('EnterpriseInvoice-759874281.pdf')
    )


def test_finds_the_four_copy_group(tmp_path):
    for suffix in ('', ' (1)', ' (2)', ' (3)'):
        write_pdf(tmp_path, f'EnterpriseInvoice-759874280{suffix}.pdf')
    write_pdf(tmp_path, 'EnterpriseInvoice-759910400.pdf', b'%PDF-1.4 other')

    report = scan([tmp_path])
    assert report['files'] == 5
    assert report['invoices'] == 2
    assert report['redundant_files'] == 3

    group = report['duplicate_groups'][0]
    assert group['invoice'] == '759874280'
    assert group['copies'] == 4
    assert group['identical'] is True
    assert len(group['redundant']) == 3


def test_clean_directory_reports_nothing(tmp_path):
    write_pdf(tmp_path, 'EnterpriseInvoice-759910400.pdf', b'a')
    write_pdf(tmp_path, 'EnterpriseInvoice-759916822.pdf', b'b')
    report = scan([tmp_path])
    assert report['duplicate_groups'] == []
    assert report['redundant_files'] == 0


def test_same_number_different_bytes_is_flagged_but_not_called_identical(tmp_path):
    """A revised invoice reissued under the same number is not a safe delete —
    the caller has to look. Reporting it as byte-identical would lose a revision."""
    write_pdf(tmp_path, 'EnterpriseInvoice-759874280.pdf', b'%PDF original')
    write_pdf(tmp_path, 'EnterpriseInvoice-759874280 (1).pdf', b'%PDF revised total')

    group = scan([tmp_path])['duplicate_groups'][0]
    assert group['copies'] == 2
    assert group['identical'] is False


def test_keeps_the_first_and_marks_the_rest_redundant(tmp_path):
    base = write_pdf(tmp_path, 'EnterpriseInvoice-759874280.pdf')
    write_pdf(tmp_path, 'EnterpriseInvoice-759874280 (1).pdf')

    group = scan([tmp_path])['duplicate_groups'][0]
    assert group['keep'] == str(base)
    assert base.name not in [Path(r).name for r in group['redundant']]


def test_scans_nested_directories(tmp_path):
    write_pdf(tmp_path / 'invoices', 'EnterpriseInvoice-759874280.pdf')
    write_pdf(tmp_path / 'invoices' / 'dispute', 'EnterpriseInvoice-759874280 (1).pdf')
    assert scan([tmp_path])['redundant_files'] == 1


def test_ignores_non_pdf_unless_asked(tmp_path):
    write_pdf(tmp_path, 'EnterpriseInvoice-759874280.pdf')
    (tmp_path / 'EnterpriseInvoice-759874280 (1).csv').write_text('x')

    assert scan([tmp_path])['redundant_files'] == 0
    assert scan([tmp_path], suffixes=('.pdf', '.csv'))['redundant_files'] == 1


def test_missing_directory_is_not_an_error(tmp_path):
    report = scan([tmp_path / 'does-not-exist'])
    assert report == {
        'files': 0, 'invoices': 0, 'duplicate_groups': [], 'redundant_files': 0,
    }


def test_exit_code_gates_a_pipeline(tmp_path, capsys):
    write_pdf(tmp_path, 'EnterpriseInvoice-759910400.pdf')
    assert main([str(tmp_path)]) == 0

    write_pdf(tmp_path, 'EnterpriseInvoice-759910400 (1).pdf')
    assert main([str(tmp_path)]) == 1
    assert 'redundant' in capsys.readouterr().out


def test_json_output_is_parseable(tmp_path, capsys):
    import json
    write_pdf(tmp_path, 'EnterpriseInvoice-759874280.pdf')
    write_pdf(tmp_path, 'EnterpriseInvoice-759874280 (1).pdf')

    main([str(tmp_path), '--json'])
    payload = json.loads(capsys.readouterr().out)
    assert payload['duplicate_groups'][0]['invoice'] == '759874280'
    assert payload['duplicate_groups'][0]['wasted_bytes'] > 0
