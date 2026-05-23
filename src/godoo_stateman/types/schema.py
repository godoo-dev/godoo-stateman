"""Versioned Pydantic v2 schema types for godoo-stateman.

VersionedFieldSchema and VersionedModelSchema are frozen Pydantic models.
They mirror a subset of godoo-introspection's FieldSchema / ModelSchema but
carry an explicit Odoo version dimension and support JSON serialization via
model_dump_json().
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class VersionedFieldSchema(BaseModel):
    """Versioned field-level schema — frozen Pydantic model.

    Carries the subset of field metadata needed by the plan/apply pipeline:
    whether the field is stored (writable to Odoo's DB), its type, and
    relation info for dependency graph construction.
    """

    model_config = ConfigDict(frozen=True)

    name: str
    ttype: str
    store: bool
    readonly: bool
    compute: str | None
    relation: str | None
    required: bool


class VersionedModelSchema(BaseModel):
    """Versioned model-level schema — frozen Pydantic model.

    The `archivable` flag is derived by the caller (SchemaRegistry.get):
    True iff the model has a stored, writable `active` field.
    """

    model_config = ConfigDict(frozen=True)

    name: str
    display_name: str
    transient: bool
    odoo_version: str  # str representation of OdooVersion, e.g. "17.0"
    archivable: bool   # True if model has a stored writable 'active' field
    fields: dict[str, VersionedFieldSchema]
