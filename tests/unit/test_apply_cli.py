"""Unit tests for the apply CLI command (SAFE-04, UX-04).

Exercises the prompt / --auto-approve / all-NoOp short-circuit paths by faking
the pipeline and executor at the apply.py module seams — no Docker required.

Secrets: the fake credentials use a dummy password that is never asserted on.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any, ClassVar

import godoo_stateman.cli.commands.apply as apply_mod
from godoo_stateman.apply.executor import CommittedStep, ExecResult
from godoo_stateman.cli._connection import Connection
from godoo_stateman.plan.types import PlanAction, PlanStep
from godoo_stateman.schema.version import OdooVersion

if TYPE_CHECKING:
    import pytest

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeClientCtx:
    """Async context manager yielding a do-nothing fake client."""

    async def __aenter__(self) -> Any:
        return object()

    async def __aexit__(self, *exc: Any) -> bool:
        return False


def _connection() -> Connection:
    return Connection(
        url="http://localhost:8069",
        db="testdb",
        user="admin",
        password="x",  # dummy — never asserted
        odoo_version=OdooVersion(major=17, minor=0),
    )


def _update_step(slug: str = "s1") -> PlanStep:
    return PlanStep(
        action=PlanAction.UPDATE, slug=slug, model="test.model",
        xmlid=f"pfx.{slug}", res_id=1, field_diff=(),
    )


def _noop_step(slug: str = "n1") -> PlanStep:
    return PlanStep(
        action=PlanAction.NOOP, slug=slug, model="test.model",
        xmlid=f"pfx.{slug}", res_id=1, field_diff=(),
    )


def _install_fake_pipeline(
    monkeypatch: pytest.MonkeyPatch,
    *,
    plan_steps: list[PlanStep],
    exec_result: ExecResult | None = None,
    exec_spy: list[bool] | None = None,
) -> None:
    """Patch the apply.py module seams so _apply_impl runs without Odoo.

    ``exec_spy`` (if given) appends True whenever execute_plan is invoked, so a
    test can assert the executor was NOT reached (declined / all-NoOp paths).
    """
    monkeypatch.setattr(apply_mod, "eval_config", lambda config: _FakeState(plan_steps))
    monkeypatch.setattr(apply_mod, "read_connection", lambda: (_connection(), []))
    monkeypatch.setattr(apply_mod, "open_client", lambda conn: _FakeClientCtx())
    monkeypatch.setattr(apply_mod, "SchemaRegistry", lambda client, version: _FakeRegistry())
    monkeypatch.setattr(apply_mod, "normalize", lambda state, snapshot: state)
    monkeypatch.setattr(apply_mod, "build_graph", lambda state: _FakeGraph())
    monkeypatch.setattr(apply_mod, "diff", lambda state, live, snap: plan_steps)
    monkeypatch.setattr(apply_mod, "render_plan", lambda *a, **k: None)
    monkeypatch.setattr(apply_mod, "resolve_data_sources", _fake_resolve_ds)
    monkeypatch.setattr(apply_mod, "resolve_deferred", lambda r, seam: r)
    monkeypatch.setattr(apply_mod.LiveState, "fetch", staticmethod(_fake_fetch))
    monkeypatch.setattr(
        apply_mod.GlobalLiveState, "from_live_state",
        staticmethod(lambda desired, live, seam: _FakeGls()),
    )

    async def _fake_execute(*args: Any, **kwargs: Any) -> ExecResult:
        if exec_spy is not None:
            exec_spy.append(True)
        return exec_result if exec_result is not None else ExecResult()

    monkeypatch.setattr(apply_mod, "execute_plan", _fake_execute)


# --- minimal stand-ins for the pipeline value objects --------------------


class _FakeState:
    def __init__(self, plan_steps: list[PlanStep]) -> None:
        # apply.py reads .resources / .xmlid_prefix / .data_sources / .config_parameters
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


class _FakeGls:
    pass


class _FakeLiveState:
    managed: ClassVar[dict[str, Any]] = {}
    live_fields: ClassVar[dict[int, Any]] = {}


async def _fake_fetch(*args: Any, **kwargs: Any) -> _FakeLiveState:
    return _FakeLiveState()


async def _fake_resolve_ds(*args: Any, **kwargs: Any) -> dict[str, int]:
    return {}


# apply.py builds a real DesiredState from _FakeState fields; ensure that works
# by giving _FakeState the attributes DesiredState() needs (empty tuples above).


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_all_noop_short_circuits_to_0(monkeypatch: pytest.MonkeyPatch) -> None:
    spy: list[bool] = []
    _install_fake_pipeline(monkeypatch, plan_steps=[_noop_step()], exec_spy=spy)

    code = await apply_mod._apply_impl(Path("dummy.py"), auto_approve=False, verbose=False)

    assert code == 0
    assert spy == []  # executor never reached, prompt never shown


async def test_declined_prompt_returns_5_no_mutation(monkeypatch: pytest.MonkeyPatch) -> None:
    spy: list[bool] = []
    _install_fake_pipeline(monkeypatch, plan_steps=[_update_step()], exec_spy=spy)
    # Decline the SAFE-04 prompt.
    monkeypatch.setattr(apply_mod.typer, "confirm", lambda *a, **k: False)

    code = await apply_mod._apply_impl(Path("dummy.py"), auto_approve=False, verbose=False)

    assert code == 5
    assert spy == []  # executor never reached → zero mutation


async def test_auto_approve_bypasses_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    spy: list[bool] = []

    def _boom(*a: Any, **k: Any) -> bool:
        raise AssertionError("typer.confirm must NOT be called with --auto-approve")

    _install_fake_pipeline(
        monkeypatch,
        plan_steps=[_update_step()],
        exec_result=ExecResult(committed=[CommittedStep(step=_update_step(), remote_id=1)]),
        exec_spy=spy,
    )
    monkeypatch.setattr(apply_mod.typer, "confirm", _boom)

    code = await apply_mod._apply_impl(Path("dummy.py"), auto_approve=True, verbose=False)

    assert code == 0
    assert spy == [True]  # executor reached without prompting


async def test_confirmed_prompt_runs_executor(monkeypatch: pytest.MonkeyPatch) -> None:
    spy: list[bool] = []
    _install_fake_pipeline(
        monkeypatch,
        plan_steps=[_update_step()],
        exec_result=ExecResult(committed=[CommittedStep(step=_update_step(), remote_id=1)]),
        exec_spy=spy,
    )
    monkeypatch.setattr(apply_mod.typer, "confirm", lambda *a, **k: True)

    code = await apply_mod._apply_impl(Path("dummy.py"), auto_approve=False, verbose=False)

    assert code == 0
    assert spy == [True]
