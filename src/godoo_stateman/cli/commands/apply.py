"""apply command — execute a reconciliation plan against live Odoo (Phase 4).

This is the first stateman command that issues *destructive* mutations
(``create`` / ``write`` / ``unlink``). It reuses the ``plan`` pipeline to build
the ordered ``list[PlanStep]``, renders it, runs the SAFE-04 confirmation prompt
(unless ``--auto-approve``), then invokes the executor and maps the RETURNED
``ExecResult`` to a deterministic exit code.

Exit-code contract (SAFE-05 / UX-04):
    0 — all steps ok (including all-NoOp short-circuit)
    1 — PRE-executor pipeline error ONLY (config/env missing, eval error, cycle,
        live-state fetch failure) — a step failure NEVER yields 1
    3 — partial: ExecResult.committed non-empty AND ExecResult.error is not None
    4 — first/sole step errored: committed empty AND error is not None
    5 — user declined the confirmation prompt

Because ``execute_plan`` ALWAYS returns an ``ExecResult`` and never raises a step
failure, the ``execute_plan`` call lives OUTSIDE the exit-1 except-funnel — step
failures surface as 3 or 4, never collapsing into 1.

Credentials are read from ``GODOO_*`` env vars via the shared
``cli/_connection.py`` helper (D-04, T-04-01) — never from CLI args.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import typer
from rich.console import Console

from godoo_stateman.apply.executor import execute_plan
from godoo_stateman.apply.state import GlobalLiveState
from godoo_stateman.cli._connection import open_client, read_connection
from godoo_stateman.diff import diff
from godoo_stateman.dsl.eval import eval_config
from godoo_stateman.dsl.graph import build_graph
from godoo_stateman.dsl.normalize import normalize
from godoo_stateman.dsl.types.desired import DesiredState
from godoo_stateman.errors import DslEvalError, LiveStateFetchError, StatemanError
from godoo_stateman.live.livestate import LiveState
from godoo_stateman.live.seam import resolve_data_sources, resolve_deferred
from godoo_stateman.plan.render import render_plan
from godoo_stateman.plan.types import PlanAction
from godoo_stateman.schema.registry import SchemaRegistry


async def _apply_impl(config: Path, auto_approve: bool, verbose: bool) -> int:
    """Async implementation of the apply command.

    Returns the exit code (0/1/3/4/5) — see module docstring for the contract.
    """
    console = Console(force_terminal=False)

    # Step 1: Evaluate the DSL config (pure, no Odoo calls).
    try:
        state = eval_config(config)
    except DslEvalError as exc:
        console.print(f"[red]Error evaluating config: {exc}[/red]")
        return 1

    # Step 2: Read credentials via the shared helper (D-04, T-04-01).
    try:
        connection, missing = read_connection()
    except ValueError:
        raise typer.BadParameter("ODOO_VERSION must match N.N format (e.g. '17.0')") from None
    if connection is None:
        console.print(f"[red]Missing required environment variable(s): {', '.join(missing)}[/red]")
        return 1

    # A single Odoo session spans the read pipeline AND the executor. The
    # pre-executor work is guarded by the exit-1 funnel; the executor call sits
    # OUTSIDE that funnel (it never raises a step failure — it returns an
    # ExecResult — so a failed step surfaces as 3 or 4, never collapsing into 1).
    async with open_client(connection) as client:
        registry = SchemaRegistry(client, connection.odoo_version)

        # ---------------------------------------------------------------
        # PRE-executor pipeline (exit-1 funnel). Returns a sentinel int exit
        # code for any short-circuit (all-NoOp → 0, declined → 5) or a tuple
        # carrying the executor inputs on success.
        # ---------------------------------------------------------------
        try:
            desired_models: list[str] = sorted({r.model for r in state.resources})
            snapshot = await registry.build_snapshot(desired_models)

            state = normalize(state, snapshot)
            graph = build_graph(state)

            desired_fields_by_model: dict[str, set[str]] = {}
            for resource in state.resources:
                desired_fields_by_model.setdefault(resource.model, set()).update(resource.fields.keys())

            extra_prefixes: set[str] = {r.xmlid_module for r in state.resources if r.xmlid_module} - {
                state.xmlid_prefix
            }
            live_state = await LiveState.fetch(
                client, state.xmlid_prefix, desired_fields_by_model, extra_prefixes or None
            )

            managed_models = {r.model for r in live_state.managed.values()}
            all_model_names = sorted({r.model for r in state.resources} | managed_models)
            if set(all_model_names) != set(snapshot.models.keys()):
                snapshot = await registry.build_snapshot(all_model_names)

            seam_result = await resolve_data_sources(client, state.data_sources)

            resolved_resources = [resolve_deferred(r, seam_result) for r in state.resources]
            state = DesiredState(
                xmlid_prefix=state.xmlid_prefix,
                resources=tuple(resolved_resources),
                data_sources=state.data_sources,
                config_parameters=state.config_parameters,
            )

            plan_steps = diff(state, live_state, snapshot)

            # Render the plan so the operator sees exactly what will change.
            render_plan(plan_steps, graph, console, verbose=verbose)

            # All-NoOp short-circuit: nothing to apply → exit 0, no prompt.
            if not any(s.action != PlanAction.NOOP for s in plan_steps):
                console.print("[dim]No changes to apply.[/dim]")
                return 0

            # SAFE-04 confirmation prompt — destructive intent must be explicit.
            if not auto_approve and not typer.confirm("Apply these changes?"):
                console.print("[yellow]Aborted — no changes applied.[/yellow]")
                return 5

            # Build the slug-keyed GlobalLiveState (REL-05, D-02).
            gls = GlobalLiveState.from_live_state(state, live_state, seam_result)

        except (StatemanError, LiveStateFetchError) as exc:
            console.print(f"[red]{exc}[/red]")
            return 1
        except Exception as exc:
            console.print(f"[red]Unexpected error: {exc}[/red]")
            return 1

        # ---------------------------------------------------------------
        # Executor + ExecResult→exit-code mapping — OUTSIDE the exit-1 funnel.
        # execute_plan ALWAYS returns an ExecResult; it never raises a step
        # failure, so a failed step maps to 3 (partial) or 4 (first-step), never 1.
        # ---------------------------------------------------------------
        result = await execute_plan(client, plan_steps, graph, gls, snapshot, registry, console)

    if result.error is None:
        return 0
    if result.committed:
        return 3
    return 4


def apply(
    config: Path = typer.Argument(
        ...,
        help="Path to stateman config .py file",
        exists=True,
        file_okay=True,
        dir_okay=False,
        readable=True,
    ),
    auto_approve: bool = typer.Option(
        False,
        "--auto-approve",
        help="Skip the interactive confirmation prompt and apply immediately.",
    ),
    verbose: bool = typer.Option(
        False,
        "--verbose",
        "-v",
        help="Show NoOp (unchanged) resources in the plan output.",
    ),
) -> None:
    """Execute a reconciliation plan against live Odoo.

    Renders the plan, prompts for confirmation (unless ``--auto-approve``), then
    creates/updates/deletes/archives records in dependency order.

    Exit codes:
      0 — all changes applied (or no changes pending)
      1 — pre-execution error (config/env/eval/cycle/fetch)
      3 — partial success (some steps applied, then a step failed)
      4 — first step failed (nothing applied)
      5 — user declined the confirmation prompt
    """
    exit_code = asyncio.run(_apply_impl(config, auto_approve, verbose))
    raise typer.Exit(code=exit_code)
