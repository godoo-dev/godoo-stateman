"""serialize_fields — desired field dict → Odoo jsonrpc write payload.

The write-side twin of ``dsl/normalize.py``'s ``_normalize_value``: a pure,
no-I/O transform that switches on the field ``ttype`` from the schema snapshot.

Only the many2many case is non-trivial — it emits the Odoo ``(6, 0, [ids])``
SET command, which replaces the relation's entire set in one idempotent write
(REL-06). Slug references in an m2m value are resolved to ints through
:class:`~godoo_stateman.apply.state.GlobalLiveState` *before* the tuple is built,
so no slug string ever reaches Odoo (T-04-02). All other field types pass
through unchanged (A1: diff already normalizes m2o to int and m2m
order-insensitively, so desired-side scalars are already int / int-list).

The raw ``(6, 0, [...])`` tuple is sent over jsonrpc directly — stateman does
NOT import ``odoo.fields.Command`` (no server-side Odoo dependency).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from godoo_stateman.apply.state import GlobalLiveState
    from godoo_stateman.types.schema import VersionedModelSchema


def serialize_fields(
    model_schema: VersionedModelSchema,
    fields: dict[str, Any],
    gls: GlobalLiveState,
) -> dict[str, Any]:
    """Convert a desired field dict into an Odoo write payload.

    Args:
        model_schema: The model's versioned schema; ``model_schema.fields[name].ttype``
                      discriminates each field's relation kind.
        fields:       The desired field values (already normalized by the diff stage).
        gls:          The slug→int resolver, used to turn m2m slug references into ints.

    Returns:
        A new dict where many2many values become ``[(6, 0, [ids])]`` SET commands and
        all other values pass through unchanged.
    """
    out: dict[str, Any] = {}
    for name, value in fields.items():
        ttype = model_schema.fields[name].ttype
        if ttype == "many2many":
            # Resolve each element to an int: slug strings via GlobalLiveState,
            # everything else coerced through int(). Empty list → [(6, 0, [])]
            # which clears the relation (still idempotent).
            ids = [gls[v] if isinstance(v, str) else int(v) for v in value]
            out[name] = [(6, 0, ids)]
        else:
            # Scalar / many2one int / char / boolean — pass through unchanged.
            out[name] = value
    return out
