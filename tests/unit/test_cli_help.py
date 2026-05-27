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


def test_plan_exits_1_when_env_missing() -> None:
    """plan command exits 1 and reports missing env vars when credentials absent."""
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
        f.write('xmlid_prefix = "test_module"\n')
        config_path = f.name
    # Invoke without Odoo env vars — must exit 1 with helpful message.
    result = runner.invoke(app, ["plan", config_path], env={})
    assert result.exit_code == 1, (
        f"Expected exit 1 for missing env vars, got {result.exit_code}:\n{result.output}"
    )
    assert "GODOO_URL" in result.output or "GODOO" in result.output, (
        f"Expected missing-env-var message in output:\n{result.output}"
    )


def test_plan_accepts_verbose_flag() -> None:
    """plan command accepts --verbose flag without error (flag is registered)."""
    result = runner.invoke(app, ["plan", "--help"])
    assert result.exit_code == 0
    assert "--verbose" in result.output or "-v" in result.output, (
        f"'--verbose' / '-v' flag missing from plan --help:\n{result.output}"
    )


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


def test_import_requires_options() -> None:
    """import command exits non-zero when required options are missing.

    The stub (Phase 3 not-yet-implemented) is now replaced; the real command
    requires --model, --id, --module, and --name. Invoking without them causes
    Typer to display usage help and exit with a usage-error code.
    """
    result = runner.invoke(app, ["import"])
    # Typer exits with 2 for missing required options (usage error).
    assert result.exit_code != 0, (
        f"Expected non-zero exit when required options are missing, got {result.exit_code}"
    )


def test_snapshot_help_exits_0() -> None:
    """snapshot --help exits with code 0 and shows config argument."""
    result = runner.invoke(app, ["snapshot", "--help"])
    assert result.exit_code == 0, f"Expected exit 0, got {result.exit_code}:\n{result.output}"
    assert "config" in result.output.lower()
