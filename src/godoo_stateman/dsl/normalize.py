"""Normalize stage — canonicalize field values before diff comparison.

Converts Odoo False/None patterns to stable internal representations using
VersionedSnapshot field metadata. This stage is called after eval_config() and
before build_graph(), ensuring the diff stage (Phase 3) compares bit-identical
canonical values rather than raw DSL-authored values.

Key rules (schema-driven via VersionedFieldSchema.ttype):
- many2many / one2many: False/None → []; non-empty list/tuple → sorted(list(value))
- many2one: False/None → None; (id, name) tuple/list → int(id)
- boolean: False preserved as False (A1 decision — active=False means archive)
- all other scalars (char, integer, date, float, selection, …): False → None

When snapshot is None, all schema-dependent rules are skipped and the input
DesiredState is returned unchanged (documented fast-path for callers without
a cached snapshot).
"""

from __future__ import annotations

import dataclasses
from typing import Any

from godoo_stateman.dsl.types.desired import DesiredState
from godoo_stateman.dsl.types.nodes import ResourceNode
from godoo_stateman.schema.snapshot import VersionedSnapshot

_M2X_TYPES: frozenset[str] = frozenset({"many2many", "one2many"})
"""Relation field types that normalize to sorted lists (many2many and one2many)."""


def _normalize_value(value: Any, ttype: str) -> Any:
    """Return the canonical internal value for *value* given its Odoo field *ttype*.

    This is a pure function with no side effects. Each call is O(1) except for
    many2many/one2many where it is O(n log n) due to sort.

    Boolean carve-out (A1 decision): ``ttype == "boolean"`` is exempted from the
    ``False``→``None`` scalar rule so that ``active = False`` (archive intent)
    survives normalization unchanged.
    """
    if ttype in _M2X_TYPES:
        # CORE-02: False/None → empty list for relation fields
        if value is False or value is None:
            return []
        # CORE-08: many2many order-irrelevant — sort for canonical comparison
        # Integer IDs are directly sortable; sorted() produces a stable canonical order.
        try:
            return sorted(list(value))
        except TypeError as exc:
            raise ValueError(
                f"Cannot sort {ttype!r} field value {value!r}: "
                "list elements must be mutually comparable (e.g. all integers). "
                f"Original error: {exc}"
            ) from exc
    elif ttype == "many2one":
        # CORE-02: False/None → None (unset many2one)
        if value is False or value is None:
            return None
        # CORE-08: (id, display_name) tuple or list → integer ID
        if isinstance(value, (list, tuple)) and len(value) == 2:
            return int(value[0])
        # Integer ID — already canonical (most common desired-state form).
        if isinstance(value, int):
            return value
        # Any other type (str, ResourceNode, float, …) is a programming error —
        # raise early rather than silently passing through a value that will always
        # produce a false-positive diff against the live integer ID (WR-03 fix).
        raise ValueError(
            f"many2one field value must be an int ID, (id, name) tuple/list, False, or None; "
            f"got {type(value).__name__!r}: {value!r}"
        )
    elif ttype == "boolean":
        # A1 decision (RESOLVED): preserve False as False for boolean fields.
        # active=False means "archive this resource"; converting to None would
        # make the diff stage unable to distinguish archive intent from unset.
        return value
    else:
        # Scalar: char, integer, date, float, selection, text, html, …
        # CORE-02: False → None (unset/empty marker)
        if value is False:
            return None
        return value


def normalize(state: DesiredState, snapshot: VersionedSnapshot | None) -> DesiredState:
    """Return a new DesiredState with field values canonicalized per *snapshot* schema.

    When *snapshot* is ``None``, schema-dependent rules cannot be applied and the
    input *state* is returned unchanged (documented skip path).

    data_sources and config_parameters are NOT normalized — selectors are
    author-supplied comparison values; config parameters are string key=value pairs.

    Produces new frozen :class:`~godoo_stateman.dsl.types.nodes.ResourceNode`
    instances via ``dataclasses.replace(node, fields=normalized_fields)`` — the
    original nodes are never mutated.
    """
    if snapshot is None:
        return state

    normalized_resources: list[ResourceNode] = []

    for resource in state.resources:
        model_schema = snapshot.models.get(resource.model)

        normalized_fields: dict[str, Any] = {}
        for field_name, value in resource.fields.items():
            field_schema = model_schema.fields.get(field_name) if model_schema is not None else None

            if field_schema is not None:
                normalized_fields[field_name] = _normalize_value(value, field_schema.ttype)
            else:
                # Unknown model or field — pass through unchanged.
                # The diff stage (Phase 3) will surface unrecognized fields against
                # the live Odoo schema. Passthrough here avoids silent data loss.
                normalized_fields[field_name] = value

        normalized_resources.append(dataclasses.replace(resource, fields=normalized_fields))

    return DesiredState(
        xmlid_prefix=state.xmlid_prefix,
        resources=tuple(normalized_resources),
        data_sources=state.data_sources,
        config_parameters=state.config_parameters,
    )
