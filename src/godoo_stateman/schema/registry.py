"""SchemaRegistry — wraps godoo-py Introspector with OdooVersion seam and disk cache."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from godoo.introspection import Introspector
from platformdirs import user_cache_path

from godoo_stateman.schema.snapshot import VersionedSnapshot
from godoo_stateman.schema.version import SCHEMA_FORMAT_VERSION, OdooVersion
from godoo_stateman.types.schema import VersionedFieldSchema, VersionedModelSchema

if TYPE_CHECKING:
    from godoo.client.client import OdooClient


class SchemaRegistry:
    """Gateway for all schema access in stateman.

    The only module in stateman that imports :class:`godoo.introspection.Introspector`
    directly — all other modules use ``SchemaRegistry.get()``.

    Wraps every :class:`~godoo.introspection.types.ModelSchema` returned by the
    Introspector into a :class:`~godoo_stateman.types.schema.VersionedModelSchema`
    that carries the ``OdooVersion`` dimension and derives the ``archivable`` flag.

    An in-memory cache avoids repeated RPC calls within a single command invocation.
    """

    def __init__(self, client: OdooClient, version: OdooVersion) -> None:
        self._introspector = Introspector(client)
        self._version = version
        self._cache: dict[str, VersionedModelSchema] = {}

    async def get(self, model_name: str, *, bypass_cache: bool = False) -> VersionedModelSchema:
        """Return the versioned schema for *model_name*.

        Uses in-memory cache unless *bypass_cache* is True.
        Delegates to :meth:`godoo.introspection.Introspector.get_schema` for the
        raw schema, then wraps it with version and archivability metadata.
        """
        if not bypass_cache and model_name in self._cache:
            return self._cache[model_name]
        raw = await self._introspector.get_schema(model_name, bypass_cache=bypass_cache)

        # Derive archivable: True iff model has a stored, writable 'active' field.
        active_field = raw.fields.get("active")
        archivable = active_field is not None and bool(active_field.store)

        versioned_fields = {
            fn: VersionedFieldSchema(
                name=fs.name,
                ttype=fs.ttype,
                store=fs.store,  # source-verified: populated by Introspector
                readonly=fs.readonly,
                compute=fs.compute,
                relation=fs.relation,
                required=fs.required,
            )
            for fn, fs in raw.fields.items()
        }

        versioned = VersionedModelSchema(
            name=raw.name,
            display_name=raw.display_name,
            transient=raw.transient,
            odoo_version=str(self._version),
            archivable=archivable,
            fields=versioned_fields,
        )
        self._cache[model_name] = versioned
        return versioned

    @staticmethod
    def _instance_hash(url: str, database: str) -> str:
        """Stable 16-char hex hash of (url, database).

        Used as the cache filename component to disambiguate multiple Odoo
        instances. Not a security hash — collision resistance is not required.
        """
        return hashlib.sha256(f"{url}|{database}".encode()).hexdigest()[:16]

    def cache_path(self, url: str, database: str) -> Path:
        """Return the platformdirs cache path for this (url, database, version) triple.

        The path follows:
            <user_cache>/godoo-stateman/<odoo_version>/<instance_hash>.json
        """
        base = user_cache_path("godoo-stateman", ensure_exists=True)
        version_dir = base / str(self._version)
        version_dir.mkdir(parents=True, exist_ok=True)
        return version_dir / f"{self._instance_hash(url, database)}.json"

    async def build_snapshot(self, model_names: list[str]) -> VersionedSnapshot:
        """Fetch schemas for all *model_names* and return a :class:`VersionedSnapshot`.

        Calls :meth:`get` for each name (using in-memory cache automatically).
        """
        models: dict[str, VersionedModelSchema] = {}
        for name in model_names:
            models[name] = await self.get(name)
        return VersionedSnapshot(
            odoo_version=str(self._version),
            schema_format_version=SCHEMA_FORMAT_VERSION,
            captured_at=datetime.now(UTC).isoformat(),
            models=models,
        )
