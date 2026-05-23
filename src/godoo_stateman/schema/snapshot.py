"""VersionedSnapshot — Pydantic model with save/load and version-gate enforcement."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from godoo_stateman.errors import VersionMismatchError
from godoo_stateman.schema.version import SCHEMA_FORMAT_VERSION
from godoo_stateman.types.schema import VersionedModelSchema


class VersionedSnapshot(BaseModel):
    """Immutable, JSON-serializable snapshot of versioned model schemas.

    The snapshot JSON includes three mandatory header fields:
      - ``odoo_version``: Odoo version string (e.g. "17.0")
      - ``schema_format_version``: snapshot format version (bumped on breaking changes)
      - ``captured_at``: ISO 8601 UTC timestamp of capture

    Loading raises :class:`~godoo_stateman.errors.VersionMismatchError` if either
    version field does not match expectations.
    """

    model_config = ConfigDict(frozen=True)

    odoo_version: str
    schema_format_version: int
    captured_at: str  # ISO 8601
    models: dict[str, VersionedModelSchema]

    def save(self, path: Path) -> None:
        """Write snapshot to *path* as indented JSON.

        Creates parent directories if they do not exist.
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.model_dump_json(indent=2))

    @classmethod
    def load(cls, path: Path, expected_odoo_version: str) -> VersionedSnapshot:
        """Load and validate a snapshot from *path*.

        Version checks are applied before trusting any schema data:

        1. ``schema_format_version`` is checked first — a mismatch indicates a
           breaking stateman upgrade and the snapshot must be regenerated.
        2. ``odoo_version`` is checked second — a mismatch indicates the snapshot
           was captured from a different Odoo instance version.

        Raises:
            VersionMismatchError: If either version field does not match.
        """
        data = json.loads(path.read_text())
        snap = cls.model_validate(data)
        if snap.schema_format_version != SCHEMA_FORMAT_VERSION:
            raise VersionMismatchError(
                f"Schema format version mismatch: file has {snap.schema_format_version}, "
                f"expected {SCHEMA_FORMAT_VERSION}"
            )
        if snap.odoo_version != expected_odoo_version:
            raise VersionMismatchError(
                f"Odoo version mismatch: file={snap.odoo_version!r}, expected={expected_odoo_version!r}"
            )
        return snap
