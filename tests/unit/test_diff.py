"""Unit tests for diff.py — classify Create/Update/NoOp/Delete/Archive/Reject.

All tests use injected fixture objects — no Docker required. diff() is a
pure synchronous function; no async, no I/O, no client calls.

asyncio_mode = "auto" in pyproject.toml means no @pytest.mark.asyncio decorator
is needed (and is not used here since diff() is synchronous).

Covers: CORE-03, CORE-04, SAFE-03, REL-03, REL-04
"""

from __future__ import annotations

from typing import Any

from godoo_stateman.diff import diff
from godoo_stateman.dsl.types.desired import DesiredState
from godoo_stateman.dsl.types.nodes import ResourceNode
from godoo_stateman.identity import XmlIdRecord
from godoo_stateman.live.livestate import LiveState
from godoo_stateman.plan.types import PlanAction, PlanStep
from godoo_stateman.schema.snapshot import VersionedSnapshot
from godoo_stateman.schema.version import SCHEMA_FORMAT_VERSION
from godoo_stateman.types.schema import VersionedFieldSchema, VersionedModelSchema

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _make_versioned_field(
    name: str,
    *,
    ttype: str = "char",
    store: bool = True,
    readonly: bool = False,
) -> VersionedFieldSchema:
    """Build a minimal VersionedFieldSchema for testing."""
    return VersionedFieldSchema(
        name=name,
        ttype=ttype,
        store=store,
        readonly=readonly,
        compute=None,
        relation=None,
        required=False,
    )


def _make_snapshot(
    models: dict[str, tuple[bool, dict[str, tuple[str, bool, bool]]]],
) -> VersionedSnapshot:
    """Build a VersionedSnapshot from a compact description.

    Args:
        models: dict mapping model_name → (archivable, fields_dict).
                fields_dict maps field_name → (ttype, store, readonly).

    Example::

        _make_snapshot({
            "res.partner": (True, {
                "name": ("char", True, False),
                "active": ("boolean", True, False),
                "country_id": ("many2one", True, False),
                "category_ids": ("many2many", True, False),
            })
        })
    """
    versioned_models: dict[str, VersionedModelSchema] = {}
    for model_name, (archivable, fields_dict) in models.items():
        versioned_fields: dict[str, VersionedFieldSchema] = {}
        for field_name, (ttype, store, readonly) in fields_dict.items():
            versioned_fields[field_name] = _make_versioned_field(
                field_name, ttype=ttype, store=store, readonly=readonly
            )
        versioned_models[model_name] = VersionedModelSchema(
            name=model_name,
            display_name=model_name,
            transient=False,
            odoo_version="17.0",
            archivable=archivable,
            fields=versioned_fields,
        )
    return VersionedSnapshot(
        odoo_version="17.0",
        schema_format_version=SCHEMA_FORMAT_VERSION,
        captured_at="2026-01-01T00:00:00+00:00",
        models=versioned_models,
    )


def _make_xmlid_record(
    slug: str,
    model: str,
    res_id: int,
    module: str = "test_prefix",
) -> XmlIdRecord:
    """Build a minimal XmlIdRecord for testing."""
    return XmlIdRecord(
        module=module,
        name=slug,
        model=model,
        res_id=res_id,
        complete_name=f"{module}.{slug}",
    )


def _make_live_state(
    managed: dict[str, tuple[str, int]],
    live_fields: dict[int, dict[str, Any]],
    module: str = "test_prefix",
) -> LiveState:
    """Build a LiveState fixture directly (not via fetch).

    Args:
        managed:     slug → (model, res_id)
        live_fields: res_id → {field_name: live_value}
        module:      xmlid module/prefix (default "test_prefix")

    Note: ``LiveState.managed`` is keyed by complete xmlid (``"{module}.{slug}"``),
    not by bare slug.  This helper constructs the complete-xmlid keys automatically.
    """
    managed_dict: dict[str, XmlIdRecord] = {
        f"{module}.{slug}": _make_xmlid_record(slug, model, res_id, module) for slug, (model, res_id) in managed.items()
    }
    return LiveState(managed=managed_dict, live_fields=live_fields)


def _make_desired(
    xmlid_prefix: str,
    resources: list[tuple[str, str, dict[str, Any]]],
    xmlid_module_overrides: dict[str, str] | None = None,
) -> DesiredState:
    """Build a DesiredState fixture.

    Args:
        xmlid_prefix:          Top-level xmlid prefix declared in the config.
        resources:             list of (model, slug, fields_dict) tuples.
        xmlid_module_overrides: slug → xmlid_module override (Pitfall 3).
    """
    overrides = xmlid_module_overrides or {}
    resource_nodes = tuple(
        ResourceNode(
            model=model,
            slug=slug,
            fields=fields,
            xmlid_module=overrides.get(slug),
        )
        for model, slug, fields in resources
    )
    return DesiredState(
        xmlid_prefix=xmlid_prefix,
        resources=resource_nodes,
        data_sources=(),
        config_parameters=(),
    )


# ---------------------------------------------------------------------------
# Helper: lookup step by slug
# ---------------------------------------------------------------------------


def _step(steps: list[PlanStep], slug: str) -> PlanStep:
    """Return the PlanStep for the given slug, or raise AssertionError."""
    matching = [s for s in steps if s.slug == slug]
    assert len(matching) == 1, f"Expected exactly 1 step for slug {slug!r}, got {len(matching)}"
    return matching[0]


# ---------------------------------------------------------------------------
# CORE-03: Create — slug absent from managed set (D-01: no natural-identity probing)
# ---------------------------------------------------------------------------


def test_create_on_no_xmlid() -> None:
    """diff() classifies a resource as CREATE when its slug is absent from managed set.

    D-01: No natural-identity probing — stateman never searches Odoo for look-alikes.
    find_by_xmlid returning None (represented by absent key in live_state.managed) → CREATE.
    """
    snapshot = _make_snapshot({"res.partner": (True, {"name": ("char", True, False)})})
    live_state = _make_live_state(managed={}, live_fields={})
    state = _make_desired("test_prefix", [("res.partner", "my_partner", {"name": "Alice"})])

    steps = diff(state, live_state, snapshot)

    assert len(steps) == 1
    step = steps[0]
    assert step.action == PlanAction.CREATE
    assert step.slug == "my_partner"
    assert step.model == "res.partner"
    assert step.xmlid == "test_prefix.my_partner"
    assert step.res_id is None
    assert step.field_diff == ()


# ---------------------------------------------------------------------------
# CORE-03 / SAFE-03 / D-02: Reject — xmlid collision (different model)
# ---------------------------------------------------------------------------


def test_reject_on_xmlid_collision() -> None:
    """diff() classifies as REJECT when the slug maps to a different model (D-02).

    SAFE-03: Reject = xmlid namespace collision only. Decided from ir.model.data alone.
    """
    snapshot = _make_snapshot({"res.partner": (True, {"name": ("char", True, False)})})
    # Live state: slug maps to res.users, not res.partner
    live_state = _make_live_state(
        managed={"my_partner": ("res.users", 99)},
        live_fields={99: {"name": "Bob"}},
    )
    state = _make_desired("test_prefix", [("res.partner", "my_partner", {"name": "Alice"})])

    steps = diff(state, live_state, snapshot)

    assert len(steps) == 1
    step = steps[0]
    assert step.action == PlanAction.REJECT
    assert step.slug == "my_partner"
    assert step.model == "res.partner"
    assert step.res_id == 99
    assert step.field_diff == ()


# ---------------------------------------------------------------------------
# CORE-03: NoOp — all desired fields match live values
# ---------------------------------------------------------------------------


def test_noop_on_identical_fields() -> None:
    """diff() classifies as NOOP when all desired fields match live values."""
    snapshot = _make_snapshot({"res.partner": (True, {"name": ("char", True, False)})})
    live_state = _make_live_state(
        managed={"my_partner": ("res.partner", 42)},
        live_fields={42: {"id": 42, "name": "Alice"}},
    )
    state = _make_desired("test_prefix", [("res.partner", "my_partner", {"name": "Alice"})])

    steps = diff(state, live_state, snapshot)

    assert len(steps) == 1
    step = steps[0]
    assert step.action == PlanAction.NOOP
    assert step.slug == "my_partner"
    assert step.res_id == 42
    assert step.field_diff == ()


# ---------------------------------------------------------------------------
# CORE-03: Update — at least one field differs
# ---------------------------------------------------------------------------


def test_update_on_changed_field() -> None:
    """diff() classifies as UPDATE with correct FieldDiff when a field value differs."""
    snapshot = _make_snapshot({"res.partner": (True, {"name": ("char", True, False)})})
    live_state = _make_live_state(
        managed={"my_partner": ("res.partner", 42)},
        live_fields={42: {"id": 42, "name": "Old Name"}},
    )
    state = _make_desired("test_prefix", [("res.partner", "my_partner", {"name": "New Name"})])

    steps = diff(state, live_state, snapshot)

    assert len(steps) == 1
    step = steps[0]
    assert step.action == PlanAction.UPDATE
    assert step.slug == "my_partner"
    assert step.res_id == 42

    assert len(step.field_diff) == 1
    fd = step.field_diff[0]
    assert fd.field_name == "name"
    assert fd.old_value == "Old Name"
    assert fd.new_value == "New Name"


# ---------------------------------------------------------------------------
# REL-03 / Pitfall 1: m2o no-false-positive diff
# ---------------------------------------------------------------------------


def test_m2o_no_false_positive() -> None:
    """diff() does NOT produce a false-positive Update for m2o fields.

    Odoo returns m2o as [id, "Display Name"]. The desired value is already
    normalized to int. Both sides must be normalized before comparison.
    live [1, "Admin"] vs desired 1 → NOOP (Pitfall 1).
    """
    snapshot = _make_snapshot({"res.partner": (True, {"country_id": ("many2one", True, False)})})
    # Live value is the raw Odoo [id, name] format
    live_state = _make_live_state(
        managed={"my_partner": ("res.partner", 42)},
        live_fields={42: {"id": 42, "country_id": [1, "Belgium"]}},
    )
    # Desired value is already an int (normalized by the eval stage)
    state = _make_desired("test_prefix", [("res.partner", "my_partner", {"country_id": 1})])

    steps = diff(state, live_state, snapshot)

    assert len(steps) == 1
    step = steps[0]
    assert step.action == PlanAction.NOOP, (
        f"Expected NOOP but got {step.action}; m2o live [1,'Belgium'] vs desired 1 "
        "should not produce a diff after normalization."
    )
    assert step.field_diff == ()


# ---------------------------------------------------------------------------
# REL-04: m2m data-source resolved — no false-positive diff
# ---------------------------------------------------------------------------


def test_m2m_datasource_resolved() -> None:
    """diff() does NOT produce a false-positive Update for resolved m2m fields.

    The seam has already resolved DataSourceNode references to integer IDs before
    diff() is called. Here the desired field already holds [1, 2, 3] (resolved).
    Live Odoo returns [3, 1, 2] (unordered). Both normalize to [1, 2, 3] → NOOP.
    """
    snapshot = _make_snapshot({"res.partner": (True, {"category_ids": ("many2many", True, False)})})
    live_state = _make_live_state(
        managed={"my_partner": ("res.partner", 42)},
        live_fields={42: {"id": 42, "category_ids": [3, 1, 2]}},
    )
    # Desired: resolved IDs from the seam, already in canonical form
    state = _make_desired("test_prefix", [("res.partner", "my_partner", {"category_ids": [1, 2, 3]})])

    steps = diff(state, live_state, snapshot)

    assert len(steps) == 1
    step = steps[0]
    assert step.action == PlanAction.NOOP, (
        f"Expected NOOP but got {step.action}; m2m live [3,1,2] vs desired [1,2,3] "
        "should not produce a diff after normalization (both sort to [1,2,3])."
    )
    assert step.field_diff == ()


# ---------------------------------------------------------------------------
# Pitfall 2: non-stored field excluded from comparison
# ---------------------------------------------------------------------------


def test_non_store_field_excluded() -> None:
    """diff() excludes fields with store=False from the field comparison (Pitfall 2).

    Computed fields (store=False) may appear in search_read responses but must
    never be compared — they cannot be written and may produce spurious diffs.
    """
    snapshot = _make_snapshot(
        {
            "res.partner": (
                True,
                {
                    "name": ("char", True, False),
                    # display_name is computed, store=False
                    "display_name": ("char", False, True),
                },
            )
        }
    )
    live_state = _make_live_state(
        managed={"my_partner": ("res.partner", 42)},
        live_fields={42: {"id": 42, "name": "Alice", "display_name": "Alice (old)"}},
    )
    # Desired declares display_name with a different value — must NOT produce a diff
    state = _make_desired(
        "test_prefix",
        [("res.partner", "my_partner", {"name": "Alice", "display_name": "Alice (new)"})],
    )

    steps = diff(state, live_state, snapshot)

    assert len(steps) == 1
    step = steps[0]
    # display_name is store=False — must not be in field_diff
    assert step.action == PlanAction.NOOP
    for fd in step.field_diff:
        assert fd.field_name != "display_name", "display_name (store=False) must not appear in field_diff"


# ---------------------------------------------------------------------------
# SAFE-03: xmlid collision → REJECT, never CREATE (D-02)
# ---------------------------------------------------------------------------


def test_xmlid_collision_produces_reject() -> None:
    """Slug pointing to a different model → REJECT, never CREATE (SAFE-03 / D-02).

    This is the same as test_reject_on_xmlid_collision but asserts explicitly
    that the action is REJECT (not CREATE), verifying no silent adoption occurs.
    """
    snapshot = _make_snapshot({"res.partner": (True, {"name": ("char", True, False)})})
    # "partner_slug" xmlid is already owned by a different model
    live_state = _make_live_state(
        managed={"partner_slug": ("project.project", 7)},
        live_fields={7: {"name": "Some Project"}},
    )
    state = _make_desired("test_prefix", [("res.partner", "partner_slug", {"name": "Alice"})])

    steps = diff(state, live_state, snapshot)

    assert len(steps) == 1
    step = steps[0]
    assert step.action == PlanAction.REJECT, (
        f"Expected REJECT for xmlid collision but got {step.action}. "
        "When the same slug maps to a different model, action must be REJECT (D-02), "
        "never CREATE — stateman must not silently adopt or shadow existing records."
    )
    assert step.res_id == 7


# ---------------------------------------------------------------------------
# CORE-03: Delete / Archive — managed set absent from desired state
# ---------------------------------------------------------------------------


def test_managed_set_absent_archivable() -> None:
    """diff() classifies as ARCHIVE when a managed slug is absent from desired state
    and the model is archivable (has a stored, writable active field).
    """
    snapshot = _make_snapshot(
        {
            "res.partner": (
                True,  # archivable=True
                {"name": ("char", True, False), "active": ("boolean", True, False)},
            )
        }
    )
    # "old_partner" exists in managed set but is NOT in desired state
    live_state = _make_live_state(
        managed={"old_partner": ("res.partner", 55)},
        live_fields={55: {"id": 55, "name": "Old Partner", "active": True}},
    )
    # Desired state is empty — no resources declared
    state = _make_desired("test_prefix", [])

    steps = diff(state, live_state, snapshot)

    assert len(steps) == 1
    step = steps[0]
    assert step.action == PlanAction.ARCHIVE
    assert step.slug == "old_partner"
    assert step.model == "res.partner"
    assert step.res_id == 55
    assert step.field_diff == ()


def test_managed_set_absent_non_archivable() -> None:
    """diff() classifies as DELETE when a managed slug is absent from desired state
    and the model is NOT archivable.
    """
    snapshot = _make_snapshot(
        {
            # archivable=False — no active field on this model
            "res.lang": (False, {"name": ("char", True, False)}),
        }
    )
    live_state = _make_live_state(
        managed={"old_lang": ("res.lang", 3)},
        live_fields={3: {"id": 3, "name": "Old Language"}},
    )
    state = _make_desired("test_prefix", [])

    steps = diff(state, live_state, snapshot)

    assert len(steps) == 1
    step = steps[0]
    assert step.action == PlanAction.DELETE
    assert step.slug == "old_lang"
    assert step.model == "res.lang"
    assert step.res_id == 3
    assert step.field_diff == ()


# ---------------------------------------------------------------------------
# Pitfall 3: per-resource xmlid_module override
# ---------------------------------------------------------------------------


def test_per_resource_xmlid_prefix_override() -> None:
    """diff() uses resource.xmlid_module (not state.xmlid_prefix) when overriding.

    When a resource declares xmlid_module="other", the effective prefix is "other".
    The PlanStep.xmlid must reflect "other.my_slug", and the managed-set lookup
    must use "other" as the module.

    This verifies Pitfall 3 fix: effective_prefix = resource.xmlid_module or state.xmlid_prefix.
    """
    snapshot = _make_snapshot({"res.partner": (True, {"name": ("char", True, False)})})
    # Managed under "other" prefix, not "test_prefix"
    live_state = _make_live_state(
        managed={"cross_resource": ("res.partner", 77)},
        live_fields={77: {"id": 77, "name": "Cross"}},
        module="other",
    )
    state = _make_desired(
        "test_prefix",
        [("res.partner", "cross_resource", {"name": "Cross"})],
        xmlid_module_overrides={"cross_resource": "other"},
    )

    steps = diff(state, live_state, snapshot)

    assert len(steps) == 1
    step = steps[0]
    # The resource matches exactly — same name, same module → NOOP
    assert step.action == PlanAction.NOOP
    assert step.xmlid == "other.cross_resource"


# ---------------------------------------------------------------------------
# Purity invariant: diff() must make zero client/network calls
# ---------------------------------------------------------------------------


def test_diff_is_pure_no_client_calls() -> None:
    """diff() is a pure function — it makes no client or network calls.

    Verified by passing a live_state with no records and an empty DesiredState
    and confirming the function completes without any I/O. Since diff() takes no
    client parameter, any code path that would call a client method is impossible
    by construction.

    Additionally verifies that the signature has no client parameter (D-01 hard
    constraint: diff() has zero I/O).
    """
    import inspect

    sig = inspect.signature(diff)
    param_names = list(sig.parameters.keys())

    # diff() must NOT have a 'client' parameter — that would allow I/O
    assert "client" not in param_names, (
        f"diff() must have no 'client' parameter (pure function, D-01). Got parameters: {param_names}"
    )

    # Confirm it runs without error against an empty state
    snapshot = _make_snapshot({"res.partner": (True, {"name": ("char", True, False)})})
    live_state = _make_live_state(managed={}, live_fields={})
    state = _make_desired("test_prefix", [])

    steps = diff(state, live_state, snapshot)
    assert steps == []


# ---------------------------------------------------------------------------
# Multiple actions in one call
# ---------------------------------------------------------------------------


def test_multiple_resources_mixed_actions() -> None:
    """diff() correctly classifies multiple resources with different actions in one call."""
    snapshot = _make_snapshot(
        {
            "res.partner": (
                True,
                {
                    "name": ("char", True, False),
                    "active": ("boolean", True, False),
                },
            )
        }
    )
    live_state = _make_live_state(
        managed={
            "partner_update": ("res.partner", 10),
            "partner_noop": ("res.partner", 11),
            "partner_managed_absent": ("res.partner", 12),
        },
        live_fields={
            10: {"id": 10, "name": "Old Name"},
            11: {"id": 11, "name": "Same Name"},
            12: {"id": 12, "name": "Will Archive", "active": True},
        },
    )
    state = _make_desired(
        "test_prefix",
        [
            ("res.partner", "partner_create", {"name": "Brand New"}),
            ("res.partner", "partner_update", {"name": "New Name"}),
            ("res.partner", "partner_noop", {"name": "Same Name"}),
        ],
    )

    steps = diff(state, live_state, snapshot)

    assert len(steps) == 4  # 3 desired + 1 absent managed

    create_step = _step(steps, "partner_create")
    assert create_step.action == PlanAction.CREATE
    assert create_step.res_id is None

    update_step = _step(steps, "partner_update")
    assert update_step.action == PlanAction.UPDATE
    assert any(fd.field_name == "name" for fd in update_step.field_diff)

    noop_step = _step(steps, "partner_noop")
    assert noop_step.action == PlanAction.NOOP

    archive_step = _step(steps, "partner_managed_absent")
    assert archive_step.action == PlanAction.ARCHIVE
    assert archive_step.res_id == 12


# ---------------------------------------------------------------------------
# CR-02 regression: xmlid_module override — record known under overridden prefix
# ---------------------------------------------------------------------------


def test_xmlid_module_override_classifies_noop_not_create() -> None:
    """CR-02 regression: a resource with xmlid_module override is NoOp when the
    record exists in Odoo under that module — NOT Create.

    Before CR-02 fix, LiveState.managed was keyed by bare slug and only scanned
    the top-level xmlid_prefix.  A resource declaring xmlid_module="other_prefix"
    would never find its record in managed and always classified as CREATE.

    After fix, LiveState.managed is keyed by complete xmlid ("{module}.{slug}"),
    and diff() looks up the complete xmlid.  The record is found → NoOp.
    """
    snapshot = _make_snapshot({"res.partner": (True, {"name": ("char", True, False)})})

    # Record already exists in Odoo under "other_prefix" module (not "main_prefix").
    # _make_live_state with module="other_prefix" produces key "other_prefix.override_slug".
    live_state = _make_live_state(
        managed={"override_slug": ("res.partner", 88)},
        live_fields={88: {"id": 88, "name": "Override Partner"}},
        module="other_prefix",
    )

    # Config uses top-level xmlid_prefix="main_prefix" but this resource overrides
    # to xmlid_module="other_prefix" — effective xmlid is "other_prefix.override_slug".
    state = _make_desired(
        "main_prefix",
        [("res.partner", "override_slug", {"name": "Override Partner"})],
        xmlid_module_overrides={"override_slug": "other_prefix"},
    )

    steps = diff(state, live_state, snapshot)

    assert len(steps) == 1
    step = steps[0]
    # Must be NoOp — the record is found under the overridden module, fields match.
    assert step.action == PlanAction.NOOP, (
        f"CR-02 regression: resource with xmlid_module override must classify as "
        f"NoOp (record exists), got {step.action}. "
        "Check that LiveState.managed is keyed by complete xmlid and diff() uses effective_prefix."
    )
    assert step.xmlid == "other_prefix.override_slug"
    assert step.res_id == 88
