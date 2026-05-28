"""Shared pytest fixtures for godoo-stateman tests.

Session-scoped fixtures for acceptance (integration) tests are defined here
and shared across all test modules via pytest's conftest discovery.
"""

from __future__ import annotations

import os
import re

import pytest
from godoo.testcontainers import TestHarness

from godoo_stateman.schema.version import OdooVersion


@pytest.fixture(scope="session")
async def odoo() -> TestHarness:
    """Session-scoped TestHarness fixture that starts a real Odoo 17 + Postgres container.

    Used exclusively by ``@pytest.mark.integration`` acceptance tests.
    The container is started once per test session and torn down at the end.

    Requires Docker to be available. If Docker is unavailable, skip integration tests:
        uv run pytest -m "not integration" -q
    """
    async with TestHarness(snapshot=True) as h:
        yield h


@pytest.fixture(scope="session")
def odoo_version() -> OdooVersion:
    """Session-scoped fixture that parses ODOO_VERSION env into an OdooVersion instance.

    Parsing pattern mirrors ``src/godoo_stateman/cli/commands/snapshot.py:61`` verbatim:
    - Reads ``ODOO_VERSION`` env var (default ``"17.0"``).
    - Validates with ``r"^\\d+\\.\\d+$"`` — same anchored regex as snapshot.py.
    - Calls ``pytest.fail()`` on invalid input (not ``typer.BadParameter`` — no Typer
      context inside tests).
    - Constructs ``OdooVersion(major=..., minor=...)`` with keyword args.

    Scope rationale: session-scoped to match the ``odoo`` fixture; both fixtures are
    created once per test session so integration tests see a consistent OdooVersion
    throughout the container lifetime.

    CI injects ``ODOO_VERSION`` per matrix entry (e.g. ``"17.0"``, ``"18.0"``, ``"19.0"``).
    When unset (local dev without Docker), defaults to ``"17.0"``.
    """
    odoo_version_str = os.environ.get("ODOO_VERSION", "17.0")
    if not re.match(r"^\d+\.\d+$", odoo_version_str):
        pytest.fail(f"ODOO_VERSION must match N.N format (e.g. '17.0'), got: {odoo_version_str!r}")

    parts = odoo_version_str.split(".")
    return OdooVersion(major=int(parts[0]), minor=int(parts[1]))
