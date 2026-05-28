"""plan command — evaluate DSL config, fetch live state, diff, and render plan.

Full pipeline (Phase 3):
    eval_config → normalize → build_graph → LiveState.fetch
    → resolve_data_sources → resolve_deferred → diff → render_plan

This command is READ-ONLY: only ``search_read`` calls are issued against Odoo.
No ``create``, ``write``, or ``unlink`` calls are made (T-03-11).

Credentials are read from environment variables (T-03-10):
    GODOO_URL       — Odoo base URL (e.g. https://odoo.example.com)
    GODOO_DB        — Database name
    GODOO_USER      — Login username
    GODOO_PASSWORD  — Password

Exit codes (UX-02, Phase-1 D-18):
    0 — all resources are NoOp (no changes pending)
    2 — at least one Create / Update / Delete / Archive / Reject in the plan
    1 — error (exception raised during evaluation or fetch)
"""

from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path

import typer
from godoo.client.client import OdooClient, OdooClientConfig
from rich.console import Console

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
from godoo_stateman.schema.version import OdooVersion


async def _plan_impl(config: Path, verbose: bool) -> int:
    """Async implementation of the plan command.

    Returns:
        0 — all-NoOp (no changes pending)
        2 — at least one non-NoOp step in the plan
        1 — error (caught and printed)
    """
    console = Console(force_terminal=False)

    # Step 1: Evaluate the DSL config (pure, no Odoo calls).
    try:
        state = eval_config(config)
    except DslEvalError as exc:
        console.print(f"[red]Error evaluating config: {exc}[/red]")
        return 1

    # Step 2: Read Odoo credentials from environment variables (T-03-10).
    # Never accept credentials from CLI args (they appear in process listings).
    missing: list[str] = []
    url = os.environ.get("GODOO_URL", "")
    db = os.environ.get("GODOO_DB", "")
    user = os.environ.get("GODOO_USER", "")
    password = os.environ.get("GODOO_PASSWORD", "")
    if not url:
        missing.append("GODOO_URL")
    if not db:
        missing.append("GODOO_DB")
    if not user:
        missing.append("GODOO_USER")
    if not password:
        missing.append("GODOO_PASSWORD")
    if missing:
        console.print(f"[red]Missing required environment variable(s): {', '.join(missing)}[/red]")
        return 1

    try:
        async with OdooClient(OdooClientConfig(url=url, database=db, username=user, password=password)) as client:
            # Step 3: Create the schema registry.
            # T-03.1-02: validate ODOO_VERSION before int conversion (ASVS L1 V5).
            # Inline duplicate of snapshot.py:61 — extraction deferred per D-04.
            _odoo_version_str = os.environ.get("ODOO_VERSION", "17.0")
            if not re.match(r"^\d+\.\d+$", _odoo_version_str):
                raise typer.BadParameter("ODOO_VERSION must match N.N format (e.g. '17.0')")
            _parts = _odoo_version_str.split(".")
            _odoo_version = OdooVersion(major=int(_parts[0]), minor=int(_parts[1]))
            registry = SchemaRegistry(client, _odoo_version)

            # Step 4: Build the initial snapshot from desired-state models.
            # Concrete call — no None fallback. Passing None would skip schema-
            # driven normalization and cause false-positive diffs (CORE-03).
            desired_models: list[str] = sorted({r.model for r in state.resources})
            snapshot = await registry.build_snapshot(desired_models)

            # Step 5: Normalize desired state with the schema snapshot.
            # Schema-driven normalization is required for correct field comparison;
            # passing snapshot=None would degrade CORE-03 correctness.
            state = normalize(state, snapshot)

            # Step 6: Build the dependency DAG (needed for render ordering D-08).
            graph = build_graph(state)

            # Step 7: Build desired-fields projection for LiveState.fetch.
            # Each model needs the union of fields declared in its ResourceNodes.
            desired_fields_by_model: dict[str, set[str]] = {}
            for resource in state.resources:
                desired_fields_by_model.setdefault(resource.model, set()).update(resource.fields.keys())

            # Step 8: Fetch live state from Odoo (READ-ONLY).
            # Compute extra prefixes from per-resource xmlid_module overrides (CR-02).
            extra_prefixes: set[str] = {r.xmlid_module for r in state.resources if r.xmlid_module} - {
                state.xmlid_prefix
            }
            live_state = await LiveState.fetch(
                client, state.xmlid_prefix, desired_fields_by_model, extra_prefixes or None
            )

            # Step 9a: Extend snapshot to include models from the managed set that
            # are absent from the desired-state model list.  This guarantees diff()
            # can classify Delete vs Archive for managed-but-absent resources
            # (needs archivable flag from the schema).
            managed_models = {r.model for r in live_state.managed.values()}
            all_model_names = sorted({r.model for r in state.resources} | managed_models)
            if set(all_model_names) != set(snapshot.models.keys()):
                # build_snapshot uses the in-memory cache for already-fetched models
                # so the additional fetch is cheap.
                snapshot = await registry.build_snapshot(all_model_names)

            # Step 10: Resolve DataSourceNode selectors to remote IDs (REL-03).
            seam_result = await resolve_data_sources(client, state.data_sources)

            # Step 11: Fire Deferred field values using seam results (REL-04).
            # Produces new ResourceNode instances (no in-place mutation — Pitfall 7).
            resolved_resources = [resolve_deferred(r, seam_result) for r in state.resources]
            state = DesiredState(
                xmlid_prefix=state.xmlid_prefix,
                resources=tuple(resolved_resources),
                data_sources=state.data_sources,
                config_parameters=state.config_parameters,
            )

            # Step 12: Diff desired vs live state (synchronous, pure).
            # Pass the SNAPSHOT (sync VersionedSnapshot) — not the registry (async).
            plan_steps = diff(state, live_state, snapshot)

            # Step 13: Render the plan (D-06, D-07, D-08, D-09).
            render_plan(plan_steps, graph, console, verbose=verbose)

            # Step 14: Return exit code (UX-02, Phase-1 D-18).
            # 0 = all NoOp; 2 = any non-NoOp step.
            has_changes = any(s.action != PlanAction.NOOP for s in plan_steps)
            return 2 if has_changes else 0

    except (StatemanError, LiveStateFetchError) as exc:
        console.print(f"[red]{exc}[/red]")
        return 1
    except Exception as exc:
        console.print(f"[red]Unexpected error: {exc}[/red]")
        return 1


def plan(
    config: Path = typer.Argument(
        ...,
        help="Path to stateman config .py file",
        exists=True,
        file_okay=True,
        dir_okay=False,
        readable=True,
    ),
    verbose: bool = typer.Option(
        False,
        "--verbose",
        "-v",
        help="Show NoOp (unchanged) resources in the plan output.",
    ),
) -> None:
    """Evaluate a DSL config and show the reconciliation plan against live Odoo.

    Exit codes:
      0 — no changes (all resources are in sync)
      2 — changes pending (at least one Create/Update/Delete/Archive/Reject)
      1 — error
    """
    exit_code = asyncio.run(_plan_impl(config, verbose))
    raise typer.Exit(code=exit_code)
