"""Unit tests for cli/_connection.py (D-04, T-04-01).

read_connection() reads the four GODOO_* vars + ODOO_VERSION. These tests never
read or print the password VALUE — only its presence/length (secrets-handling).
"""

from __future__ import annotations

import pytest

from godoo_stateman.cli._connection import Connection, read_connection
from godoo_stateman.schema.version import OdooVersion

_ALL_VARS = ["GODOO_URL", "GODOO_DB", "GODOO_USER", "GODOO_PASSWORD", "ODOO_VERSION"]


def _set_full_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GODOO_URL", "https://odoo.example.com")
    monkeypatch.setenv("GODOO_DB", "testdb")
    monkeypatch.setenv("GODOO_USER", "admin")
    monkeypatch.setenv("GODOO_PASSWORD", "s3cr3t")


@pytest.mark.parametrize("missing_var", ["GODOO_URL", "GODOO_DB", "GODOO_USER", "GODOO_PASSWORD"])
def test_missing_single_var_reported(monkeypatch: pytest.MonkeyPatch, missing_var: str) -> None:
    _set_full_env(monkeypatch)
    monkeypatch.delenv(missing_var, raising=False)

    connection, missing = read_connection()

    assert connection is None
    assert missing == [missing_var]


def test_all_missing_lists_all(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in _ALL_VARS:
        monkeypatch.delenv(var, raising=False)

    connection, missing = read_connection()

    assert connection is None
    assert missing == ["GODOO_URL", "GODOO_DB", "GODOO_USER", "GODOO_PASSWORD"]


def test_valid_env_builds_connection(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_full_env(monkeypatch)
    monkeypatch.setenv("ODOO_VERSION", "18.0")

    connection, missing = read_connection()

    assert missing == []
    assert isinstance(connection, Connection)
    assert connection.url == "https://odoo.example.com"
    assert connection.db == "testdb"
    assert connection.user == "admin"
    assert connection.odoo_version == OdooVersion(major=18, minor=0)
    # Never assert the password value — only confirm it is non-empty.
    assert len(connection.password) > 0


def test_odoo_version_defaults_to_17(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_full_env(monkeypatch)
    monkeypatch.delenv("ODOO_VERSION", raising=False)

    connection, _ = read_connection()

    assert connection is not None
    assert connection.odoo_version == OdooVersion(major=17, minor=0)


def test_invalid_odoo_version_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_full_env(monkeypatch)
    monkeypatch.setenv("ODOO_VERSION", "17")  # missing minor segment

    with pytest.raises(ValueError, match="N.N format"):
        read_connection()
