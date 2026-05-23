"""Typer CLI application for godoo-stateman."""

from __future__ import annotations

import typer

from godoo_stateman.cli.commands.apply import apply
from godoo_stateman.cli.commands.import_ import import_
from godoo_stateman.cli.commands.plan import plan
from godoo_stateman.cli.commands.snapshot import snapshot
from godoo_stateman.cli.commands.verify import verify

app = typer.Typer(
    name="godoo-stateman",
    help="Terraform for Odoo — declarative Odoo state reconciliation over jsonrpc.",
    add_completion=False,
)

app.command()(plan)
app.command()(apply)
app.command()(verify)
app.command("import")(import_)
app.command()(snapshot)
