"""Rich-based plan output renderer — render_plan().

Implements the Terraform-style annotated resource list described in CONTEXT.md
decisions D-06, D-07, D-08, D-09 and requirements UX-03, UX-05, SC-2.

Design notes:
- D-06: Flat annotated list with action symbols (+/~/- /x/a/=).
        UPDATE actions show ``field_name: old_val → new_val`` plain lines —
        NOT ``rich.syntax.Syntax("diff")`` (unified diff is noisy for scalars).
- D-07: NOOP resources are hidden by default; shown only with ``verbose=True``.
        A trailing ``N resource(s) unchanged`` summary line is always emitted
        when N > 0, regardless of verbosity.
- D-08: Output order is deterministic via ``nx.topological_generations(graph)``
        with ``sorted()`` tie-breaking within each generation (SC-2).
        Running ``plan`` twice against unchanged Odoo produces byte-identical
        output (SC-2).
- D-09: The caller creates ``Console(force_terminal=False)`` for the real
        command; tests use ``Console(file=io.StringIO(), force_terminal=False)``.
        Rich automatically strips ANSI codes when not a TTY — no branch needed
        inside this module.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import networkx as nx
from rich.text import Text

from godoo_stateman.plan.types import PlanAction, PlanStep

if TYPE_CHECKING:
    from rich.console import Console

# ---------------------------------------------------------------------------
# Action symbol and style mappings
# ---------------------------------------------------------------------------

ACTION_SYMBOLS: dict[PlanAction, str] = {
    PlanAction.CREATE: "+",
    PlanAction.UPDATE: "~",
    PlanAction.DELETE: "-",
    PlanAction.REJECT: "x",
    PlanAction.ARCHIVE: "a",
    PlanAction.NOOP: "=",
}

ACTION_STYLES: dict[PlanAction, str] = {
    PlanAction.CREATE: "green",
    PlanAction.UPDATE: "yellow",
    PlanAction.DELETE: "red",
    PlanAction.REJECT: "bold red",
    PlanAction.ARCHIVE: "magenta",
    PlanAction.NOOP: "dim",
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def render_plan(
    plan_steps: list[PlanStep],
    graph: nx.DiGraph,
    console: Console,
    *,
    verbose: bool = False,
) -> None:
    """Render a plan as a Terraform-style annotated list to *console*.

    Args:
        plan_steps: Ordered list of ``PlanStep`` objects from ``diff()``.
        graph:      The dependency DAG from ``build_graph()`` — used to
                    determine topological emission order (D-08).
        console:    Rich ``Console`` instance.  The caller is responsible for
                    creating it with ``force_terminal=False`` for real commands
                    or ``Console(file=io.StringIO(), force_terminal=False)``
                    for tests (D-09).
        verbose:    If ``True``, NOOP resources are shown inline.
                    Summary line is always emitted when noop_count > 0 (D-07).
    """
    # Build a slug → PlanStep lookup for O(1) access during graph traversal.
    plan_steps_by_slug: dict[str, PlanStep] = {s.slug: s for s in plan_steps}

    # D-08: emit in topological generation order, slugs sorted within each
    # generation for deterministic tie-breaking (SC-2).
    # Only nodes in the graph (desired-state resources and data sources) are
    # emitted here.  Delete/Archive/Reject steps (managed-but-absent records)
    # have no graph node and are handled in the second loop below.
    graph_slugs: set[str] = set(graph.nodes)
    for generation in nx.topological_generations(graph):
        for slug in sorted(generation):
            step = plan_steps_by_slug.get(slug)
            if step is None:
                # Slug is a DataSourceNode in the graph but not a plan step —
                # data sources are not emitted in the plan output.
                continue

            # D-07: suppress NOOP lines in default (non-verbose) output.
            if step.action == PlanAction.NOOP and not verbose:
                continue

            symbol = ACTION_SYMBOLS[step.action]
            style = ACTION_STYLES[step.action]

            # Resource header line: "  SYMBOL slug  [model]"
            # Use rich.text.Text to build the line so the model name inside
            # square brackets is treated as literal text, not Rich markup.
            # (Rich interprets "[something]" as a markup tag in f-strings.)
            header = Text()
            header.append("  ")
            header.append(symbol, style=style)
            header.append(f" {step.slug}  [{step.model}]")
            console.print(header)

            # D-06: per-field diff lines for UPDATE — plain "field: old → new".
            if step.action == PlanAction.UPDATE:
                for fd in step.field_diff:
                    console.print(f"      {fd.field_name}: {fd.old_value!r} → {fd.new_value!r}")

    # Emit steps whose slug is NOT in the graph (Delete/Archive/Reject —
    # managed-but-absent records).  These steps have no ordering constraints
    # relative to desired-state resources; sort by slug for determinism (SC-2).
    unordered_steps = sorted(
        (s for s in plan_steps if s.slug not in graph_slugs),
        key=lambda s: s.slug,
    )
    for step in unordered_steps:
        if step.action == PlanAction.NOOP and not verbose:
            continue
        symbol = ACTION_SYMBOLS[step.action]
        style = ACTION_STYLES[step.action]
        header = Text()
        header.append("  ")
        header.append(symbol, style=style)
        header.append(f" {step.slug}  [{step.model}]")
        console.print(header)

        if step.action == PlanAction.UPDATE:
            for fd in step.field_diff:
                console.print(f"      {fd.field_name}: {fd.old_value!r} → {fd.new_value!r}")

    # D-07: trailing summary line — always present when noop_count > 0.
    noop_count = sum(1 for s in plan_steps if s.action == PlanAction.NOOP)
    if noop_count > 0:
        noun = "resource" if noop_count == 1 else "resources"
        console.print(f"  [dim]{noop_count} {noun} unchanged[/dim]")
