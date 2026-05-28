"""import command — adopt an existing Odoo record into stateman managed state.

This is the ONLY command that writes to Odoo (specifically to ``ir.model.data``).
All other commands (plan, apply) are read-only at the ir.model.data level.

Implementation follows the D-10/D-11 validate-before-write flow:
    1. ``search_read`` the target model by ``--id`` to confirm the record EXISTS.
    2. ``find_by_xmlid(module, name)`` to check for an existing binding:
       - Same ``res_id`` → idempotent no-op, exit 0 (IDENT-05).
       - Different ``res_id`` + ``force=False`` → error message + exit 1 (SAFE-03).
       - Different ``res_id`` + ``force=True`` → fall through to write.
    3. ``write_xmlid(client, model, record_id, module, name)`` + exit 0.

Credentials are read from environment variables (T-03-16):
    GODOO_URL       — Odoo base URL (e.g. https://odoo.example.com)
    GODOO_DB        — Database name
    GODOO_USER      — Login username
    GODOO_PASSWORD  — Password

CLI flags (D-10 / SC-5):
    --model     Odoo model name (e.g. res.partner)
    --id        Record ID to import (positive integer)
    --module    xmlid prefix (module segment in ir.model.data)
    --name      xmlid slug (name segment in ir.model.data)
    --force     Overwrite existing xmlid binding if it points to a different record
"""

from __future__ import annotations

import asyncio
import os

import typer
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooValidationError
from rich.console import Console

from godoo_stateman.errors import StatemanError
from godoo_stateman.identity import find_by_xmlid, write_xmlid

console = Console(force_terminal=False)


async def _import_impl(
    model: str,
    record_id: int,
    module: str,
    name: str,
    force: bool,
) -> int:
    """Async implementation of the import command.

    Returns:
        0 — success (new import or idempotent no-op)
        1 — error (record not found, collision without --force, or unexpected error)
    """
    # Read Odoo credentials from environment variables (T-03-16).
    missing: list[str] = []
    url = os.environ.get("GODOO_URL", "")
    db = os.environ.get("GODOO_DB", "")
    user = os.environ.get("GODOO_USER", "")
    password = os.environ.get("GODOO_PASSWORD", "")
    if not url:
        missing.append("GODOO_URL")
    if not db:
        missing.append("GODOO_DB")
    if not user:
        missing.append("GODOO_USER")
    if not password:
        missing.append("GODOO_PASSWORD")
    if missing:
        console.print(f"[red]Missing required environment variable(s): {', '.join(missing)}[/red]")
        return 1

    try:
        async with OdooClient(OdooClientConfig(url=url, database=db, username=user, password=password)) as client:
            # Step 1 (D-11 validate-before-write): confirm the record exists in Odoo.
            # Catches typos pre-mutation and satisfies IaC validate-before-write contract.
            # T-03-15: also confirms the record is in the declared model (not another model).
            records = await client.search_read(
                model,
                [("id", "=", record_id)],
                fields=["id"],
                limit=1,
            )
            if not records:
                console.print(f"[red]Record {model}:{record_id} not found in Odoo[/red]")
                return 1

            # Step 2 (D-11 collision check): check for an existing xmlid binding.
            existing = await find_by_xmlid(client, module, name)
            if existing is not None:
                if existing.res_id == record_id:
                    # Idempotent no-op: same binding already exists (IDENT-05).
                    console.print(f"[dim]Already managed: {module}.{name} -> {model}:{record_id}[/dim]")
                    return 0
                if not force:
                    # SAFE-03: no silent clobber — print actionable message before exit 1.
                    # The message MUST reference the existing binding so the operator
                    # understands what they are about to overwrite (W3 in RESEARCH.md).
                    console.print(
                        f"[red]xmlid {module}.{name} already bound to "
                        f"{existing.model}:{existing.res_id}. "
                        f"Use --force to overwrite.[/red]"
                    )
                    return 1
                # --force=True: fall through to write (operator acknowledged collision).

            # Step 3 (D-11 write): create or update the xmlid binding.
            await write_xmlid(client, model, record_id, module, name)
            console.print(f"[green]+[/green] Imported: {module}.{name} -> {model}:{record_id}")
            return 0

    except (StatemanError, OdooValidationError) as exc:
        # OdooValidationError is raised by write_xmlid when the existing ir.model.data
        # row points to a different model than the one being imported (WR-02 fix).
        # It is operator-actionable (model mismatch) so it deserves a clean message,
        # not the generic "Unexpected error" label from the bare except-Exception branch.
        console.print(f"[red]{exc}[/red]")
        return 1
    except Exception as exc:
        console.print(f"[red]Unexpected error: {exc}[/red]")
        return 1


def import_(
    model: str = typer.Option(
        ...,
        "--model",
        help="Odoo model name (e.g. res.partner)",
    ),
    id_: int = typer.Option(
        ...,
        "--id",
        help="Record ID to import (positive integer)",
    ),
    module: str = typer.Option(
        ...,
        "--module",
        help="xmlid prefix (module segment in ir.model.data)",
    ),
    name: str = typer.Option(
        ...,
        "--name",
        help="xmlid slug (name segment in ir.model.data)",
    ),
    force: bool = typer.Option(
        False,
        "--force",
        help="Overwrite existing xmlid binding if it points to a different record",
    ),
) -> None:
    """Import an existing Odoo record into stateman managed state.

    Writes an xmlid entry to ir.model.data, making the record visible to
    subsequent ``plan`` and ``apply`` runs as a managed resource.

    This is the ONLY stateman command that writes to Odoo. The ``plan``
    command is strictly read-only.

    Exit codes:
      0 — success (new binding created or idempotent no-op)
      1 — error (record not found, collision requires --force, or connection error)
    """
    # T-03-14: reject non-positive IDs before any Odoo call.
    # Typer's int type catches non-integers; this guard catches 0 and negatives.
    if id_ <= 0:
        console.print(f"[red]--id must be a positive integer, got {id_}[/red]")
        raise typer.Exit(code=1)

    exit_code = asyncio.run(_import_impl(model, id_, module, name, force))
    raise typer.Exit(code=exit_code)
