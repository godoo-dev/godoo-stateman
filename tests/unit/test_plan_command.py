"""Unit tests for the wired plan command — exit codes and CLI surface (UX-02).

All tests monkeypatch ``_plan_impl`` to return controlled exit codes without
requiring a real Odoo connection.  This isolates the Typer wrapper logic from
the async pipeline under test.

asyncio_mode = "auto" in pyproject.toml — no @pytest.mark.asyncio needed.

Covers: UX-01 (non-regression), UX-02 (exit codes 0/2/1)
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from typer.testing import CliRunner

from godoo_stateman.cli.app import app

runner = CliRunner()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_temp_config(content: str = 'xmlid_prefix = "test_prefix"\n') -> str:
    """Write a temporary .py config file and return its path."""
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
        f.write(content)
        return f.name


# ---------------------------------------------------------------------------
# Test 1: exit code 0 when _plan_impl returns 0 (all NoOp — no changes)
# ---------------------------------------------------------------------------


def test_plan_exit_code_zero_on_all_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    """plan command exits 0 when _plan_impl returns 0 (all resources unchanged)."""
    config_path = _make_temp_config()

    async def _mock_impl(config: Path, verbose: bool) -> int:
        return 0

    monkeypatch.setattr("godoo_stateman.cli.commands.plan._plan_impl", _mock_impl)
    result = runner.invoke(app, ["plan", config_path])
    assert result.exit_code == 0, (
        f"Expected exit 0 for all-NoOp plan, got {result.exit_code}:\n{result.output}"
    )


# ---------------------------------------------------------------------------
# Test 2: exit code 2 when _plan_impl returns 2 (changes pending)
# ---------------------------------------------------------------------------


def test_plan_exit_code_two_on_changes(monkeypatch: pytest.MonkeyPatch) -> None:
    """plan command exits 2 when _plan_impl returns 2 (pending changes)."""
    config_path = _make_temp_config()

    async def _mock_impl(config: Path, verbose: bool) -> int:
        return 2

    monkeypatch.setattr("godoo_stateman.cli.commands.plan._plan_impl", _mock_impl)
    result = runner.invoke(app, ["plan", config_path])
    assert result.exit_code == 2, (
        f"Expected exit 2 for plan with changes, got {result.exit_code}:\n{result.output}"
    )


# ---------------------------------------------------------------------------
# Test 3: exit code 1 when _plan_impl raises an exception
# ---------------------------------------------------------------------------


def test_plan_exit_code_one_on_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    """plan command exits 1 when _plan_impl raises an unhandled exception."""
    config_path = _make_temp_config()

    async def _mock_impl(config: Path, verbose: bool) -> int:
        raise RuntimeError("Unexpected failure")

    monkeypatch.setattr("godoo_stateman.cli.commands.plan._plan_impl", _mock_impl)
    result = runner.invoke(app, ["plan", config_path])
    assert result.exit_code == 1, (
        f"Expected exit 1 on exception, got {result.exit_code}:\n{result.output}"
    )


# ---------------------------------------------------------------------------
# Test 4: --help still lists all 5 commands (UX-01 non-regression)
# ---------------------------------------------------------------------------


def test_help_still_lists_all_five_commands() -> None:
    """plan command change must not break --help command listing (UX-01)."""
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for command in ("plan", "apply", "verify", "import", "snapshot"):
        assert command in result.output, (
            f"Command '{command}' missing from --help:\n{result.output}"
        )


# ---------------------------------------------------------------------------
# Test 5: plan --help shows config argument and --verbose option
# ---------------------------------------------------------------------------


def test_plan_help_shows_config_and_verbose() -> None:
    """plan --help must document the config argument and --verbose option."""
    result = runner.invoke(app, ["plan", "--help"])
    assert result.exit_code == 0
    assert "config" in result.output.lower(), (
        f"'config' not found in plan --help:\n{result.output}"
    )
    assert "--verbose" in result.output or "-v" in result.output, (
        f"'--verbose' not found in plan --help:\n{result.output}"
    )


# ---------------------------------------------------------------------------
# Test 6: config file must exist (Typer Path validation)
# ---------------------------------------------------------------------------


def test_plan_exits_on_missing_config() -> None:
    """plan command exits non-zero when the config file does not exist."""
    result = runner.invoke(app, ["plan", "/nonexistent/path/config.py"])
    assert result.exit_code != 0, (
        f"Expected non-zero exit for missing config, got {result.exit_code}"
    )


# ---------------------------------------------------------------------------
# Test 7: plan command invokes asyncio.run with _plan_impl (structural check)
# ---------------------------------------------------------------------------


def test_plan_calls_plan_impl(monkeypatch: pytest.MonkeyPatch) -> None:
    """plan Typer wrapper must call _plan_impl with config and verbose args."""
    config_path = _make_temp_config()
    called_with: list[tuple[Path, bool]] = []

    async def _mock_impl(config: Path, verbose: bool) -> int:
        called_with.append((config, verbose))
        return 0

    monkeypatch.setattr("godoo_stateman.cli.commands.plan._plan_impl", _mock_impl)
    runner.invoke(app, ["plan", config_path])
    assert called_with, "_plan_impl was never called"
    assert called_with[0][0] == Path(config_path), (
        f"_plan_impl called with wrong config: {called_with[0][0]!r}"
    )
    assert called_with[0][1] is False, (
        f"verbose should be False by default, got {called_with[0][1]!r}"
    )


def test_plan_calls_plan_impl_with_verbose(monkeypatch: pytest.MonkeyPatch) -> None:
    """plan --verbose passes verbose=True to _plan_impl."""
    config_path = _make_temp_config()
    called_with: list[tuple[Path, bool]] = []

    async def _mock_impl(config: Path, verbose: bool) -> int:
        called_with.append((config, verbose))
        return 0

    monkeypatch.setattr("godoo_stateman.cli.commands.plan._plan_impl", _mock_impl)
    runner.invoke(app, ["plan", "--verbose", config_path])
    assert called_with, "_plan_impl was never called"
    assert called_with[0][1] is True, (
        f"verbose should be True when --verbose passed, got {called_with[0][1]!r}"
    )
