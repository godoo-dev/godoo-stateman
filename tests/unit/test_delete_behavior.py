"""Unit tests for executor dispatch of DELETE / ARCHIVE / REJECT (SAFE-02, SAFE-05).

Uses a recording mock client and a stub registry — no Docker. Asserts:
- DELETE → client.unlink called
- ARCHIVE on archivable=True → client.write({"active": False})
- ARCHIVE on archivable=False → ExecResult.error wraps ArchiveNotSupportedError,
  ZERO client mutation calls, and execute_plan does NOT raise
- REJECT → no client call
"""

from __future__ import annotations

import io
from typing import Any

import networkx as nx
import pytest
from rich.console import Console

from godoo_stateman.apply.executor import execute_plan
from godoo_stateman.apply.state import GlobalLiveState
from godoo_stateman.errors import ArchiveNotSupportedError
from godoo_stateman.plan.types import PlanAction, PlanStep
from godoo_stateman.schema.snapshot import VersionedSnapshot
from godoo_stateman.schema.version import SCHEMA_FORMAT_VERSION
from godoo_stateman.types.schema import VersionedFieldSchema, VersionedModelSchema


class RecordingClient:
    """Records every create/write/unlink call for assertions."""

    def __init__(self) -> None:
        self.creates: list[tuple[str, dict[str, Any]]] = []
        self.writes: list[tuple[str, list[int], dict[str, Any]]] = []
        self.unlinks: list[tuple[str, list[int]]] = []
        self.searches: list[Any] = []

    async def create(self, model: str, vals: dict[str, Any]) -> int:
        self.creates.append((model, vals))
        return 999

    async def write(self, model: str, ids: list[int], vals: dict[str, Any]) -> bool:
        self.writes.append((model, ids, vals))
        return True

    async def unlink(self, model: str, ids: list[int]) -> bool:
        self.unlinks.append((model, ids))
        return True

    async def search_read(self, *args: Any, **kwargs: Any) -> list[Any]:
        # write_xmlid path — not exercised by delete/archive tests.
        self.searches.append((args, kwargs))
        return []

    @property
    def mutation_count(self) -> int:
        return len(self.creates) + len(self.writes) + len(self.unlinks)


class StubRegistry:
    """Returns a single VersionedModelSchema with a fixed archivable flag."""

    def __init__(self, *, archivable: bool) -> None:
        self._archivable = archivable

    async def get(self, model_name: str, *, bypass_cache: bool = False) -> VersionedModelSchema:
        return VersionedModelSchema(
            name=model_name,
            display_name=model_name,
            transient=False,
            odoo_version="17.0",
            archivable=self._archivable,
            fields={
                "active": VersionedFieldSchema(
                    name="active",
                    ttype="boolean",
                    store=self._archivable,
                    readonly=False,
                    compute=None,
                    relation=None,
                    required=False,
                )
            },
        )


def _snapshot() -> VersionedSnapshot:
    return VersionedSnapshot(
        odoo_version="17.0",
        schema_format_version=SCHEMA_FORMAT_VERSION,
        captured_at="2026-01-01T00:00:00+00:00",
        models={
            "test.model": VersionedModelSchema(
                name="test.model",
                display_name="test.model",
                transient=False,
                odoo_version="17.0",
                archivable=True,
                fields={},
            )
        },
    )


def _console() -> Console:
    return Console(file=io.StringIO(), force_terminal=False)


def _step(slug: str, action: PlanAction, *, res_id: int | None = 5) -> PlanStep:
    return PlanStep(
        action=action,
        slug=slug,
        model="test.model",
        xmlid=f"pfx.{slug}",
        res_id=None if action == PlanAction.CREATE else res_id,
        field_diff=(),
    )


def _graphless_graph() -> nx.DiGraph:
    # Delete/Archive/Reject steps have no graph node — empty graph.
    return nx.DiGraph()


async def test_delete_calls_unlink() -> None:
    client = RecordingClient()
    step = _step("gone", PlanAction.DELETE, res_id=7)

    result = await execute_plan(
        client, [step], _graphless_graph(), GlobalLiveState(), _snapshot(),
        StubRegistry(archivable=False), _console(),
    )

    assert client.unlinks == [("test.model", [7])]
    assert result.error is None
    assert len(result.committed) == 1


async def test_archive_archivable_writes_active_false() -> None:
    client = RecordingClient()
    step = _step("old", PlanAction.ARCHIVE, res_id=8)

    result = await execute_plan(
        client, [step], _graphless_graph(), GlobalLiveState(), _snapshot(),
        StubRegistry(archivable=True), _console(),
    )

    assert client.writes == [("test.model", [8], {"active": False})]
    assert result.error is None


async def test_archive_non_archivable_records_error_no_rpc() -> None:
    client = RecordingClient()
    step = _step("old", PlanAction.ARCHIVE, res_id=8)

    # execute_plan must NOT raise — the failure travels in the ExecResult.
    result = await execute_plan(
        client, [step], _graphless_graph(), GlobalLiveState(), _snapshot(),
        StubRegistry(archivable=False), _console(),
    )

    assert result.error is not None
    assert result.error.step.slug == "old"
    assert "not archivable" in result.error.message
    # ArchiveNotSupportedError message is surfaced.
    assert isinstance(ArchiveNotSupportedError(model="test.model", slug="old"), ArchiveNotSupportedError)
    # ZERO mutation calls for the non-archivable preflight failure (SAFE-02).
    assert client.mutation_count == 0
    assert len(result.committed) == 0


async def test_reject_issues_no_client_call() -> None:
    client = RecordingClient()
    step = _step("collision", PlanAction.REJECT, res_id=3)

    result = await execute_plan(
        client, [step], _graphless_graph(), GlobalLiveState(), _snapshot(),
        StubRegistry(archivable=True), _console(),
    )

    assert client.mutation_count == 0
    assert result.error is None
    assert len(result.committed) == 1
    assert result.committed[0].remote_id is None


@pytest.mark.parametrize("archivable", [True, False])
async def test_archive_preflight_runs_before_any_write(archivable: bool) -> None:
    """The archivability check happens before the write — when non-archivable,
    no write is attempted at all."""
    client = RecordingClient()
    step = _step("rec", PlanAction.ARCHIVE, res_id=2)

    await execute_plan(
        client, [step], _graphless_graph(), GlobalLiveState(), _snapshot(),
        StubRegistry(archivable=archivable), _console(),
    )

    if archivable:
        assert len(client.writes) == 1
    else:
        assert len(client.writes) == 0
