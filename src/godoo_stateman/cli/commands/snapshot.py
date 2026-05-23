"""snapshot command — introspect live Odoo and persist a versioned schema snapshot."""

from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path

import typer
from rich.console import Console
from rich.panel import Panel

from godoo.client.client import OdooClient, OdooClientConfig

from godoo_stateman.schema.registry import SchemaRegistry
from godoo_stateman.schema.version import OdooVersion

# Phase 1: hardcoded model list — real enumeration from config content comes in Phase 3.
_PHASE1_MODELS: list[str] = ["project.project", "res.partner"]


def snapshot(
    config: Path = typer.Argument(..., help="Path to stateman config .py file"),
) -> None:
    """Introspect live Odoo and persist a versioned schema snapshot."""
    asyncio.run(_snapshot_impl(config))


async def _snapshot_impl(config: Path) -> None:
    """Async implementation — read env credentials, connect to Odoo, write snapshot."""
    console = Console()

    # -------------------------------------------------------------------------
    # Step 1: Read credentials from environment — never from CLI args or config
    # T-02-01: credentials read from env only; print var NAMES not values
    # -------------------------------------------------------------------------
    url = os.environ.get("ODOO_URL")
    database = os.environ.get("ODOO_DB") or os.environ.get("ODOO_DATABASE")
    username = os.environ.get("ODOO_USER") or os.environ.get("ODOO_USERNAME")
    password = os.environ.get("ODOO_PASSWORD")

    missing: list[str] = []
    if not url:
        missing.append("ODOO_URL")
    if not database:
        missing.append("ODOO_DB (or ODOO_DATABASE)")
    if not username:
        missing.append("ODOO_USER (or ODOO_USERNAME)")
    if not password:
        missing.append("ODOO_PASSWORD")

    if missing:
        raise typer.BadParameter(f"Missing required environment variables: {', '.join(missing)}")

    # -------------------------------------------------------------------------
    # Step 2: Validate ODOO_VERSION — T-02-03 path traversal guard
    # -------------------------------------------------------------------------
    odoo_version_str = os.environ.get("ODOO_VERSION", "17.0")
    if not re.match(r"^\d+\.\d+$", odoo_version_str):
        raise typer.BadParameter("ODOO_VERSION must match N.N format (e.g. '17.0')")

    parts = odoo_version_str.split(".")
    odoo_version = OdooVersion(major=int(parts[0]), minor=int(parts[1]))

    # -------------------------------------------------------------------------
    # Step 3: Connect to Odoo
    # -------------------------------------------------------------------------
    # T-02-04: warn on unencrypted connection to non-local host (ASVS L1 — warn, not block)
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme == "http":
        host = parsed.hostname or ""
        if host not in ("localhost", "127.0.0.1"):
            console.print(
                "[yellow]Warning: connecting over http to a non-local host — "
                "credentials sent in plaintext[/yellow]"
            )

    client_config = OdooClientConfig(
        url=url,
        database=database,
        username=username,
        password=password,
    )

    # -------------------------------------------------------------------------
    # Step 4: Build snapshot via SchemaRegistry
    # -------------------------------------------------------------------------
    async with OdooClient(client_config) as client:
        registry = SchemaRegistry(client, odoo_version)

        # Phase 1: snapshot a fixed set of models (Phase 3 will enumerate from config)
        snapshot_obj = await registry.build_snapshot(_PHASE1_MODELS)

        cache_path = registry.cache_path(url, database)
        snapshot_obj.save(cache_path)

    console.print(Panel(f"Snapshot saved to {cache_path}", title="godoo-stateman snapshot", style="green"))
