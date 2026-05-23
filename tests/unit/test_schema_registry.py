"""Unit tests for schema types, version constants, registry, and snapshot.

Covers SCHEM-01 through SCHEM-04. All tests use mocked Introspector — no Docker required.
asyncio_mode = "auto" in pyproject.toml means no @pytest.mark.asyncio decorator is needed.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from godoo.introspection.types import FieldSchema, ModelSchema
from pydantic import ValidationError

from godoo_stateman.errors import VersionMismatchError
from godoo_stateman.schema.registry import SchemaRegistry
from godoo_stateman.schema.snapshot import VersionedSnapshot
from godoo_stateman.schema.version import SCHEMA_FORMAT_VERSION, OdooVersion
from godoo_stateman.types.schema import VersionedFieldSchema, VersionedModelSchema

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_field_schema(
    name: str,
    *,
    ttype: str = "char",
    store: bool = True,
    readonly: bool = False,
    compute: str | None = None,
    relation: str | None = None,
    required: bool = False,
) -> FieldSchema:
    """Build a minimal FieldSchema for testing."""
    return FieldSchema(
        name=name,
        ttype=ttype,
        store=store,
        readonly=readonly,
        compute=compute,
        relation=relation,
        required=required,
    )


def _make_model_schema(name: str, fields: dict[str, FieldSchema] | None = None) -> ModelSchema:
    """Build a minimal ModelSchema for testing."""
    return ModelSchema(
        name=name,
        display_name=f"Test {name}",
        transient=False,
        fields=fields or {},
    )


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
    return VersionedFieldSchema(
        name=name,
        ttype=ttype,
        store=store,
        readonly=readonly,
        compute=compute,
        relation=relation,
        required=required,
    )


def _make_minimal_snapshot(
    *,
    odoo_version: str = "17.0",
    schema_format_version: int = SCHEMA_FORMAT_VERSION,
    captured_at: str = "2026-01-01T00:00:00+00:00",
    models: dict[str, VersionedModelSchema] | None = None,
) -> VersionedSnapshot:
    if models is None:
        field = _make_versioned_field("name")
        model = VersionedModelSchema(
            name="res.partner",
            display_name="Contact",
            transient=False,
            odoo_version=odoo_version,
            archivable=False,
            fields={"name": field},
        )
        models = {"res.partner": model}
    return VersionedSnapshot(
        odoo_version=odoo_version,
        schema_format_version=schema_format_version,
        captured_at=captured_at,
        models=models,
    )


# ---------------------------------------------------------------------------
# OdooVersion tests
# ---------------------------------------------------------------------------


def test_odoo_version_str_format() -> None:
    """OdooVersion(17, 0).__str__() returns '17.0'."""
    v = OdooVersion(major=17, minor=0)
    assert str(v) == "17.0"


def test_odoo_version_str_non_zero_minor() -> None:
    """OdooVersion(16, 3).__str__() returns '16.3'."""
    v = OdooVersion(major=16, minor=3)
    assert str(v) == "16.3"


def test_odoo_version_frozen() -> None:
    """OdooVersion is immutable (frozen dataclass)."""
    v = OdooVersion(major=17, minor=0)
    with pytest.raises(dataclasses.FrozenInstanceError):
        v.major = 18  # type: ignore[misc]


# ---------------------------------------------------------------------------
# SCHEMA_FORMAT_VERSION
# ---------------------------------------------------------------------------


def test_schema_format_version_is_int() -> None:
    """SCHEMA_FORMAT_VERSION is an integer."""
    assert isinstance(SCHEMA_FORMAT_VERSION, int)
    assert SCHEMA_FORMAT_VERSION == 1


# ---------------------------------------------------------------------------
# VersionedFieldSchema tests
# ---------------------------------------------------------------------------


def test_versioned_field_schema_frozen() -> None:
    """VersionedFieldSchema is frozen — mutation raises an error."""
    fs = VersionedFieldSchema(
        name="name",
        ttype="char",
        store=True,
        readonly=False,
        compute=None,
        relation=None,
        required=False,
    )
    with pytest.raises(ValidationError):
        fs.store = False  # type: ignore[misc]


def test_versioned_field_schema_store_false() -> None:
    """VersionedFieldSchema with store=False stores the value correctly."""
    fs = VersionedFieldSchema(
        name="display_name",
        ttype="char",
        store=False,
        readonly=True,
        compute="_compute_display_name",
        relation=None,
        required=False,
    )
    assert fs.store is False
    assert fs.compute == "_compute_display_name"


# ---------------------------------------------------------------------------
# VersionedModelSchema archivable derivation
# ---------------------------------------------------------------------------


def test_archivable_true_when_active_stored() -> None:
    """VersionedModelSchema with active (store=True) is archivable."""
    active_field = _make_versioned_field("active", ttype="boolean", store=True)
    name_field = _make_versioned_field("name", ttype="char", store=True)
    schema = VersionedModelSchema(
        name="project.project",
        display_name="Project",
        transient=False,
        odoo_version="17.0",
        archivable=True,
        fields={"active": active_field, "name": name_field},
    )
    assert schema.archivable is True


def test_archivable_false_when_no_active_field() -> None:
    """VersionedModelSchema without active field is not archivable."""
    name_field = _make_versioned_field("name", ttype="char", store=True)
    schema = VersionedModelSchema(
        name="some.transient",
        display_name="Transient Model",
        transient=True,
        odoo_version="17.0",
        archivable=False,
        fields={"name": name_field},
    )
    assert schema.archivable is False


# ---------------------------------------------------------------------------
# VersionedSnapshot save / load round-trip
# ---------------------------------------------------------------------------


def test_snapshot_save_load_round_trip(tmp_path: Path) -> None:
    """VersionedSnapshot.save() then .load() returns identical field data."""
    snap = _make_minimal_snapshot()
    path = tmp_path / "snap.json"
    snap.save(path)
    assert path.exists()

    loaded = VersionedSnapshot.load(path, "17.0")
    assert loaded.odoo_version == "17.0"
    assert loaded.schema_format_version == SCHEMA_FORMAT_VERSION
    assert "res.partner" in loaded.models
    partner = loaded.models["res.partner"]
    assert "name" in partner.fields
    assert partner.fields["name"].store is True


def test_snapshot_save_creates_parent_dirs(tmp_path: Path) -> None:
    """VersionedSnapshot.save() creates parent directories if missing."""
    snap = _make_minimal_snapshot()
    path = tmp_path / "deep" / "nested" / "dir" / "snap.json"
    snap.save(path)
    assert path.exists()


# ---------------------------------------------------------------------------
# VersionedSnapshot.load() version mismatch
# ---------------------------------------------------------------------------


def test_load_raises_on_schema_format_version_mismatch(tmp_path: Path) -> None:
    """VersionedSnapshot.load() raises VersionMismatchError on schema format version mismatch."""
    snap_with_future_version = _make_minimal_snapshot(schema_format_version=999)
    path = tmp_path / "future_snap.json"
    snap_with_future_version.save(path)

    with pytest.raises(VersionMismatchError) as exc_info:
        VersionedSnapshot.load(path, "17.0")
    assert "schema format version" in str(exc_info.value).lower()


def test_load_raises_on_odoo_version_mismatch(tmp_path: Path) -> None:
    """VersionedSnapshot.load() raises VersionMismatchError on Odoo version mismatch."""
    snap_v17 = _make_minimal_snapshot(odoo_version="17.0")
    path = tmp_path / "v17_snap.json"
    snap_v17.save(path)

    with pytest.raises(VersionMismatchError) as exc_info:
        VersionedSnapshot.load(path, "18.0")
    # Error message must mention "odoo version" (case-insensitive)
    assert "odoo version" in str(exc_info.value).lower()


def test_load_schema_format_check_before_odoo_version(tmp_path: Path) -> None:
    """schema_format_version is checked before odoo_version."""
    # Both mismatches: schema_format_version=999 AND wrong odoo_version
    snap = _make_minimal_snapshot(schema_format_version=999, odoo_version="17.0")
    path = tmp_path / "both_mismatch.json"
    snap.save(path)

    with pytest.raises(VersionMismatchError) as exc_info:
        VersionedSnapshot.load(path, "18.0")  # also wrong odoo version
    # Should report schema format version (first check) not odoo version
    assert "schema format version" in str(exc_info.value).lower()


# ---------------------------------------------------------------------------
# SchemaRegistry._instance_hash
# ---------------------------------------------------------------------------


def test_instance_hash_returns_16_char_hex() -> None:
    """SchemaRegistry._instance_hash returns a 16-char hex string."""
    h = SchemaRegistry._instance_hash("http://localhost:8069", "mydb")
    assert len(h) == 16
    assert all(c in "0123456789abcdef" for c in h)


def test_instance_hash_stable() -> None:
    """Same (url, database) always produces the same hash."""
    url = "http://localhost:8069"
    db = "prod"
    h1 = SchemaRegistry._instance_hash(url, db)
    h2 = SchemaRegistry._instance_hash(url, db)
    assert h1 == h2


def test_instance_hash_different_for_different_inputs() -> None:
    """Different (url, database) pairs produce different hashes."""
    h1 = SchemaRegistry._instance_hash("http://localhost:8069", "db1")
    h2 = SchemaRegistry._instance_hash("http://localhost:8069", "db2")
    assert h1 != h2


# ---------------------------------------------------------------------------
# SchemaRegistry.get() — mocked Introspector
# ---------------------------------------------------------------------------


async def test_registry_get_wraps_model_schema() -> None:
    """SchemaRegistry.get() wraps ModelSchema into VersionedModelSchema with correct odoo_version."""
    # Build a ModelSchema with known fields
    raw_fields: dict[str, FieldSchema] = {
        "name": _make_field_schema("name", ttype="char", store=True),
        "display_name": _make_field_schema(
            "display_name",
            ttype="char",
            store=False,
            readonly=True,
            compute="_compute_display_name",
        ),
        "active": _make_field_schema("active", ttype="boolean", store=True),
    }
    raw_schema = _make_model_schema("res.partner", raw_fields)

    mock_client = MagicMock()
    mock_introspector = MagicMock()
    mock_introspector.get_schema = AsyncMock(return_value=raw_schema)

    registry = SchemaRegistry(mock_client, OdooVersion(17, 0))

    with patch.object(registry, "_introspector", mock_introspector):
        result = await registry.get("res.partner")

    assert isinstance(result, VersionedModelSchema)
    assert result.odoo_version == "17.0"
    assert result.name == "res.partner"
    assert result.archivable is True  # has stored active field

    # store values must be propagated correctly
    assert result.fields["name"].store is True
    assert result.fields["display_name"].store is False
    assert result.fields["active"].store is True


async def test_registry_get_archivable_false_without_active() -> None:
    """SchemaRegistry.get() sets archivable=False when model has no 'active' field."""
    raw_schema = _make_model_schema(
        "account.move.line",
        {
            "name": _make_field_schema("name", ttype="char", store=True),
        },
    )
    mock_client = MagicMock()
    mock_introspector = MagicMock()
    mock_introspector.get_schema = AsyncMock(return_value=raw_schema)

    registry = SchemaRegistry(mock_client, OdooVersion(17, 0))
    with patch.object(registry, "_introspector", mock_introspector):
        result = await registry.get("account.move.line")

    assert result.archivable is False


async def test_registry_get_uses_in_memory_cache() -> None:
    """SchemaRegistry.get() uses in-memory cache — second call does not hit Introspector."""
    raw_schema = _make_model_schema("res.partner", {"name": _make_field_schema("name")})

    mock_client = MagicMock()
    mock_introspector = MagicMock()
    mock_introspector.get_schema = AsyncMock(return_value=raw_schema)

    registry = SchemaRegistry(mock_client, OdooVersion(17, 0))
    with patch.object(registry, "_introspector", mock_introspector):
        first = await registry.get("res.partner")
        second = await registry.get("res.partner")

    assert first is second  # same object from cache
    mock_introspector.get_schema.assert_called_once()  # only one RPC


async def test_registry_get_bypass_cache() -> None:
    """SchemaRegistry.get(bypass_cache=True) always calls Introspector."""
    raw_schema = _make_model_schema("res.partner", {"name": _make_field_schema("name")})

    mock_client = MagicMock()
    mock_introspector = MagicMock()
    mock_introspector.get_schema = AsyncMock(return_value=raw_schema)

    registry = SchemaRegistry(mock_client, OdooVersion(17, 0))
    with patch.object(registry, "_introspector", mock_introspector):
        await registry.get("res.partner")
        await registry.get("res.partner", bypass_cache=True)

    assert mock_introspector.get_schema.call_count == 2
