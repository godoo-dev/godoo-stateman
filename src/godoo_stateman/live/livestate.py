"""LiveState — read-only snapshot of managed Odoo state at plan time.

Performs two rounds of ``search_read`` against the live Odoo instance:

1. Scan ``ir.model.data`` for all rows whose ``module`` is in the full set of
   effective prefixes (the config's ``xmlid_prefix`` plus any per-resource
   ``xmlid_module`` overrides) — this defines the *managed universe* (D-04).
2. For each model found in that universe, issue one ``search_read`` against
   the model table to fetch the live field values for all managed records of
   that model (batch-fetch, not N+1 queries).

Both queries use explicit ``fields=`` projection and ``order=`` for
determinism (SC-2 / T-03-03).

Design note: ``LiveState`` is a frozen ``@dataclass`` (not Pydantic) because
it is an internal pipeline object, not a serialized artifact.  Downstream
stages (diff, render) consume it read-only.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from godoo_stateman.identity import XmlIdRecord

if TYPE_CHECKING:
    from godoo.client.client import OdooClient


@dataclass(frozen=True)
class LiveState:
    """Read-only snapshot of all managed resources and their live field values.

    Attributes:
        managed:     complete xmlid (``"{module}.{name}"``) → XmlIdRecord for every
                     ``ir.model.data`` row whose ``module`` is in the effective prefix
                     set (the config's ``xmlid_prefix`` plus any per-resource
                     ``xmlid_module`` overrides).
        live_fields: res_id → {field_name: live_value} for every managed record,
                     populated by the per-model ``search_read`` calls.
    """

    managed: dict[str, XmlIdRecord]
    live_fields: dict[int, dict[str, Any]]

    @classmethod
    async def fetch(
        cls,
        client: OdooClient,
        xmlid_prefix: str,
        desired_fields_by_model: dict[str, set[str]],
        extra_prefixes: set[str] | None = None,
    ) -> LiveState:
        """Fetch all managed state from the live Odoo instance.

        Args:
            client:                  Authenticated ``OdooClient`` (read-only — no writes).
            xmlid_prefix:            The ``xmlid_prefix`` declared in the DSL config.
                                     Always included in the managed-universe scan (D-04).
            desired_fields_by_model: Mapping of model name → set of field names declared in
                                     the corresponding ``ResourceNode.fields`` dicts.  Used
                                     to build the ``fields=`` projection for each per-model
                                     ``search_read`` call.
            extra_prefixes:          Additional ``xmlid_module`` prefixes used by per-resource
                                     overrides.  All prefixes (``xmlid_prefix`` plus
                                     ``extra_prefixes``) are scanned together in a single
                                     ``ir.model.data`` query using ``("module", "in", ...)``.
                                     ``None`` is treated as an empty set.

        Returns:
            A frozen ``LiveState`` with the ``managed`` dict (keyed by complete xmlid
            ``"{module}.{name}"``) and ``live_fields`` dict populated from live Odoo data.
        """
        # Build the full prefix set: primary prefix + any per-resource overrides.
        # Sorted for deterministic domain ordering (SC-2).
        all_prefixes: list[str] = sorted({xmlid_prefix} | (extra_prefixes or set()))

        # Step 1: scan the managed universe from ir.model.data (D-04).
        # Minimal fields= projection — avoids binary/compute fields (T-03-03).
        # Include "module" so we can key managed by complete xmlid "{module}.{name}".
        # order="name" ensures deterministic slug ordering (SC-2).
        managed_rows = await client.search_read(
            "ir.model.data",
            [("module", "in", all_prefixes)],
            fields=["name", "model", "res_id", "module"],
            order="name",
        )

        # Build the managed dict: complete xmlid ("{module}.{name}") → XmlIdRecord.
        # Keying by complete xmlid (not bare slug) supports per-resource xmlid_module
        # overrides: two resources with different modules but the same slug are distinct.
        managed: dict[str, XmlIdRecord] = {
            f"{r['module']!s}.{r['name']!s}": XmlIdRecord(
                module=str(r["module"]),
                name=str(r["name"]),
                model=str(r["model"]),
                res_id=int(r["res_id"]),
                complete_name=f"{r['module']!s}.{r['name']!s}",
            )
            for r in managed_rows
        }

        # Step 2: group res_ids by model, then issue one search_read per model.
        # Sorting res_ids ensures [("id","in",[...]) ] is deterministic (SC-2).
        model_to_res_ids: dict[str, list[int]] = {}
        for record in managed.values():
            model_to_res_ids.setdefault(record.model, []).append(record.res_id)

        live_fields: dict[int, dict[str, Any]] = {}

        for model, res_ids in sorted(model_to_res_ids.items()):
            # Always include "id" in the projection so we can key live_fields by res_id.
            # Desired fields (from ResourceNode.fields) plus "id" — never omit fields=.
            extra_fields = sorted(desired_fields_by_model.get(model, set()))
            fields_projection = ["id", *extra_fields]

            live_records = await client.search_read(
                model,
                [("id", "in", sorted(res_ids))],
                fields=fields_projection,
                order="id",  # deterministic (SC-2)
            )

            for row in live_records:
                live_fields[int(row["id"])] = row

        return cls(managed=managed, live_fields=live_fields)
