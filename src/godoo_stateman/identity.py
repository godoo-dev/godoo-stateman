"""xmlid helpers for godoo-stateman.

Provides ``find_by_xmlid`` and ``write_xmlid`` — the two ``ir.model.data``
operations that godoo-py's client does not expose as standalone helpers.

These are the sole mechanism for reading and writing Odoo-side identity in
every downstream phase (import command, apply stage).

Design decisions
----------------
- ``find_by_xmlid`` returns ``None`` on absence — never raises (contrast with
  ``OdooClient.ref()`` which raises ``OdooMissingError``).
- ``write_xmlid`` is an idempotent upsert:
    * absent  → create
    * same model, same res_id → no-op
    * same model, different res_id → update res_id on the ir.model.data row
    * different model → raise ``OdooValidationError`` (model-mismatch guard)
- ``complete_name`` on ``XmlIdRecord`` is constructed in Python as
  ``f"{module}.{name}"`` — never fetched from Odoo (Open Question Q1 RESOLVED).
- ``noupdate=True`` tells Odoo not to overwrite stateman-owned xmlids during
  module upgrades (T-03-03 accepted disposition).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, cast

from godoo.client.errors import OdooValidationError

if TYPE_CHECKING:
    from godoo.client.client import OdooClient


@dataclass(frozen=True)
class XmlIdRecord:
    """An ``ir.model.data`` row resolved to its stateman-facing shape.

    ``complete_name`` is always ``f"{module}.{name}"`` — constructed here,
    never fetched from Odoo (the Odoo-side ``complete_name`` column is
    computed and may not be populated on older CE versions).
    """

    module: str
    name: str
    model: str
    res_id: int
    complete_name: str


async def find_by_xmlid(
    client: OdooClient,
    module: str,
    name: str,
) -> XmlIdRecord | None:
    """Return the ``XmlIdRecord`` for ``module.name``, or ``None`` if absent.

    Never raises for a missing xmlid — the caller decides how to handle absence.

    Security note: ``res_id`` is coerced via ``int()`` after confirming the
    result list is non-empty; Odoo may return ``False`` for an unset field
    (T-03-02).
    """
    records = await client.search_read(
        "ir.model.data",
        [("module", "=", module), ("name", "=", name)],
        fields=["id", "res_id", "model"],
        limit=1,
    )
    if not records:
        return None
    r = records[0]
    return XmlIdRecord(
        module=module,
        name=name,
        model=str(r["model"]),
        res_id=int(r["res_id"]),
        complete_name=f"{module}.{name}",
    )


async def write_xmlid(
    client: OdooClient,
    model: str,
    res_id: int,
    module: str,
    name: str,
) -> XmlIdRecord:
    """Idempotent upsert for an ``ir.model.data`` row.

    Behaviour matrix:
    - absent               → ``client.create("ir.model.data", {..., noupdate: True})``
    - same model + res_id  → no-op (return existing record as XmlIdRecord)
    - same model, new res_id → ``client.write("ir.model.data", [row_id], {"res_id": res_id})``
    - different model      → raise ``OdooValidationError`` (T-03-01 model-mismatch guard)

    The write path fetches ``id`` (the ir.model.data row's own PK) in a
    second ``search_read`` call to avoid passing ``res_id`` where Odoo
    expects the row id.
    """
    existing = await find_by_xmlid(client, module, name)

    if existing is None:
        await client.create(
            "ir.model.data",
            {
                "model": model,
                "res_id": res_id,
                "module": module,
                "name": name,
                "noupdate": True,
            },
        )
    elif existing.model != model:
        raise OdooValidationError(
            f"xmlid {module!r}.{name!r} model mismatch: "
            f"points to {existing.model!r}, expected {model!r}"
        )
    elif existing.res_id != res_id:
        # Fetch the ir.model.data row's own PK (id) for the write call.
        rows = await client.search_read(
            "ir.model.data",
            [("module", "=", module), ("name", "=", name)],
            fields=["id"],
            limit=1,
        )
        row_id = cast("int", int(rows[0]["id"]))
        await client.write("ir.model.data", [row_id], {"res_id": res_id})

    return XmlIdRecord(
        module=module,
        name=name,
        model=model,
        res_id=res_id,
        complete_name=f"{module}.{name}",
    )
