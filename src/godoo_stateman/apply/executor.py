"""Apply executor — the first live-Odoo *mutation* path (CORE-05, REL-05, SAFE-05).

``execute_plan`` walks a pre-built ``list[PlanStep]`` in execution order and
dispatches each step to the appropriate Odoo jsonrpc call:

- CREATE  → ``serialize_fields`` + ``client.create`` + register-id + ``write_xmlid``
- UPDATE  → serialize the diff fields + ``client.write``
- DELETE  → ``client.unlink``
- ARCHIVE → archivability preflight (SAFE-02) + ``client.write(active=False)``
- NoOp / Reject → no RPC

Execution order (Task 1)
------------------------
The order is computed ONCE by the pure ``_execution_order`` helper. It REUSES the
render path's ``nx.topological_generations(graph)`` *generation grouping* and the
``sorted(generation)`` slug sort, then layers a NEW within-generation action-class
tiebreak (Creates → Updates → Deletes/Archives, slug-sorted within each class).
``render.py`` has NO action-class ranking — that ordering is introduced here.
Graph-less steps (Delete/Archive/Reject for managed-but-absent records) are
appended last, sorted by slug, matching ``diff.py`` Pass-2 order.

Never-raise contract (SAFE-05)
------------------------------
``execute_plan`` ALWAYS returns a populated :class:`ExecResult`. A step failure is
recorded INSIDE the result (``committed`` / ``error`` / ``skipped``) and the call
returns — it NEVER propagates ``ApplyStepError`` (or any step exception) past the
execution loop. This is what keeps the CLI's exit-code 3 (partial) vs 4 (first-step
error) distinction alive: if the executor raised, the CLI except-funnel would
collapse both into exit 1 and lose the partial-progress report.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import networkx as nx

from godoo_stateman.apply.serialize import serialize_fields
from godoo_stateman.errors import ApplyStepError, ArchiveNotSupportedError
from godoo_stateman.identity import write_xmlid
from godoo_stateman.plan.render import ACTION_STYLES, ACTION_SYMBOLS
from godoo_stateman.plan.types import PlanAction, PlanStep

if TYPE_CHECKING:
    from godoo.client.client import OdooClient
    from rich.console import Console

    from godoo_stateman.apply.state import GlobalLiveState
    from godoo_stateman.schema.registry import SchemaRegistry
    from godoo_stateman.schema.snapshot import VersionedSnapshot

# ---------------------------------------------------------------------------
# Within-generation action-class ranking (NEW logic — not present in render.py).
# Creates land before Updates before Deletes/Archives; Delete and Archive share
# the destructive tier (rank 2). Reject and NoOp issue no mutation and sort last.
# ---------------------------------------------------------------------------
_ACTION_RANK: dict[PlanAction, int] = {
    PlanAction.CREATE: 0,
    PlanAction.UPDATE: 1,
    PlanAction.DELETE: 2,
    PlanAction.ARCHIVE: 2,
    PlanAction.REJECT: 3,
    PlanAction.NOOP: 4,
}


@dataclass(frozen=True)
class CommittedStep:
    """A successfully-applied step and the remote id it touched (``None`` for NoOp/Reject)."""

    step: PlanStep
    remote_id: int | None


@dataclass(frozen=True)
class FailedStep:
    """The single failing step and its human-readable error message."""

    step: PlanStep
    message: str


@dataclass
class ExecResult:
    """The carrier of stop-on-first-failure state (SAFE-05).

    Populated and RETURNED by :func:`execute_plan`; never raised. ``error`` is
    ``None`` on a fully-successful run. When ``error`` is set, every step ordered
    after the failure is in ``skipped`` and ``committed`` holds the steps that did
    land (the recovery surface — no rollback exists over jsonrpc).
    """

    committed: list[CommittedStep] = field(default_factory=list)
    error: FailedStep | None = None
    skipped: list[PlanStep] = field(default_factory=list)


def _execution_order(plan_steps: list[PlanStep], graph: nx.DiGraph) -> list[PlanStep]:
    """Compute the deterministic execution order (pure — no client, no I/O).

    REUSES the render path's ``nx.topological_generations(graph)`` generation
    grouping. WITHIN each generation it applies the NEW action-class tiebreak
    (``_ACTION_RANK``) then slug. Graph-less steps (Delete/Archive/Reject whose
    slug is absent from the graph) are appended last, sorted by slug — matching
    ``diff.py`` Pass-2 order.
    """
    steps_by_slug: dict[str, PlanStep] = {s.slug: s for s in plan_steps}
    graph_slugs: set[str] = set(graph.nodes)

    ordered: list[PlanStep] = []
    for generation in nx.topological_generations(graph):
        generation_steps = [
            steps_by_slug[slug] for slug in generation if slug in steps_by_slug
        ]
        # NEW within-generation tiebreak: action class then slug.
        generation_steps.sort(key=lambda s: (_ACTION_RANK[s.action], s.slug))
        ordered.extend(generation_steps)

    # Graph-less steps (managed-but-absent Delete/Archive/Reject), slug-sorted.
    graphless = sorted(
        (s for s in plan_steps if s.slug not in graph_slugs),
        key=lambda s: s.slug,
    )
    ordered.extend(graphless)
    return ordered


def _format_step_line(position: int, total: int, step: PlanStep, status: str) -> str:
    """Build a ``[N/total] <symbol> <model> <slug> … <status>`` progress line."""
    symbol = ACTION_SYMBOLS[step.action]
    return f"[{position}/{total}] {symbol} {step.model} {step.slug} … {status}"


async def _apply_step(
    client: OdooClient,
    step: PlanStep,
    gls: GlobalLiveState,
    snapshot: VersionedSnapshot,
    registry: SchemaRegistry,
) -> int | None:
    """Dispatch a single step to Odoo. Returns the remote id (or ``None``).

    Raises on any Odoo/preflight failure — the caller wraps this in the
    never-raise loop and records the failure in the ExecResult.
    """
    if step.action in (PlanAction.NOOP, PlanAction.REJECT):
        # No mutation: NoOp is already in sync; Reject is an xmlid collision the
        # operator must resolve manually. Issue zero client calls.
        return None

    if step.action == PlanAction.CREATE:
        payload = serialize_fields(snapshot.models[step.model], step.desired_fields or {}, gls)
        new_id = await client.create(step.model, payload)
        # REL-05: register the new id BEFORE the next step runs so a later m2m
        # referencing this slug resolves to the freshly-created int.
        gls[step.slug] = new_id
        module, name = step.xmlid.rsplit(".", 1)
        await write_xmlid(client, step.model, new_id, module, name)
        return new_id

    if step.action == PlanAction.UPDATE:
        fields = {fd.field_name: fd.new_value for fd in step.field_diff}
        payload = serialize_fields(snapshot.models[step.model], fields, gls)
        assert step.res_id is not None  # UPDATE always carries the live res_id
        await client.write(step.model, [step.res_id], payload)
        return step.res_id

    if step.action == PlanAction.DELETE:
        assert step.res_id is not None
        await client.unlink(step.model, [step.res_id])
        return step.res_id

    if step.action == PlanAction.ARCHIVE:
        # SAFE-02 / Pitfall 3: archivability preflight BEFORE any client call.
        model_schema = await registry.get(step.model)
        if not model_schema.archivable:
            raise ArchiveNotSupportedError(model=step.model, slug=step.slug)
        assert step.res_id is not None
        await client.write(step.model, [step.res_id], {"active": False})
        return step.res_id

    # Defensive: PlanAction is a closed enum, every member handled above.
    raise AssertionError(f"unhandled action {step.action!r}")  # pragma: no cover


async def execute_plan(
    client: OdooClient,
    plan_steps: list[PlanStep],
    graph: nx.DiGraph,
    gls: GlobalLiveState,
    snapshot: VersionedSnapshot,
    registry: SchemaRegistry,
    console: Console,
) -> ExecResult:
    """Execute the plan in order, stopping on the first failure (SAFE-05).

    ALWAYS returns a populated :class:`ExecResult`; NEVER raises a step failure
    past the loop. Emits one ``[N/total] <action> <model> <slug> … <status>``
    progress line per step (UX-04), then a final summary block.
    """
    ordered = _execution_order(plan_steps, graph)
    total = len(ordered)
    result = ExecResult()

    for index, step in enumerate(ordered):
        position = index + 1

        if result.error is not None:
            # A prior step failed — skip every remaining step, issue no call.
            result.skipped.append(step)
            console.print(_format_step_line(position, total, step, "skipped"))
            continue

        try:
            remote_id = await _apply_step(client, step, gls, snapshot, registry)
        except Exception as exc:
            # Wrap as ApplyStepError to carry slug/action/cause (the SAFE-05 contract),
            # then record its message in the ExecResult. We NEVER re-raise it — str(exc)
            # yields the godoo-client .human_message (path-stripped, T-04-07).
            wrapped = ApplyStepError(slug=step.slug, action=str(step.action), cause=exc)
            result.error = FailedStep(step=step, message=str(wrapped.cause))
            console.print(_format_step_line(position, total, step, "error"))
            # Do NOT re-raise — the failure travels in the returned ExecResult.
            continue

        result.committed.append(CommittedStep(step=step, remote_id=remote_id))
        console.print(_format_step_line(position, total, step, "ok"))

    _print_summary(console, result)
    return result


def _print_summary(console: Console, result: ExecResult) -> None:
    """Emit the final committed / failed / skipped recovery summary (SAFE-05)."""
    console.print("")
    if result.committed:
        console.print(f"Committed ({len(result.committed)}):")
        for c in result.committed:
            style = ACTION_STYLES[c.step.action]
            id_suffix = f" -> {c.remote_id}" if c.remote_id is not None else ""
            console.print(f"  [{style}]{ACTION_SYMBOLS[c.step.action]}[/{style}] {c.step.slug}{id_suffix}")
    if result.error is not None:
        e = result.error
        console.print(f"[red]Failed:[/red] {e.step.action} {e.step.slug}: {e.message}")
    if result.skipped:
        console.print(f"Skipped ({len(result.skipped)}):")
        for s in result.skipped:
            console.print(f"  {s.slug}")
