"""Shared GODOO_* connection helper (D-04, T-04-01).

Extracts the credential-read + ``ODOO_VERSION`` parse + ``OdooClient``
construction that ``plan.py`` and ``import_.py`` currently duplicate inline.
This module makes the contract available; Plan 02 refactors those commands to
consume it (kept non-overlapping with executor work this plan).

Security (ASVS V2 / T-04-01): credentials are read from the four ``GODOO_*``
environment variables ONLY — never from CLI args (process-listing leak). The
password is held on the frozen ``Connection`` object and passed straight into
``OdooClientConfig``; this module never logs or prints it.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

from godoo.client.client import OdooClient, OdooClientConfig

from godoo_stateman.schema.version import OdooVersion

_ODOO_VERSION_RE = re.compile(r"^\d+\.\d+$")


@dataclass(frozen=True)
class Connection:
    """Resolved Odoo connection parameters read from ``GODOO_*`` env vars.

    Frozen value object. ``password`` is sensitive — never log or print it.
    """

    url: str
    db: str
    user: str
    password: str
    odoo_version: OdooVersion


def read_connection() -> tuple[Connection | None, list[str]]:
    """Read connection parameters from the environment.

    Returns:
        A ``(connection, missing)`` tuple. ``connection`` is ``None`` when any
        required ``GODOO_*`` variable is missing; ``missing`` lists the missing
        variable names (empty on success). ``ODOO_VERSION`` defaults to ``"17.0"``
        and is validated against the ``N.N`` format.

    Raises:
        ValueError: if ``ODOO_VERSION`` is set but does not match ``N.N``.
    """
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
        return None, missing

    version_str = os.environ.get("ODOO_VERSION", "17.0")
    if not _ODOO_VERSION_RE.match(version_str):
        raise ValueError("ODOO_VERSION must match N.N format (e.g. '17.0')")
    major, minor = version_str.split(".")
    odoo_version = OdooVersion(major=int(major), minor=int(minor))

    return Connection(url=url, db=db, user=user, password=password, odoo_version=odoo_version), missing


def open_client(connection: Connection) -> OdooClient:
    """Construct an ``OdooClient`` from a resolved ``Connection``.

    The returned client is an async context manager: ``async with open_client(conn) as client:``.
    Credentials flow directly into ``OdooClientConfig`` without being logged.
    """
    return OdooClient(
        OdooClientConfig(
            url=connection.url,
            database=connection.db,
            username=connection.user,
            password=connection.password,
        )
    )
