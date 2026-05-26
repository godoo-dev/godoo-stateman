"""Unit tests for CLI help output and stub command exit codes (UX-06)."""

from __future__ import annotations

import tempfile

from typer.testing import CliRunner

from godoo_stateman.cli.app import app

runner = CliRunner()

EXPECTED_COMMANDS = ["plan", "apply", "verify", "import", "snapshot"]


def test_help_exits_0() -> None:
    """--help exits with code 0."""
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0, f"Expected exit 0, got {result.exit_code}:\n{result.output}"


def test_help_lists_all_five_commands() -> None:
    """--help output lists all five command names."""
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for command in EXPECTED_COMMANDS:
        assert command in result.output, f"Command '{command}' not found in --help output:\n{result.output}"


def test_plan_stub_exits_0() -> None:
    """plan stub prints Phase 3 note and exits with code 0 on success (BL-02 fix)."""
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
        f.write('module = "test_module"\n')
        config_path = f.name
    result = runner.invoke(app, ["plan", config_path])
    assert result.exit_code == 0, f"Expected exit 0, got {result.exit_code}:\n{result.output}"
    assert "Phase 3" in result.output


def test_plan_stub_shows_eval_summary() -> None:
    """plan stub calls eval_config and prints module/resource count on success."""
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
        f.write('module = "my_module"\n')
        config_path = f.name
    result = runner.invoke(app, ["plan", config_path])
    assert "my_module" in result.output, f"Expected module name in output:\n{result.output}"
    assert "resources=0" in result.output


def test_apply_stub_exits_1() -> None:
    """apply stub prints a Rich message and exits with code 1."""
    result = runner.invoke(app, ["apply"])
    assert result.exit_code == 1, f"Expected exit 1, got {result.exit_code}"
    assert "Phase 4" in result.output


def test_verify_stub_exits_1() -> None:
    """verify stub prints a Rich message and exits with code 1."""
    result = runner.invoke(app, ["verify"])
    assert result.exit_code == 1, f"Expected exit 1, got {result.exit_code}"
    assert "Phase 5" in result.output


def test_import_stub_exits_1() -> None:
    """import stub prints a Rich message and exits with code 1."""
    result = runner.invoke(app, ["import"])
    assert result.exit_code == 1, f"Expected exit 1, got {result.exit_code}"
    assert "Phase 3" in result.output


def test_snapshot_help_exits_0() -> None:
    """snapshot --help exits with code 0 and shows config argument."""
    result = runner.invoke(app, ["snapshot", "--help"])
    assert result.exit_code == 0, f"Expected exit 0, got {result.exit_code}:\n{result.output}"
    assert "config" in result.output.lower()
