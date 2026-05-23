"""snapshot command — introspect live Odoo and persist a versioned schema snapshot."""

from __future__ import annotations

import asyncio
from pathlib import Path

import typer
from rich.console import Console


def snapshot(
    config: Path = typer.Argument(..., help="Path to stateman config .py file"),
) -> None:
    """Introspect live Odoo and persist a versioned schema snapshot."""
    asyncio.run(_snapshot_impl(config))


async def _snapshot_impl(config: Path) -> None:
    """Schema registry wiring — stub body replaced in plan 02."""
    console = Console()
    console.print("[cyan]snapshot: schema registry wiring in progress[/cyan]")
