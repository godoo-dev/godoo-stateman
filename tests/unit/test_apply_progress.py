"""Unit tests for [N/total] progress transcript (UX-04).

Captures Console(file=io.StringIO(), force_terminal=False) and asserts the
per-step progress lines and status tokens (ok / error / skipped).
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
    def __init__(self, fail_on_mutation: int | None = None) -> None:
        self.fail_on_mutation = fail_on_mutation
        self._mutations = 0
        self.calls = 0

    def _maybe_fail(self) -> None:
        self._mutations += 1
        self.calls += 1
        if self.fail_on_mutation is not None and self._mutations == self.fail_on_mutation:
            raise RuntimeError("RPC boom")

    async def write(self, model: str, ids: list[int], vals: dict[str, Any]) -> bool:
        self._maybe_fail()
        return True

    async def create(self, model: str, vals: dict[str, Any]) -> int:
        self._maybe_fail()
        return 1

    async def unlink(self, model: str, ids: list[int]) -> bool:
        self._maybe_fail()
        return True

    async def search_read(self, *args: Any, **kwargs: Any) -> list[Any]:
        return []


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


def _update_step(slug: str, res_id: int) -> PlanStep:
    return PlanStep(
        action=PlanAction.UPDATE, slug=slug, model="test.model",
        xmlid=f"pfx.{slug}", res_id=res_id, field_diff=(),
    )


def _three_step_graph() -> tuple[list[PlanStep], nx.DiGraph]:
    steps = [_update_step(f"s{i}", res_id=i) for i in range(1, 4)]
    graph: nx.DiGraph = nx.DiGraph()
    for i in range(1, 4):
        graph.add_node(f"s{i}")
    for i in range(1, 3):
        graph.add_edge(f"s{i}", f"s{i + 1}")
    return steps, graph


async def test_progress_lines_all_ok() -> None:
    steps, graph = _three_step_graph()
    buf = io.StringIO()
    console = Console(file=buf, force_terminal=False)

    await execute_plan(
        FailingClient(), steps, graph, GlobalLiveState(), _snapshot(), StubRegistry(), console
    )

    out = buf.getvalue()
    assert "[1/3]" in out
    assert "[2/3]" in out
    assert "[3/3]" in out
    assert "ok" in out


async def test_progress_lines_with_failure_tokens() -> None:
    steps, graph = _three_step_graph()
    buf = io.StringIO()
    console = Console(file=buf, force_terminal=False)

    await execute_plan(
        FailingClient(fail_on_mutation=2), steps, graph, GlobalLiveState(),
        _snapshot(), StubRegistry(), console,
    )

    out = buf.getvalue()
    assert "[1/3]" in out and "[2/3]" in out and "[3/3]" in out
    # step 1 ok, step 2 error, step 3 skipped
    assert "ok" in out
    assert "error" in out
    assert "skipped" in out
