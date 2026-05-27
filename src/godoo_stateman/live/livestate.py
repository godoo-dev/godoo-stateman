"""LiveState — read-only snapshot of managed Odoo state at plan time.

Performs two rounds of ``search_read`` against the live Odoo instance:

1. Scan ``ir.model.data`` for all rows whose ``module`` equals the config's
   ``xmlid_prefix`` — this defines the *managed universe* (D-04).
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
        managed:     slug → XmlIdRecord for every ``ir.model.data`` row whose
                     ``module`` equals the config's ``xmlid_prefix``.
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
    ) -> LiveState:
        """Fetch all managed state from the live Odoo instance.

        Args:
            client:                  Authenticated ``OdooClient`` (read-only — no writes).
            xmlid_prefix:            The ``xmlid_prefix`` declared in the DSL config.
                                     Only ``ir.model.data`` rows with ``module=xmlid_prefix``
                                     are fetched (D-04 managed-universe definition).
            desired_fields_by_model: Mapping of model name → set of field names declared in
                                     the corresponding ``ResourceNode.fields`` dicts.  Used
                                     to build the ``fields=`` projection for each per-model
                                     ``search_read`` call.

        Returns:
            A frozen ``LiveState`` with the ``managed`` dict and ``live_fields`` dict
            populated from live Odoo data.
        """
        # Step 1: scan the managed universe from ir.model.data (D-04).
        # Minimal fields= projection — avoids binary/compute fields (T-03-03).
        # order="name" ensures deterministic slug ordering (SC-2).
        managed_rows = await client.search_read(
            "ir.model.data",
            [("module", "=", xmlid_prefix)],
            fields=["name", "model", "res_id"],
            order="name",
        )

        # Build the managed dict: slug (ir.model.data "name") → XmlIdRecord
        managed: dict[str, XmlIdRecord] = {
            str(r["name"]): XmlIdRecord(
                module=xmlid_prefix,
                name=str(r["name"]),
                model=str(r["model"]),
                res_id=int(r["res_id"]),
                complete_name=f"{xmlid_prefix}.{r['name']}",
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
