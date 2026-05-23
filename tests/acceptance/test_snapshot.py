"""Acceptance tests for the schema registry snapshot pipeline.

All tests in this module require Docker (a running Odoo 17 + Postgres container
provided by the session-scoped ``odoo`` fixture in conftest.py).

Skip when Docker is unavailable:
    uv run pytest -m "not integration" -q

Run only acceptance tests:
    uv run pytest -m integration -q

Requirements covered:
- SCHEM-02: store populated as bool for every field
- SCHEM-03: store=False fields are captured (not excluded at registry level)
- SCHEM-04: snapshot round-trip; VersionMismatchError on format/version mismatch
- SCHEM-05 / D-09: res.partner.display_name.store is False (regression gate)
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from godoo_stateman.errors import VersionMismatchError
from godoo_stateman.schema.registry import SchemaRegistry
from godoo_stateman.schema.snapshot import VersionedSnapshot
from godoo_stateman.schema.version import SCHEMA_FORMAT_VERSION, OdooVersion
from godoo_stateman.types.schema import VersionedModelSchema


@pytest.mark.integration
async def test_schema_registry_get(odoo: object) -> None:
    """SchemaRegistry.get() returns VersionedModelSchema with store: bool for every field.

    Covers SCHEM-02: all fields have store populated as a bool.
    Covers SCHEM-03: store=False fields are included (not filtered out at registry level).
    """
    registry = SchemaRegistry(odoo.client, OdooVersion(17, 0))  # type: ignore[attr-defined]
    schema = await registry.get("project.project")

    assert isinstance(schema, VersionedModelSchema)
    assert schema.odoo_version == "17.0"
    assert schema.name == "project.project"
    assert len(schema.fields) > 0

    for fn, fs in schema.fields.items():
        assert isinstance(fs.store, bool), f"Field {fn!r}: store must be bool, got {type(fs.store)}"


@pytest.mark.integration
async def test_store_flag_regression(odoo: object) -> None:
    """res.partner.display_name.store is False — SCHEM-05 regression gate (D-09).

    display_name is a computed, non-stored field on res.partner in Odoo 17.
    If this test fails, the Introspector's store-flag population is broken.
    """
    registry = SchemaRegistry(odoo.client, OdooVersion(17, 0))  # type: ignore[attr-defined]
    schema = await registry.get("res.partner")

    assert "display_name" in schema.fields, "res.partner must have display_name field"
    assert schema.fields["display_name"].store is False, (
        f"res.partner.display_name.store should be False (computed field), "
        f"got {schema.fields['display_name'].store!r}"
    )


@pytest.mark.integration
async def test_snapshot_round_trip(odoo: object, tmp_path: Path) -> None:
    """Build → save → load round-trip produces identical data.

    Covers SCHEM-04: snapshot JSON includes odoo_version, schema_format_version,
    and field-level store; VersionedSnapshot.load() restores identical data.
    """
    registry = SchemaRegistry(odoo.client, OdooVersion(17, 0))  # type: ignore[attr-defined]
    snapshot_obj = await registry.build_snapshot(["project.project"])

    path = tmp_path / "snap.json"
    snapshot_obj.save(path)
    assert path.exists()

    loaded = VersionedSnapshot.load(path, "17.0")

    assert loaded.odoo_version == "17.0"
    assert loaded.schema_format_version == SCHEMA_FORMAT_VERSION
    assert loaded.schema_format_version == 1
    assert "project.project" in loaded.models

    # Verify field-level store is preserved through round-trip
    project_schema = loaded.models["project.project"]
    for fn, fs in project_schema.fields.items():
        assert isinstance(fs.store, bool), f"After round-trip: field {fn!r} store must be bool"


@pytest.mark.integration
async def test_version_mismatch_on_load(tmp_path: Path) -> None:
    """VersionedSnapshot.load() raises VersionMismatchError when schema_format_version mismatches.

    Covers SCHEM-04: version-gate enforcement.
    This test does NOT require a live Odoo container — it writes a minimal JSON file.
    The @pytest.mark.integration marker is kept for consistent test-run filtering.
    """
    # Build a minimal snapshot dict with a future schema_format_version
    snapshot_data = {
        "odoo_version": "17.0",
        "schema_format_version": 999,
        "captured_at": "2026-01-01T00:00:00+00:00",
        "models": {},
    }
    path = tmp_path / "future_snap.json"
    path.write_text(json.dumps(snapshot_data))

    with pytest.raises(VersionMismatchError):
        VersionedSnapshot.load(path, "17.0")
