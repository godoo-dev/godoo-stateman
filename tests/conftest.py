"""Shared pytest fixtures for godoo-stateman tests.

Session-scoped fixtures for acceptance (integration) tests are defined here
and shared across all test modules via pytest's conftest discovery.
"""

from __future__ import annotations

import pytest
from godoo.testcontainers import TestHarness


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
