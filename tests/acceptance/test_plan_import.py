"""Acceptance tests for the plan + import pipeline against real Odoo 17 CE.

All tests require Docker (session-scoped ``odoo`` fixture in conftest.py).
Skip when Docker is unavailable:
    uv run pytest -m "not integration" -q

Run only acceptance tests:
    uv run pytest -m integration -q

Tests use vanilla Odoo 17 CE base-addon models ONLY:
- ``res.partner``  — name (char), email (char), active (bool, archivable), country_id (m2o)
- ``res.country``  — name (char), code (char) — stable data source

``project.project`` and similar non-base models are deliberately avoided
(field surface varies; not guaranteed present in base addons).

Requirements covered:
- IDENT-01: state lives only in ir.model.data (verified by import round-trip)
- IDENT-02 / SC-2: two plan renders against unchanged state are byte-identical
- IDENT-04: import --id flow writes xmlid
- IDENT-05 / SC-5: post-import plan treats record as managed (NoOp/Update, not Create)
- REL-03 / SC-4: DataSourceNode selector resolves at plan time (read seam)
- CORE-03 / SC-1: diff classifies Create / NoOp / Update
- SAFE-03 / SC-3: xmlid namespace collision (different model) → Reject (D-02)
- META-01: plan lists all managed resources (implemented in 03-04; validated here)

Cleanup: an autouse fixture removes every ir.model.data row written under the
test xmlid_prefix after each test, preventing cross-test state leakage.
"""

from __future__ import annotations

import io
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING, Any

import pytest
from rich.console import Console

from godoo_stateman.cli.commands.import_ import _import_impl
from godoo_stateman.diff import diff
from godoo_stateman.dsl.graph import build_graph
from godoo_stateman.dsl.types.desired import DesiredState
from godoo_stateman.dsl.types.nodes import DataSourceNode, ResourceNode
from godoo_stateman.identity import find_by_xmlid, write_xmlid
from godoo_stateman.live.livestate import LiveState
from godoo_stateman.live.seam import resolve_data_sources, resolve_deferred
from godoo_stateman.plan.render import render_plan
from godoo_stateman.plan.types import PlanAction, PlanStep
from godoo_stateman.schema.registry import SchemaRegistry
from godoo_stateman.schema.version import OdooVersion

if TYPE_CHECKING:
    import networkx as nx

# Unique namespace for this test module — all written xmlids use this prefix
# so the cleanup fixture can find and remove them deterministically.
TEST_PREFIX = "test_stateman_phase3"


# ---------------------------------------------------------------------------
# Cleanup fixture — remove all test xmlids after each test
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
async def cleanup_xmlids(odoo: object) -> AsyncIterator[Any]:
    """Autouse-style cleanup: remove all ir.model.data rows under TEST_PREFIX.

    Yields the live client. After the test, deletes every ir.model.data row
    whose ``module`` equals TEST_PREFIX so no state leaks between tests
    (the managed-set scan keys on ``module == xmlid_prefix``).
    """
    client = odoo.client  # type: ignore[attr-defined]
    yield client
    rows = await client.search_read(
        "ir.model.data",
        [("module", "=", TEST_PREFIX)],
        fields=["id"],
    )
    if rows:
        await client.unlink("ir.model.data", [int(r["id"]) for r in rows])


def _set_env_from_harness(odoo: object, monkeypatch: pytest.MonkeyPatch) -> None:
    """Mirror the TestHarness connection details into GODOO_* env vars.

    ``_import_impl`` reads credentials from the environment and opens its OWN
    ``OdooClient`` (it is the real CLI entry point). To exercise it against the
    same container the ``odoo`` fixture provides, we copy the harness URL /
    database / admin credentials into the environment for the duration of the
    test (monkeypatch auto-reverts on teardown).

    The harness uses ``username="admin"`` / ``password="admin"`` (admin_password
    default) and ``database="test_odoo"`` — source-verified from
    godoo-testcontainers container.py.
    """
    url = odoo.url  # type: ignore[attr-defined]
    database = odoo._database  # type: ignore[attr-defined]
    monkeypatch.setenv("GODOO_URL", url)
    monkeypatch.setenv("GODOO_DB", database)
    monkeypatch.setenv("GODOO_USER", "admin")
    monkeypatch.setenv("GODOO_PASSWORD", "admin")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _find_partner_id(client: Any, name: str = "Administrator") -> int:
    """Return the res_id of a stable base res.partner record (Administrator)."""
    partners = await client.search_read(
        "res.partner",
        [("name", "=", name)],
        fields=["id"],
        limit=1,
    )
    return int(partners[0]["id"]) if partners else 1


async def _run_pipeline(
    client: Any,
    state: DesiredState,
) -> tuple[list[PlanStep], nx.DiGraph]:
    """Run the full plan pipeline (snapshot, normalize-skip, fetch, seam, diff).

    Returns (plan_steps, graph). Mirrors plan.py's _plan_impl but without the
    CLI/env wrapper, taking a pre-built DesiredState directly.

    NOTE: the desired state passed here is expected to already hold normalized
    field values (tests build canonical values directly), so normalize() is not
    re-run; the snapshot is still built for diff()'s schema-driven field skip.
    """
    registry = SchemaRegistry(client, OdooVersion(17, 0))

    desired_models = sorted({r.model for r in state.resources})
    snapshot = await registry.build_snapshot(desired_models)

    graph = build_graph(state)

    desired_fields_by_model: dict[str, set[str]] = {}
    for resource in state.resources:
        desired_fields_by_model.setdefault(resource.model, set()).update(resource.fields.keys())

    live_state = await LiveState.fetch(
        client,
        state.xmlid_prefix,
        desired_fields_by_model,
    )

    # Extend snapshot to cover managed-but-absent models (Delete/Archive classification).
    managed_models = {r.model for r in live_state.managed.values()}
    all_models = sorted({r.model for r in state.resources} | managed_models)
    if set(all_models) != set(snapshot.models.keys()):
        snapshot = await registry.build_snapshot(all_models)

    seam_result = await resolve_data_sources(client, state.data_sources)
    resolved = [resolve_deferred(r, seam_result) for r in state.resources]
    state = DesiredState(
        xmlid_prefix=state.xmlid_prefix,
        resources=tuple(resolved),
        data_sources=state.data_sources,
        config_parameters=state.config_parameters,
    )

    plan_steps = diff(state, live_state, snapshot)
    return plan_steps, graph


def _step_for(plan_steps: list[PlanStep], slug: str) -> PlanStep | None:
    """Return the PlanStep with the given slug, or None."""
    for step in plan_steps:
        if step.slug == slug:
            return step
    return None


# ---------------------------------------------------------------------------
# SC-1 / CORE-03: Create / NoOp / Update classification
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_plan_shows_create_for_new_resource(cleanup_xmlids: Any) -> None:
    """A res.partner resource with no xmlid binding is classified CREATE (SC-1, D-01)."""
    client = cleanup_xmlids

    state = DesiredState(
        xmlid_prefix=TEST_PREFIX,
        resources=(
            ResourceNode(
                model="res.partner",
                slug="brand_new_partner",
                fields={"name": "Brand New Partner"},
            ),
        ),
        data_sources=(),
        config_parameters=(),
    )

    plan_steps, _graph = await _run_pipeline(client, state)

    step = _step_for(plan_steps, "brand_new_partner")
    assert step is not None
    assert step.action == PlanAction.CREATE
    assert step.res_id is None  # CREATE has no res_id yet


@pytest.mark.integration
async def test_plan_shows_noop_after_create(cleanup_xmlids: Any) -> None:
    """A managed res.partner with desired fields matching live → NoOp (SC-1)."""
    client = cleanup_xmlids
    partner_id = await _find_partner_id(client)

    # Pre-register the partner under our prefix.
    await write_xmlid(client, "res.partner", partner_id, TEST_PREFIX, "managed_partner")

    # Fetch the live name so the desired value matches exactly → NoOp.
    live = await client.search_read("res.partner", [("id", "=", partner_id)], fields=["name"], limit=1)
    live_name = live[0]["name"]

    state = DesiredState(
        xmlid_prefix=TEST_PREFIX,
        resources=(
            ResourceNode(
                model="res.partner",
                slug="managed_partner",
                fields={"name": live_name},
            ),
        ),
        data_sources=(),
        config_parameters=(),
    )

    plan_steps, _graph = await _run_pipeline(client, state)

    step = _step_for(plan_steps, "managed_partner")
    assert step is not None
    assert step.action == PlanAction.NOOP, (
        f"Expected NoOp for unchanged managed partner, got {step.action} with diffs {step.field_diff}"
    )


@pytest.mark.integration
async def test_plan_shows_update_on_field_change(cleanup_xmlids: Any) -> None:
    """A managed res.partner with a changed name → Update with a FieldDiff (SC-1, UX-03)."""
    client = cleanup_xmlids
    partner_id = await _find_partner_id(client)

    await write_xmlid(client, "res.partner", partner_id, TEST_PREFIX, "changing_partner")

    state = DesiredState(
        xmlid_prefix=TEST_PREFIX,
        resources=(
            ResourceNode(
                model="res.partner",
                slug="changing_partner",
                fields={"name": "A Completely Different Name 12345"},
            ),
        ),
        data_sources=(),
        config_parameters=(),
    )

    plan_steps, _graph = await _run_pipeline(client, state)

    step = _step_for(plan_steps, "changing_partner")
    assert step is not None
    assert step.action == PlanAction.UPDATE
    diffed_fields = {fd.field_name for fd in step.field_diff}
    assert "name" in diffed_fields, f"Expected 'name' in field diffs, got {diffed_fields}"


# ---------------------------------------------------------------------------
# SC-2 / IDENT-02: deterministic plan output (byte-identical re-render)
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_plan_is_deterministic(cleanup_xmlids: Any) -> None:
    """Rendering the same plan twice produces byte-identical output (SC-2, D-08)."""
    client = cleanup_xmlids
    partner_id = await _find_partner_id(client)
    await write_xmlid(client, "res.partner", partner_id, TEST_PREFIX, "det_partner")

    state = DesiredState(
        xmlid_prefix=TEST_PREFIX,
        resources=(
            ResourceNode(
                model="res.partner",
                slug="det_partner",
                fields={"name": "Determinism Test"},
            ),
            ResourceNode(
                model="res.partner",
                slug="det_new_partner",
                fields={"name": "Another One"},
            ),
        ),
        data_sources=(),
        config_parameters=(),
    )

    plan_steps, graph = await _run_pipeline(client, state)

    def _render() -> str:
        buf = io.StringIO()
        console = Console(file=buf, force_terminal=False)
        render_plan(plan_steps, graph, console, verbose=True)
        return buf.getvalue()

    out1 = _render()
    out2 = _render()
    assert out1 == out2, "Plan render is not byte-identical across two runs (SC-2 violation)"


# ---------------------------------------------------------------------------
# SC-3 / SAFE-03: xmlid namespace collision → Reject (D-02)
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_plan_reject_on_xmlid_collision(cleanup_xmlids: Any) -> None:
    """An xmlid bound to a different model than the config declares → Reject (SC-3, D-02)."""
    client = cleanup_xmlids
    partner_id = await _find_partner_id(client)

    # Register the slug bound to res.partner.
    await write_xmlid(client, "res.partner", partner_id, TEST_PREFIX, "collision_slug")

    # Config declares the SAME slug but as res.country (different model).
    state = DesiredState(
        xmlid_prefix=TEST_PREFIX,
        resources=(
            ResourceNode(
                model="res.country",
                slug="collision_slug",
                fields={"name": "Belgium"},
            ),
        ),
        data_sources=(),
        config_parameters=(),
    )

    plan_steps, _graph = await _run_pipeline(client, state)

    step = _step_for(plan_steps, "collision_slug")
    assert step is not None
    assert step.action == PlanAction.REJECT, f"Expected Reject for xmlid namespace collision, got {step.action}"


# ---------------------------------------------------------------------------
# SC-4 / REL-03: DataSourceNode resolves at plan time (read seam)
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_datasource_resolves_at_plan_time(cleanup_xmlids: Any) -> None:
    """A DataSourceNode selector resolves to a valid int res_id (SC-4, REL-03)."""
    client = cleanup_xmlids

    # res.country with code="BE" is stable in vanilla Odoo 17 CE.
    ds = DataSourceNode(
        model="res.country",
        selector={"code": "BE"},
        node_key="data.res_country[code=BE]",
    )

    seam_result = await resolve_data_sources(client, (ds,))

    assert ds.node_key in seam_result
    resolved_id = seam_result[ds.node_key]
    assert isinstance(resolved_id, int)
    assert resolved_id > 0


@pytest.mark.integration
async def test_datasource_m2o_resolved_in_resource(cleanup_xmlids: Any) -> None:
    """A Deferred m2o field referencing a DataSourceNode resolves to the remote ID (SC-4, REL-04)."""
    from godoo_stateman.dsl.types.deferred import Deferred

    client = cleanup_xmlids

    ds = DataSourceNode(
        model="res.country",
        selector={"code": "BE"},
        node_key="data.res_country[code=BE]",
    )
    seam_result = await resolve_data_sources(client, (ds,))
    expected_id = seam_result[ds.node_key]

    # Build a resource whose country_id field is a Deferred referencing the data source.
    resource = ResourceNode(
        model="res.partner",
        slug="partner_with_country",
        fields={
            "name": "Partner With Country",
            "country_id": Deferred(
                fn=lambda country_id: country_id,
                deps=frozenset({ds.node_key}),
            ),
        },
    )

    resolved = resolve_deferred(resource, seam_result)
    assert resolved.fields["country_id"] == expected_id
    # Non-deferred fields pass through unchanged.
    assert resolved.fields["name"] == "Partner With Country"


# ---------------------------------------------------------------------------
# SC-5 / IDENT-04 / IDENT-05: import round-trip
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_import_writes_xmlid(odoo: object, cleanup_xmlids: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """_import_impl writes an xmlid that find_by_xmlid then resolves (SC-5, IDENT-04)."""
    client = cleanup_xmlids
    partner_id = await _find_partner_id(client)

    _set_env_from_harness(odoo, monkeypatch)

    rc = await _import_impl("res.partner", partner_id, TEST_PREFIX, "imported_partner", False)
    assert rc == 0

    found = await find_by_xmlid(client, TEST_PREFIX, "imported_partner")
    assert found is not None
    assert found.res_id == partner_id
    assert found.model == "res.partner"


@pytest.mark.integration
async def test_import_idempotent(odoo: object, cleanup_xmlids: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """Calling _import_impl twice with identical args both return 0 (SC-5, IDENT-05)."""
    client = cleanup_xmlids
    partner_id = await _find_partner_id(client)

    _set_env_from_harness(odoo, monkeypatch)

    rc1 = await _import_impl("res.partner", partner_id, TEST_PREFIX, "idem_partner", False)
    rc2 = await _import_impl("res.partner", partner_id, TEST_PREFIX, "idem_partner", False)
    assert rc1 == 0
    assert rc2 == 0

    # Exactly one ir.model.data row exists for this xmlid.
    rows = await client.search_read(
        "ir.model.data",
        [("module", "=", TEST_PREFIX), ("name", "=", "idem_partner")],
        fields=["id"],
    )
    assert len(rows) == 1


@pytest.mark.integration
async def test_import_collision_requires_force(
    odoo: object, cleanup_xmlids: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Importing a different res_id under an existing xmlid without --force returns 1 (SAFE-03)."""
    client = cleanup_xmlids
    admin_id = await _find_partner_id(client, "Administrator")

    # Find a second distinct partner id.
    others = await client.search_read(
        "res.partner",
        [("id", "!=", admin_id)],
        fields=["id"],
        limit=1,
    )
    assert others, "Expected at least one other res.partner besides Administrator"
    other_id = int(others[0]["id"])

    _set_env_from_harness(odoo, monkeypatch)

    # Bind the slug to admin_id first.
    rc1 = await _import_impl("res.partner", admin_id, TEST_PREFIX, "collide_partner", False)
    assert rc1 == 0

    # Attempt to rebind to a different id without --force → must fail (1).
    rc2 = await _import_impl("res.partner", other_id, TEST_PREFIX, "collide_partner", False)
    assert rc2 == 1

    # The binding must still point to the original admin_id (no silent clobber).
    found = await find_by_xmlid(client, TEST_PREFIX, "collide_partner")
    assert found is not None
    assert found.res_id == admin_id

    # With --force the rebind succeeds.
    rc3 = await _import_impl("res.partner", other_id, TEST_PREFIX, "collide_partner", True)
    assert rc3 == 0
    found2 = await find_by_xmlid(client, TEST_PREFIX, "collide_partner")
    assert found2 is not None
    assert found2.res_id == other_id


@pytest.mark.integration
async def test_import_then_plan_shows_managed(
    odoo: object, cleanup_xmlids: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """After import, a plan for the same resource shows NoOp/Update — not Create (SC-5, IDENT-05)."""
    client = cleanup_xmlids
    partner_id = await _find_partner_id(client)

    _set_env_from_harness(odoo, monkeypatch)

    rc = await _import_impl("res.partner", partner_id, TEST_PREFIX, "roundtrip_partner", False)
    assert rc == 0

    state = DesiredState(
        xmlid_prefix=TEST_PREFIX,
        resources=(
            ResourceNode(
                model="res.partner",
                slug="roundtrip_partner",
                fields={"name": "Round Trip Different Name"},
            ),
        ),
        data_sources=(),
        config_parameters=(),
    )

    plan_steps, _graph = await _run_pipeline(client, state)

    step = _step_for(plan_steps, "roundtrip_partner")
    assert step is not None
    assert step.action in (PlanAction.NOOP, PlanAction.UPDATE), (
        f"After import the record must be managed (NoOp/Update), got {step.action} (Create = IDENT-05 failure)"
    )
    assert step.res_id == partner_id


# ---------------------------------------------------------------------------
# META-01: plan lists all managed resources (validated end-to-end)
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_plan_lists_managed_set(cleanup_xmlids: Any) -> None:
    """LiveState.fetch surfaces all managed slugs; diff produces a step per managed resource (META-01)."""
    client = cleanup_xmlids
    admin_id = await _find_partner_id(client, "Administrator")

    others = await client.search_read(
        "res.partner",
        [("id", "!=", admin_id)],
        fields=["id"],
        limit=1,
    )
    assert others
    other_id = int(others[0]["id"])

    # Pre-manage two res.partner resources under our prefix.
    await write_xmlid(client, "res.partner", admin_id, TEST_PREFIX, "managed_one")
    await write_xmlid(client, "res.partner", other_id, TEST_PREFIX, "managed_two")

    state = DesiredState(
        xmlid_prefix=TEST_PREFIX,
        resources=(
            ResourceNode(model="res.partner", slug="managed_one", fields={"name": "One"}),
            ResourceNode(model="res.partner", slug="managed_two", fields={"name": "Two"}),
        ),
        data_sources=(),
        config_parameters=(),
    )

    plan_steps, _graph = await _run_pipeline(client, state)

    # Both managed slugs appear in the plan, neither as Create.
    slugs = {s.slug for s in plan_steps}
    assert "managed_one" in slugs
    assert "managed_two" in slugs
    for slug in ("managed_one", "managed_two"):
        step = _step_for(plan_steps, slug)
        assert step is not None
        assert step.action != PlanAction.CREATE, f"{slug} is managed and must not be classified Create"
