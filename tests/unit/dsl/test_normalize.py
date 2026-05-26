"""Unit tests for normalize() — CORE-02, CORE-08, SC-2.

All tests use fixture snapshots; no Docker required.
asyncio_mode = "auto" in pyproject.toml means no @pytest.mark.asyncio decorator is needed.
"""

from __future__ import annotations

from typing import Any

from godoo_stateman.dsl.normalize import normalize
from godoo_stateman.dsl.types.desired import DesiredState
from godoo_stateman.dsl.types.nodes import ResourceNode
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
    compute: str | None = None,
    relation: str | None = None,
    required: bool = False,
) -> VersionedFieldSchema:
    """Build a minimal VersionedFieldSchema for testing."""
    return VersionedFieldSchema(
        name=name,
        ttype=ttype,
        store=store,
        readonly=readonly,
        compute=compute,
        relation=relation,
        required=required,
    )


def _make_snapshot_with_field(
    model: str, field_name: str, ttype: str
) -> VersionedSnapshot:
    """Build a VersionedSnapshot containing a single model with a single field.

    Follows the _make_minimal_snapshot() pattern from test_schema_registry.py.
    """
    field = _make_versioned_field(field_name, ttype=ttype)
    model_schema = VersionedModelSchema(
        name=model,
        display_name=model,
        transient=False,
        odoo_version="17.0",
        archivable=False,
        fields={field_name: field},
    )
    return VersionedSnapshot(
        odoo_version="17.0",
        schema_format_version=SCHEMA_FORMAT_VERSION,
        captured_at="2026-01-01T00:00:00+00:00",
        models={model: model_schema},
    )


def _make_resource(model: str, slug: str, **fields: Any) -> ResourceNode:
    """Construct a ResourceNode with the given model, slug, and keyword fields."""
    return ResourceNode(model=model, slug=slug, fields=dict(fields))


def _make_desired_state(resources: list[ResourceNode]) -> DesiredState:
    """Construct a DesiredState with the given resources and empty collections."""
    return DesiredState(
        module="test_module",
        resources=tuple(resources),
        data_sources=(),
        config_parameters=(),
    )


# ---------------------------------------------------------------------------
# CORE-02: scalar False → None
# ---------------------------------------------------------------------------


def test_scalar_false_to_none() -> None:
    """normalize() converts False to None for a char field (CORE-02)."""
    snap = _make_snapshot_with_field("res.partner", "name", "char")
    resource = _make_resource("res.partner", "partner_1", name=False)
    state = _make_desired_state([resource])

    result = normalize(state, snap)

    assert result.resources[0].fields["name"] is None


def test_scalar_none_unchanged() -> None:
    """normalize() leaves None unchanged for a char field."""
    snap = _make_snapshot_with_field("res.partner", "name", "char")
    resource = _make_resource("res.partner", "partner_1", name=None)
    state = _make_desired_state([resource])

    result = normalize(state, snap)

    assert result.resources[0].fields["name"] is None


def test_scalar_string_unchanged() -> None:
    """normalize() leaves a non-False string value unchanged."""
    snap = _make_snapshot_with_field("res.partner", "name", "char")
    resource = _make_resource("res.partner", "partner_1", name="hello")
    state = _make_desired_state([resource])

    result = normalize(state, snap)

    assert result.resources[0].fields["name"] == "hello"


# ---------------------------------------------------------------------------
# A1: boolean False preserved (Assumption A1 — RESOLVED decision)
# ---------------------------------------------------------------------------


def test_boolean_false_preserved() -> None:
    """normalize() preserves False as False for a boolean field (A1 decision).

    active=False means 'archive this resource' and must survive normalization.
    CORE-02's False→None rule explicitly does NOT apply to boolean ttype.
    """
    snap = _make_snapshot_with_field("res.partner", "active", "boolean")
    resource = _make_resource("res.partner", "partner_1", active=False)
    state = _make_desired_state([resource])

    result = normalize(state, snap)

    result_value = result.resources[0].fields["active"]
    assert result_value is False, f"expected False, got {result_value!r}"
    assert result_value is not None, "boolean False must not be converted to None"


def test_boolean_true_preserved() -> None:
    """normalize() leaves True unchanged for a boolean field."""
    snap = _make_snapshot_with_field("res.partner", "active", "boolean")
    resource = _make_resource("res.partner", "partner_1", active=True)
    state = _make_desired_state([resource])

    result = normalize(state, snap)

    assert result.resources[0].fields["active"] is True


# ---------------------------------------------------------------------------
# CORE-02: relation field False → []
# ---------------------------------------------------------------------------


def test_m2x_false_to_empty_list() -> None:
    """normalize() converts False to [] for a many2many field (CORE-02)."""
    snap = _make_snapshot_with_field("res.partner", "category_ids", "many2many")
    resource = _make_resource("res.partner", "partner_1", category_ids=False)
    state = _make_desired_state([resource])

    result = normalize(state, snap)

    assert result.resources[0].fields["category_ids"] == []


def test_m2x_none_to_empty_list() -> None:
    """normalize() converts None to [] for a many2many field."""
    snap = _make_snapshot_with_field("res.partner", "category_ids", "many2many")
    resource = _make_resource("res.partner", "partner_1", category_ids=None)
    state = _make_desired_state([resource])

    result = normalize(state, snap)

    assert result.resources[0].fields["category_ids"] == []


def test_o2m_false_to_empty_list() -> None:
    """normalize() converts False to [] for a one2many field (CORE-02)."""
    snap = _make_snapshot_with_field("project.project", "task_ids", "one2many")
    resource = _make_resource("project.project", "project_1", task_ids=False)
    state = _make_desired_state([resource])

    result = normalize(state, snap)

    assert result.resources[0].fields["task_ids"] == []


# ---------------------------------------------------------------------------
# CORE-02: many2one False → None
# ---------------------------------------------------------------------------


def test_m2o_false_to_none() -> None:
    """normalize() converts False to None for a many2one field (CORE-02)."""
    snap = _make_snapshot_with_field("res.partner", "parent_id", "many2one")
    resource = _make_resource("res.partner", "partner_1", parent_id=False)
    state = _make_desired_state([resource])

    result = normalize(state, snap)

    assert result.resources[0].fields["parent_id"] is None


# ---------------------------------------------------------------------------
# CORE-08: many2one tuple/list → int
# ---------------------------------------------------------------------------


def test_m2o_tuple_to_int() -> None:
    """normalize() extracts the integer ID from a many2one tuple (CORE-08)."""
    snap = _make_snapshot_with_field("res.partner", "parent_id", "many2one")
    resource = _make_resource("res.partner", "partner_1", parent_id=(42, "Acme Corp"))
    state = _make_desired_state([resource])

    result = normalize(state, snap)

    assert result.resources[0].fields["parent_id"] == 42
    assert isinstance(result.resources[0].fields["parent_id"], int)


def test_m2o_list_to_int() -> None:
    """normalize() extracts the integer ID from a many2one list (CORE-08)."""
    snap = _make_snapshot_with_field("res.partner", "parent_id", "many2one")
    resource = _make_resource("res.partner", "partner_1", parent_id=[42, "Acme Corp"])
    state = _make_desired_state([resource])

    result = normalize(state, snap)

    assert result.resources[0].fields["parent_id"] == 42
    assert isinstance(result.resources[0].fields["parent_id"], int)


def test_m2o_int_unchanged() -> None:
    """normalize() leaves an already-integer many2one value unchanged."""
    snap = _make_snapshot_with_field("res.partner", "parent_id", "many2one")
    resource = _make_resource("res.partner", "partner_1", parent_id=42)
    state = _make_desired_state([resource])

    result = normalize(state, snap)

    assert result.resources[0].fields["parent_id"] == 42


# ---------------------------------------------------------------------------
# CORE-08: many2many sorted canonical order
# ---------------------------------------------------------------------------


def test_m2m_order_irrelevant() -> None:
    """normalize() sorts m2m lists so any input order produces the same output (CORE-08).

    Both [3, 1, 2] and [1, 2, 3] must normalize to [1, 2, 3] so the diff stage
    does not produce false positives based on list ordering.
    """
    snap = _make_snapshot_with_field("res.partner", "category_ids", "many2many")

    resource_a = _make_resource("res.partner", "partner_a", category_ids=[3, 1, 2])
    resource_b = _make_resource("res.partner", "partner_b", category_ids=[1, 2, 3])
    state = _make_desired_state([resource_a, resource_b])

    result = normalize(state, snap)

    normalized_a = result.resources[0].fields["category_ids"]
    normalized_b = result.resources[1].fields["category_ids"]
    assert normalized_a == [1, 2, 3]
    assert normalized_b == [1, 2, 3]
    assert normalized_a == normalized_b


# ---------------------------------------------------------------------------
# Passthrough cases
# ---------------------------------------------------------------------------


def test_unknown_field_passthrough() -> None:
    """normalize() passes through field values for unknown fields (not in snapshot)."""
    snap = _make_snapshot_with_field("res.partner", "name", "char")
    # "phone" is NOT in the snapshot
    resource = _make_resource("res.partner", "partner_1", name="Alice", phone="555-1234")
    state = _make_desired_state([resource])

    result = normalize(state, snap)

    assert result.resources[0].fields["phone"] == "555-1234"


def test_unknown_model_passthrough() -> None:
    """normalize() passes through all fields when the model is not in the snapshot."""
    snap = _make_snapshot_with_field("res.partner", "name", "char")
    # "project.project" is NOT in the snapshot
    resource = _make_resource("project.project", "project_1", name=False, active=False)
    state = _make_desired_state([resource])

    result = normalize(state, snap)

    # All fields unchanged since model not in snapshot
    assert result.resources[0].fields["name"] is False
    assert result.resources[0].fields["active"] is False


def test_snapshot_none_returns_unchanged() -> None:
    """normalize() returns the input state unchanged when snapshot=None."""
    resource = _make_resource("res.partner", "partner_1", name=False, active=False)
    state = _make_desired_state([resource])

    result = normalize(state, None)

    assert result is state


# ---------------------------------------------------------------------------
# SC-2: Idempotency
# ---------------------------------------------------------------------------


def test_normalize_idempotent() -> None:
    """normalize() applied twice produces structurally identical output (SC-2).

    Uses a resource with mixed field types: char, boolean, many2one tuple, many2many list.
    """
    # Build a snapshot with multiple field types
    fields_schema = {
        "name": _make_versioned_field("name", ttype="char"),
        "active": _make_versioned_field("active", ttype="boolean"),
        "parent_id": _make_versioned_field("parent_id", ttype="many2one"),
        "category_ids": _make_versioned_field("category_ids", ttype="many2many"),
    }
    model_schema = VersionedModelSchema(
        name="res.partner",
        display_name="Contact",
        transient=False,
        odoo_version="17.0",
        archivable=True,
        fields=fields_schema,
    )
    snap = VersionedSnapshot(
        odoo_version="17.0",
        schema_format_version=SCHEMA_FORMAT_VERSION,
        captured_at="2026-01-01T00:00:00+00:00",
        models={"res.partner": model_schema},
    )

    resource = _make_resource(
        "res.partner",
        "partner_1",
        name=False,
        active=False,
        parent_id=(42, "Acme Corp"),
        category_ids=[3, 1, 2],
    )
    state = _make_desired_state([resource])

    # First normalization pass
    once = normalize(state, snap)
    # Second normalization pass (applied to already-normalized output)
    twice = normalize(once, snap)

    # Both passes must produce structurally identical fields
    once_fields = once.resources[0].fields
    twice_fields = twice.resources[0].fields

    assert once_fields["name"] == twice_fields["name"]
    assert once_fields["active"] == twice_fields["active"]
    assert once_fields["parent_id"] == twice_fields["parent_id"]
    assert once_fields["category_ids"] == twice_fields["category_ids"]

    # Verify the normalized values are correct
    assert once_fields["name"] is None          # False → None (char)
    assert once_fields["active"] is False       # False preserved (boolean)
    assert once_fields["parent_id"] == 42       # (42, "Acme Corp") → 42
    assert once_fields["category_ids"] == [1, 2, 3]  # [3,1,2] → sorted
