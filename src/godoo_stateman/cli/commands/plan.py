"""[stub] plan command — evaluates DSL config; full diff/plan output in Phase 3."""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console

from godoo_stateman.dsl.eval import eval_config
from godoo_stateman.errors import DslEvalError


def plan(
    config: Path = typer.Argument(..., help="Path to stateman config .py file"),
) -> None:
    """[stub] Evaluate a DSL config and print module/resource summary (Phase 3 for full plan)."""
    console = Console()

    try:
        state = eval_config(config)
    except DslEvalError as exc:
        console.print(f"[red]Error evaluating config: {exc}[/red]")
        raise typer.Exit(code=1) from exc

    console.print(
        f"[green]Evaluated: module={state.module}, "
        f"resources={len(state.resources)}, "
        f"data_sources={len(state.data_sources)}[/green]"
    )
    console.print("[yellow]Full plan output: Phase 3[/yellow]")
    raise typer.Exit(code=0)
