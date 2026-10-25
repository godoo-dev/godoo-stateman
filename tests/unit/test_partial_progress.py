"""Unit tests for stop-on-first-failure ExecResult reporting (SAFE-05, CORE-06).

A failure injected on step 3 of 5 → steps 1-2 committed, step 3 error, steps 4-5
skipped, all in execution order; execute_plan RETURNS (never raises). Plus the
all-NoOp idempotency assertion: zero mutations.
"""

from __future__ import annotations

import io
from typing import Any

import networkx as nx
from rich.console import Console

from godoo_stateman.apply.executor import execute_plan
from godoo_stateman.apply.state import GlobalLiveState
from godoo_stateman.plan.types import PlanAction, PlanStep
from godoo_stateman.schema.snapshot import VersionedSnapshot
from godoo_stateman.schema.version import SCHEMA_FORMAT_VERSION
from godoo_stateman.types.schema import VersionedModelSchema


class FailingClient:
    """Records calls; raises on the Nth mutating call (1-based)."""

    def __init__(self, fail_on_mutation: int | None = None) -> None:
        self.fail_on_mutation = fail_on_mutation
        self.creates: list[Any] = []
        self.writes: list[Any] = []
        self.unlinks: list[Any] = []
        self._mutations = 0

    def _maybe_fail(self) -> None:
        self._mutations += 1
        if self.fail_on_mutation is not None and self._mutations == self.fail_on_mutation:
            raise RuntimeError("RPC boom")

    async def create(self, model: str, vals: dict[str, Any]) -> int:
        self._maybe_fail()
        self.creates.append((model, vals))
        return 100 + self._mutations

    async def write(self, model: str, ids: list[int], vals: dict[str, Any]) -> bool:
        self._maybe_fail()
        self.writes.append((model, ids, vals))
        return True

    async def unlink(self, model: str, ids: list[int]) -> bool:
        self._maybe_fail()
        self.unlinks.append((model, ids))
        return True

    async def search_read(self, *args: Any, **kwargs: Any) -> list[Any]:
        return []

    @property
    def mutation_count(self) -> int:
        return len(self.creates) + len(self.writes) + len(self.unlinks)


class StubRegistry:
    async def get(self, model_name: str, *, bypass_cache: bool = False) -> VersionedModelSchema:
        return VersionedModelSchema(
            name=model_name, display_name=model_name, transient=False,
            odoo_version="17.0", archivable=True, fields={},
        )


def _snapshot() -> VersionedSnapshot:
    return VersionedSnapshot(
        odoo_version="17.0", schema_format_version=SCHEMA_FORMAT_VERSION,
        captured_at="2026-01-01T00:00:00+00:00",
        models={
            "test.model": VersionedModelSchema(
                name="test.model", display_name="test.model", transient=False,
                odoo_version="17.0", archivable=True, fields={},
            )
        },
    )


def _console() -> Console:
    return Console(file=io.StringIO(), force_terminal=False)


def _update_step(slug: str, res_id: int) -> PlanStep:
    return PlanStep(
        action=PlanAction.UPDATE, slug=slug, model="test.model",
        xmlid=f"pfx.{slug}", res_id=res_id, field_diff=(),
    )


def _five_step_graph() -> tuple[list[PlanStep], nx.DiGraph]:
    # Five updates chained s1→s2→s3→s4→s5 so execution order is deterministic.
    steps = [_update_step(f"s{i}", res_id=i) for i in range(1, 6)]
    graph: nx.DiGraph = nx.DiGraph()
    for i in range(1, 6):
        graph.add_node(f"s{i}")
    for i in range(1, 5):
        graph.add_edge(f"s{i}", f"s{i + 1}")
    return steps, graph


async def test_failure_on_step_3_of_5() -> None:
    steps, graph = _five_step_graph()
    client = FailingClient(fail_on_mutation=3)

    result = await execute_plan(
        client, steps, graph, GlobalLiveState(), _snapshot(), StubRegistry(), _console()
    )

    # execute_plan RETURNS — no exception propagated.
    assert [c.step.slug for c in result.committed] == ["s1", "s2"]
    assert result.error is not None
    assert result.error.step.slug == "s3"
    assert [s.slug for s in result.skipped] == ["s4", "s5"]
    # s1, s2 recorded ok; s3 raised BEFORE appending; s4, s5 never attempted.
    assert client.mutation_count == 2


async def test_first_step_failure_zero_committed() -> None:
    steps, graph = _five_step_graph()
    client = FailingClient(fail_on_mutation=1)

    result = await execute_plan(
        client, steps, graph, GlobalLiveState(), _snapshot(), StubRegistry(), _console()
    )

    assert result.committed == []
    assert result.error is not None
    assert result.error.step.slug == "s1"
    assert [s.slug for s in result.skipped] == ["s2", "s3", "s4", "s5"]


async def test_all_noop_zero_mutations() -> None:
    """CORE-06 idempotency: an all-NoOp plan issues zero create/write/unlink."""
    steps = [
        PlanStep(action=PlanAction.NOOP, slug=f"n{i}", model="test.model",
                 xmlid=f"pfx.n{i}", res_id=i, field_diff=())
        for i in range(1, 4)
    ]
    graph: nx.DiGraph = nx.DiGraph()
    for i in range(1, 4):
        graph.add_node(f"n{i}")
    client = FailingClient()

    result = await execute_plan(
        client, steps, graph, GlobalLiveState(), _snapshot(), StubRegistry(), _console()
    )

    assert client.mutation_count == 0
    assert result.error is None
    assert len(result.committed) == 3
