"""Unit tests for the apply exit-code contract (SAFE-05, CORE-05).

Matrix asserting 0/1/3/4/5 with 3 (committed>0 + error) and 4 (committed==0 +
error) kept DISTINCT, and a step-failure ExecResult NEVER yielding exit 1.
Exit 1 only from a PRE-executor pipeline raise (e.g. CycleError).
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any, ClassVar

import godoo_stateman.cli.commands.apply as apply_mod
from godoo_stateman.apply.executor import CommittedStep, ExecResult, FailedStep
from godoo_stateman.cli._connection import Connection
from godoo_stateman.errors import CycleError
from godoo_stateman.plan.types import PlanAction, PlanStep
from godoo_stateman.schema.version import OdooVersion

if TYPE_CHECKING:
    import pytest


class _FakeClientCtx:
    async def __aenter__(self) -> Any:
        return object()

    async def __aexit__(self, *exc: Any) -> bool:
        return False


def _connection() -> Connection:
    return Connection(
        url="http://localhost:8069", db="testdb", user="admin",
        password="x", odoo_version=OdooVersion(major=17, minor=0),
    )


def _step(slug: str = "s1") -> PlanStep:
    return PlanStep(
        action=PlanAction.UPDATE, slug=slug, model="test.model",
        xmlid=f"pfx.{slug}", res_id=1, field_diff=(),
    )


class _FakeState:
    def __init__(self) -> None:
        self.resources: tuple[Any, ...] = ()
        self.xmlid_prefix = "pfx"
        self.data_sources: tuple[Any, ...] = ()
        self.config_parameters: tuple[Any, ...] = ()


class _FakeRegistry:
    async def build_snapshot(self, names: list[str]) -> Any:
        return _FakeSnapshot()


class _FakeSnapshot:
    models: ClassVar[dict[str, Any]] = {}


class _FakeGraph:
    @property
    def nodes(self) -> list[str]:
        return []


class _FakeLiveState:
    managed: ClassVar[dict[str, Any]] = {}
    live_fields: ClassVar[dict[int, Any]] = {}


async def _fake_fetch(*args: Any, **kwargs: Any) -> _FakeLiveState:
    return _FakeLiveState()


async def _fake_resolve_ds(*args: Any, **kwargs: Any) -> dict[str, int]:
    return {}


def _install_base(monkeypatch: pytest.MonkeyPatch, *, build_graph: Any = None) -> None:
    monkeypatch.setattr(apply_mod, "eval_config", lambda config: _FakeState())
    monkeypatch.setattr(apply_mod, "read_connection", lambda: (_connection(), []))
    monkeypatch.setattr(apply_mod, "open_client", lambda conn: _FakeClientCtx())
    monkeypatch.setattr(apply_mod, "SchemaRegistry", lambda client, version: _FakeRegistry())
    monkeypatch.setattr(apply_mod, "normalize", lambda state, snapshot: state)
    monkeypatch.setattr(apply_mod, "build_graph", build_graph or (lambda state: _FakeGraph()))
    monkeypatch.setattr(apply_mod, "diff", lambda state, live, snap: [_step()])
    monkeypatch.setattr(apply_mod, "render_plan", lambda *a, **k: None)
    monkeypatch.setattr(apply_mod, "resolve_data_sources", _fake_resolve_ds)
    monkeypatch.setattr(apply_mod, "resolve_deferred", lambda r, seam: r)
    monkeypatch.setattr(apply_mod.LiveState, "fetch", staticmethod(_fake_fetch))
    monkeypatch.setattr(
        apply_mod.GlobalLiveState, "from_live_state",
        staticmethod(lambda desired, live, seam: object()),
    )
    monkeypatch.setattr(apply_mod.typer, "confirm", lambda *a, **k: True)


def _install_executor(monkeypatch: pytest.MonkeyPatch, result: ExecResult) -> None:
    async def _fake_execute(*args: Any, **kwargs: Any) -> ExecResult:
        return result

    monkeypatch.setattr(apply_mod, "execute_plan", _fake_execute)


async def test_exit_0_all_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_base(monkeypatch)
    _install_executor(monkeypatch, ExecResult(committed=[CommittedStep(step=_step(), remote_id=1)]))

    code = await apply_mod._apply_impl(Path("c.py"), auto_approve=True, verbose=False)
    assert code == 0


async def test_exit_3_partial(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_base(monkeypatch)
    result = ExecResult(
        committed=[CommittedStep(step=_step("a"), remote_id=1)],
        error=FailedStep(step=_step("b"), message="boom"),
        skipped=[_step("c")],
    )
    _install_executor(monkeypatch, result)

    code = await apply_mod._apply_impl(Path("c.py"), auto_approve=True, verbose=False)
    assert code == 3


async def test_exit_4_first_step_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_base(monkeypatch)
    result = ExecResult(
        committed=[],
        error=FailedStep(step=_step("a"), message="boom"),
        skipped=[_step("b")],
    )
    _install_executor(monkeypatch, result)

    code = await apply_mod._apply_impl(Path("c.py"), auto_approve=True, verbose=False)
    assert code == 4


async def test_exit_5_declined(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_base(monkeypatch)
    monkeypatch.setattr(apply_mod.typer, "confirm", lambda *a, **k: False)
    # Executor must not be reached; if it is, fail loudly.

    async def _boom(*a: Any, **k: Any) -> ExecResult:
        raise AssertionError("executor must not run when prompt is declined")

    monkeypatch.setattr(apply_mod, "execute_plan", _boom)

    code = await apply_mod._apply_impl(Path("c.py"), auto_approve=False, verbose=False)
    assert code == 5


async def test_exit_1_pre_executor_cycle_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """A CycleError raised in the PRE-executor pipeline → exit 1 (not 3/4)."""

    def _raise_cycle(state: Any) -> Any:
        raise CycleError("Dependency cycle detected: a -> b -> a")

    _install_base(monkeypatch, build_graph=_raise_cycle)

    async def _boom(*a: Any, **k: Any) -> ExecResult:
        raise AssertionError("executor must not run when the pipeline raises")

    monkeypatch.setattr(apply_mod, "execute_plan", _boom)

    code = await apply_mod._apply_impl(Path("c.py"), auto_approve=True, verbose=False)
    assert code == 1


async def test_exit_3_and_4_are_distinct(monkeypatch: pytest.MonkeyPatch) -> None:
    """A step failure NEVER collapses into exit 1; 3 and 4 are distinct codes."""
    _install_base(monkeypatch)

    partial = ExecResult(
        committed=[CommittedStep(step=_step("a"), remote_id=1)],
        error=FailedStep(step=_step("b"), message="boom"),
    )
    _install_executor(monkeypatch, partial)
    code_partial = await apply_mod._apply_impl(Path("c.py"), auto_approve=True, verbose=False)

    first = ExecResult(committed=[], error=FailedStep(step=_step("a"), message="boom"))
    _install_executor(monkeypatch, first)
    code_first = await apply_mod._apply_impl(Path("c.py"), auto_approve=True, verbose=False)

    assert code_partial == 3
    assert code_first == 4
    assert code_partial != code_first
    assert code_partial != 1 and code_first != 1
