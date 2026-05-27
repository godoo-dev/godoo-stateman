"""Read-seam resolution — DataSourceNode selectors and Deferred.fn firing.

The read seam sits between the pure DSL pipeline and the live Odoo diff stage.
It performs two kinds of resolution at plan time (before field comparison):

1. ``resolve_data_sources``: maps each ``DataSourceNode.selector`` to a remote
   integer ``res_id`` via ``search_read``.  Raises ``LiveStateFetchError`` if the
   selector matches 0 or >1 records (Pitfall 5 — never silently pick wrong data).

2. ``resolve_deferred``: replaces ``Deferred`` field values in a ``ResourceNode``
   with their fired results, using the ``seam_result`` dict from step 1.
   Returns a NEW ``ResourceNode`` via ``dataclasses.replace`` — never mutates the
   original ``ResourceNode.fields`` dict in place (Pitfall 7).

Both operations are read-only.  ``resolve_data_sources`` is async (makes live
Odoo calls); ``resolve_deferred`` is synchronous (``Deferred.fn`` is a pure
Python callable, not a coroutine).
"""

from __future__ import annotations

import dataclasses
from typing import TYPE_CHECKING, Any

from godoo_stateman.dsl.types.deferred import Deferred
from godoo_stateman.dsl.types.nodes import ResourceNode
from godoo_stateman.errors import LiveStateFetchError

if TYPE_CHECKING:
    from godoo.client.client import OdooClient
    from godoo_stateman.dsl.types.nodes import DataSourceNode


async def resolve_data_sources(
    client: OdooClient,
    data_sources: tuple[DataSourceNode, ...],
) -> dict[str, int]:
    """Resolve all DataSourceNode selectors to remote integer IDs (REL-03).

    For each ``DataSourceNode``:
    - Build an Odoo search domain from ``selector`` — equality-only for Phase 3
      (A3 assumption from RESEARCH.md).  ``sorted()`` on items ensures a
      deterministic domain order (SC-2).
    - Issue ``search_read(model, domain, fields=["id"], limit=2)`` — ``limit=2``
      is deliberate: it detects the ambiguous-selector case (>1 match) without
      fetching a potentially large result set.
    - Raise ``LiveStateFetchError`` when ``len(records) != 1`` (Pitfall 5).

    Args:
        client:       Authenticated ``OdooClient``.
        data_sources: Tuple of ``DataSourceNode`` descriptors from ``DesiredState``.

    Returns:
        ``{node_key: res_id}`` mapping for every data source.

    Raises:
        LiveStateFetchError: If any selector resolves to 0 or >1 records.
    """
    result: dict[str, int] = {}

    for ds in data_sources:
        # Build equality domain sorted for determinism (SC-2).
        domain: list[Any] = [(k, "=", v) for k, v in sorted(ds.selector.items())]

        records = await client.search_read(
            ds.model,
            domain,
            fields=["id"],
            limit=2,
        )

        if len(records) != 1:
            raise LiveStateFetchError(
                f"DataSource {ds.node_key!r}: expected exactly 1 record, got {len(records)} "
                f"(model={ds.model!r}, selector={ds.selector!r}). "
                "Check the selector for typos or ambiguity."
            )

        result[ds.node_key] = int(records[0]["id"])

    return result


def resolve_deferred(
    resource: ResourceNode,
    seam_result: dict[str, int],
) -> ResourceNode:
    """Return a new ResourceNode with all Deferred field values fired (REL-04).

    For each field in ``resource.fields``:
    - If the value is a ``Deferred``, call ``fval.fn(*resolved_args)`` where
      ``resolved_args`` are the ``seam_result`` values for ``fval.deps`` (sorted
      for determinism — SC-2).
    - Otherwise, copy the value unchanged (passthrough).

    Returns a NEW ``ResourceNode`` via ``dataclasses.replace`` — the original
    ``resource.fields`` dict is never mutated (Pitfall 7 prevention).

    Args:
        resource:     The ``ResourceNode`` whose fields may contain ``Deferred`` values.
        seam_result:  ``{node_key: res_id}`` mapping from ``resolve_data_sources``.

    Returns:
        A new ``ResourceNode`` with all ``Deferred`` values replaced by their
        fired results.  Non-``Deferred`` fields are copied unchanged.
    """
    resolved: dict[str, Any] = {}

    for fname, fval in resource.fields.items():
        if isinstance(fval, Deferred):
            # Sort deps for deterministic argument order (SC-2).
            resolved_args = [seam_result[dep] for dep in sorted(fval.deps)]
            resolved[fname] = fval.fn(*resolved_args)
        else:
            resolved[fname] = fval

    # Produce a new frozen ResourceNode — never mutate resource.fields in place.
    return dataclasses.replace(resource, fields=resolved)
