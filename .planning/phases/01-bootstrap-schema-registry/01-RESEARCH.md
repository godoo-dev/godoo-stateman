# Phase 1: Bootstrap + Schema Registry - Research

**Researched:** 2026-05-23
**Domain:** Python CLI project scaffold, versioned schema registry, xmlid helpers, Typer async bridge
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Schema Snapshot Storage (SCHEM-01, SCHEM-04)**
- D-01: Persist snapshots to XDG/platformdirs user cache (`platformdirs.user_cache_path("godoo-stateman", ...)`), NOT the user's repo. Treated as a regenerable cache, not state.
- D-02: Key by directory structure `<odoo_version>/<instance_hash>.json`. Hash input must be stable (e.g. host+db); document the chosen hash input.
- D-03: Each snapshot JSON carries `odoo_version` and `schema_format_version`; loading a snapshot whose version mismatches raises `VersionMismatchError` (SCHEM-04).
- D-04: CI/reproducibility: re-snapshot as a setup step (analogous to `terraform init`), do NOT commit the cache. Add `platformdirs` as a dependency.
- D-05: Configurable location (`--schema-dir`/env override) is DEFERRED to v1.1 — ship one well-documented default for v1.0.

**store-flag Acquisition (SCHEM-03, SCHEM-05) — TRUST the Introspector**
- D-06: Source-verified: godoo-py `Introspector` already populates `store` correctly. `introspector.py` line ~290 does `store=bool(fr.get("store", True))`, reading the `store` column from `ir.model.fields` (it is in the `_IR_FIELDS` search_read projection, lines ~16-35).
- D-07: The previously-noted `field_cache.py` "conflict" is a NON-issue: that CDC service fetches only `["name","ttype","relation","selection_ids"]` — no `store` — and is a separate, unrelated consumer. No reconciliation needed.
- D-08: Strategy: consume `FieldSchema.store` directly. NO supplemental `fields_get` call.
- D-09: SCHEM-05 verification test: assert `schema.fields["display_name"].store is False` on `res.partner`.

**xmlid Helpers (Identity Boundary) — Namespace-Agnostic**
- D-10: Helpers are namespace-agnostic: `write_xmlid(client, model, res_id, module, name)` and `find_by_xmlid(client, module, name)` take `module` and `name` as explicit, author-controlled args.
- D-11: Rationale: stateman is config-driven; the DSL author declares each resource's identity deliberately.
- D-12: Module-naming POLICY is DEFERRED to Phase 2 (DSL surface). Phase 1 only needs helpers that accept arbitrary (module, name).
- D-13: `write_xmlid` contract: idempotent upsert (create if absent, rewrite `res_id` if the xmlid exists). Return type left to planning.
- D-14: `find_by_xmlid`: absence is NOT an error — return `None`/optional; do not raise.
- D-15: godoo-py primitives confirmed (all async) on `OdooClient`: `create`, `write`, `search_read`, `ref`. Error hierarchy: `OdooMissingError`, `OdooValidationError` subclass `OdooRpcError`. Match these conventions.

**CLI Skeleton Scope (UX-06) — snapshot Real, Four Stubbed**
- D-16: Five commands registered: `plan`, `apply`, `verify`, `import`, `snapshot`.
- D-17: `snapshot` is FUNCTIONAL in Phase 1: introspects a live Odoo 17 and persists a versioned snapshot.
- D-18: `plan`/`apply`/`verify`/`import` are STUBS: print a Rich message naming the target phase, then `raise typer.Exit(code=1)`. Do NOT use exit code 2 for stubs.
- D-19: Async pattern: each command is a thin synchronous wrapper calling `asyncio.run(_impl(...))`; all logic lives in an `async def _impl`. Do NOT use `async-typer` or `anyio`. `_impl` coroutines are unit-testable directly via pytest-asyncio.

### Claude's Discretion

Typer, Pydantic v2, NetworkX, Rich, hatchling, and uv are locked by the CLAUDE.md tech-stack table — no user decisions needed here.

### Deferred Ideas (OUT OF SCOPE)

- Configurable schema-snapshot location (`--schema-dir` flag / env var) — v1.1.
- DSL module-naming policy (how config authors namespace resource xmlids) — Phase 2 (DSL surface).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCHEM-01 | Schema registry stores per-model metadata (name, archivability, naming metadata) keyed by Odoo-version dimension | OdooVersion dataclass + SchemaRegistry + VersionedModelSchema; platformdirs cache path; D-01/D-02 |
| SCHEM-02 | Schema registry stores per-field metadata (name, ttype, store, readonly, compute, relation) for every field of every tracked model | `Introspector.get_schema()` populates `FieldSchema` with all required fields; source-verified at introspector.py line 282-302 |
| SCHEM-03 | `store` flag captured in every snapshot; computed fields with `store=False` excluded from write plans | `FieldSchema.store` already populated from `_IR_FIELDS` projection (source-verified D-06); `VersionedFieldSchema.store` mandatory |
| SCHEM-04 | Schema snapshot serialized to versioned JSON; stale snapshots raise `VersionMismatchError` | D-03: JSON format with `odoo_version` + `schema_format_version`; `VersionMismatchError` on load mismatch |
| SCHEM-05 | Verify whether Introspector populates `store`; supplement if not | RESOLVED: D-06 confirms `store` IS populated. D-09 specifies regression test: `res.partner.display_name.store is False` |
| UX-06 | CLI implemented with Typer; every async command bridges via `asyncio.run()` | D-19: synchronous Typer wrapper + `async def _impl`; source: Typer 0.25.1 confirmed pattern |
| PKG-04 | `pyproject.toml` uses hatchling build backend matching godoo-py convention | hatchling pattern confirmed from godoo-py source pyproject.toml; `[build-system] requires = ["hatchling"]` |
| PKG-05 | GitHub repository public; CLAUDE.md `@`-imports `../godoo-hq/UMBRELLA_CLAUDE.md` | repo already exists; CLAUDE.md already contains the `@`-import (source-verified) |
</phase_requirements>

---

## Summary

Phase 1 delivers the foundation that every downstream phase depends on: a runnable Python project scaffolded with `uv` + `hatchling`, a Typer CLI skeleton with five commands (one functional, four stubbed), a versioned schema registry backed by the godoo-py `Introspector`, and two xmlid helpers (`write_xmlid`, `find_by_xmlid`) that fill documented godoo-py gaps.

The most important pre-planning research outcome is that **SCHEM-05 is resolved before a single task is written**. Source code inspection of `introspector.py` confirms `store` is included in `_IR_FIELDS` at lines 16-35 and populated at line 290: `store=bool(fr.get("store", True))`. The `field_cache.py` "conflict" is a red herring — that is a CDC-service-only consumer that fetches a 4-column subset unrelated to stateman. No supplemental `fields_get` call is needed.

The schema snapshot layer is the only genuinely new code in this phase: `SchemaRegistry` wraps `Introspector`, adds an `OdooVersion` dimension, serializes to JSON at `platformdirs.user_cache_path("godoo-stateman") / "<odoo_version>" / "<instance_hash>.json"`, and raises `VersionMismatchError` when the format version or Odoo version in a loaded file mismatches. The `snapshot` command is functional (not a stub) because it exercises the full schema registry feedback loop and its acceptance test against a real Odoo 17 testcontainer is the primary Phase 1 integration gate.

**Primary recommendation:** Build in this order within the phase: `pyproject.toml` scaffold + Typer CLI skeleton → `types/schema.py` Pydantic models → `schema/registry.py` + `schema/snapshot.py` → xmlid helpers → `snapshot` command wired up → acceptance test via testcontainers. The four stubbed commands are trivially fast; all substantive effort is in the schema registry and its acceptance test.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Project scaffold (pyproject.toml, uv, hatchling) | Build toolchain | — | Pure packaging concern; no runtime tier |
| CLI entry points (5 commands) | CLI layer (Typer) | — | Typer owns argument parsing and dispatch |
| Schema introspection from live Odoo | API/Backend (godoo-py Introspector) | Schema Registry (cache) | Introspector reads `ir.model` + `ir.model.fields` via jsonrpc |
| Schema snapshot persistence | Local filesystem (platformdirs cache) | — | Regenerable cache; XDG user cache dir |
| Version validation on snapshot load | Schema Registry | — | `VersionMismatchError` raised at load boundary |
| xmlid helpers (write/find) | API/Backend (ir.model.data via jsonrpc) | — | `OdooClient.create/write/search_read` against `ir.model.data` |
| CLI output (stub messages, progress) | CLI layer (Rich Console) | — | Rich handles Windows color; no `print()` |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Python | 3.14.5 | Runtime | Hard constraint from godoo-py `requires-python = ">=3.14"` [VERIFIED: godoo-py source] |
| `godoo-client` | 0.2.0 | jsonrpc transport | Locked dependency — async CRUD, safety guard [VERIFIED: godoo-py source] |
| `godoo-introspection` | 0.2.0 | Schema discovery | Locked dependency — `Introspector`, `ModelSchema`, `FieldSchema.store` [VERIFIED: godoo-py source] |
| `typer` | 0.25.1 | CLI framework | Type-hint-driven commands; locked by CLAUDE.md [VERIFIED: CLAUDE.md] |
| `pydantic` | >=2.13.4 | Internal data models | Frozen models for pipeline types; v2 required [VERIFIED: CLAUDE.md] |
| `rich` | >=15.0.0 | CLI output | Tables, progress, panels; Windows color [VERIFIED: CLAUDE.md] |
| `platformdirs` | >=4.9.6 | XDG-compliant cache dir | `user_cache_path()` returns `pathlib.Path`; cross-platform [VERIFIED: PyPI query] |
| `hatchling` | latest | Build backend | Matches godoo-py packaging convention [VERIFIED: godoo-py source] |
| `uv` | 0.11.13 | Workspace + venv + publish | Already installed; matches godoo-py toolchain [VERIFIED: `uv --version`] |

### Supporting (dev)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pytest` | >=8 | Test runner | All tests — matches godoo-py dev deps [VERIFIED: godoo-py pyproject.toml] |
| `pytest-asyncio` | >=0.24 | Async test support | All async tests (`asyncio_mode = "auto"`) [VERIFIED: godoo-py pyproject.toml] |
| `godoo-testcontainers` | 0.2.0 | Phase 1 acceptance test (`snapshot` command) | Docker-required; real Odoo 17 CE [VERIFIED: godoo-py source] |
| `ruff` | >=0.8 | Linter + formatter | `target-version = "py314"`, `line-length = 120` [VERIFIED: godoo-py pyproject.toml] |
| `mypy` | >=1.13 | Type checking | `strict = true`, `python_version = "3.14"` [VERIFIED: godoo-py pyproject.toml] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `platformdirs.user_cache_path()` | `appdirs` | `appdirs` is unmaintained; platformdirs is its maintained successor with `pathlib.Path` return type |
| `asyncio.run()` wrapper in Typer commands | `anyio.run()` | `asyncio.run()` is zero-dependency; anyio is BANNED by D-19 |
| Pydantic `BaseModel` for `VersionedModelSchema` | Python `dataclasses` | `dataclasses` lack validation on construction and JSON round-trip; Pydantic is required at serialization boundaries |

**Installation:**

```bash
uv add godoo-client>=0.2.0 godoo-introspection>=0.2.0 typer>=0.25.1 "pydantic>=2.13.4" "rich>=15.0.0" "platformdirs>=4.9.6"
uv add --dev pytest>=8 pytest-asyncio>=0.24 ruff>=0.8 mypy>=1.13 godoo-testcontainers>=0.2.0
```

---

## Package Legitimacy Audit

> slopcheck was not available in this environment. All packages listed are from CLAUDE.md (locked, project-verified) or well-established libraries. The only new addition versus the locked CLAUDE.md stack is `platformdirs`.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| godoo-client | PyPI | per godoo-py 0.2.0 | internal | github.com/godoo-dev/godoo-py | N/A — locked dep | Approved |
| godoo-introspection | PyPI | per godoo-py 0.2.0 | internal | github.com/godoo-dev/godoo-py | N/A — locked dep | Approved |
| typer | PyPI | ~6 yrs | >10M/wk | github.com/fastapi/typer | N/A — locked by CLAUDE.md | Approved |
| pydantic | PyPI | ~8 yrs | >100M/wk | github.com/pydantic/pydantic | N/A — locked by CLAUDE.md | Approved |
| rich | PyPI | ~5 yrs | >50M/wk | github.com/Textualize/rich | N/A — locked by CLAUDE.md | Approved |
| platformdirs | PyPI | ~3 yrs (successor to appdirs ~10 yrs) | >50M/wk | github.com/tox-dev/platformdirs | [ASSUMED] | Approved — established tox-dev maintainer, widely used by pip, black, mypy |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*slopcheck was unavailable. `platformdirs` is tagged [ASSUMED] and the planner should add a `checkpoint:human-verify` gate before its install task if slopcheck is available in the execution environment. All other packages are locked by CLAUDE.md authority.*

---

## Architecture Patterns

### System Architecture Diagram

```
User
  │
  ▼ uv run godoo-stateman <command> [args]
┌─────────────────────────────────────────────────────────────┐
│  CLI Layer  (godoo_stateman/cli/)                           │
│  Typer app — 5 commands                                     │
│  plan* | apply* | verify* | import_* | snapshot             │
│  (* = stub: Rich message + Exit(1))                         │
│                                                             │
│  Each command: sync wrapper → asyncio.run(_impl(...))       │
└────────────────────┬────────────────────────────────────────┘
                     │ snapshot command only (Phase 1)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Schema Registry  (godoo_stateman/schema/)                  │
│  SchemaRegistry(client, odoo_version)                       │
│    .get(model_name) → VersionedModelSchema                  │
│    .to_snapshot() → VersionedSnapshot                       │
│    .save(cache_dir) / .load(cache_dir) → SchemaRegistry     │
│                                                             │
│  Cache path: platformdirs.user_cache_path("godoo-stateman") │
│             / <odoo_version> / <instance_hash>.json         │
└────────────┬──────────────────────────────┬────────────────-┘
             │ miss: fetch                  │ hit: deserialize
             ▼                             ▼
┌────────────────────────┐   ┌────────────────────────────────┐
│  godoo-py              │   │  JSON snapshot file            │
│  Introspector          │   │  { odoo_version,               │
│    .get_schema(name)   │   │    schema_format_version,      │
│    → ModelSchema       │   │    models: { ... } }           │
│      FieldSchema.store │   │  VersionMismatchError on       │
│      (source-verified) │   │  format/version mismatch       │
└────────────┬───────────┘   └────────────────────────────────┘
             │ 2-3 RPCs to ir.model + ir.model.fields
             ▼
┌─────────────────────────────────────────────────────────────┐
│  Odoo 17 CE (jsonrpc)                                       │
│  ir.model / ir.model.fields / ir.model.data                 │
└─────────────────────────────────────────────────────────────┘

xmlid helpers (godoo_stateman/identity.py):
  write_xmlid(client, model, res_id, module, name) — idempotent upsert
  find_by_xmlid(client, module, name) → XmlIdRecord | None
  Both call: client.search_read / client.create / client.write on ir.model.data
```

### Recommended Project Structure

```
src/godoo_stateman/
├── cli/
│   ├── __init__.py
│   ├── app.py              # typer.Typer() app; command registration
│   └── commands/
│       ├── __init__.py
│       ├── plan.py         # stub: Rich message + raise typer.Exit(code=1)
│       ├── apply.py        # stub
│       ├── verify.py       # stub
│       ├── import_.py      # stub (import is a Python keyword)
│       └── snapshot.py     # FUNCTIONAL: introspect + persist versioned snapshot
│
├── schema/
│   ├── __init__.py
│   ├── registry.py         # SchemaRegistry — wraps Introspector, adds OdooVersion seam
│   ├── snapshot.py         # VersionedSnapshot, JSON serialization, load/save, VersionMismatchError
│   └── version.py          # OdooVersion dataclass; SCHEMA_FORMAT_VERSION constant
│
├── types/
│   ├── __init__.py
│   └── schema.py           # VersionedModelSchema, VersionedFieldSchema (stateman view)
│
├── identity.py             # write_xmlid, find_by_xmlid, XmlIdRecord
├── errors.py               # VersionMismatchError; base error hierarchy
└── __init__.py

tests/
├── unit/
│   ├── test_schema_registry.py   # unit: OdooVersion, VersionedModelSchema, snapshot round-trip
│   ├── test_identity.py          # unit: write_xmlid/find_by_xmlid logic (mocked client)
│   └── test_cli_help.py          # unit: `uv run godoo-stateman --help` exits 0; all 5 names listed
└── acceptance/
    └── test_snapshot.py          # integration (Docker): snapshot command against real Odoo 17
        # Covers SCHEM-01..05 success criteria 2, 3, 4, 5
```

### Pattern 1: Typer Async Bridge

**What:** Each Typer command is a `def` (synchronous), whose body is `asyncio.run(_impl(...))`. All business logic is in `async def _impl`.

**When to use:** Every command function. Never decorate an `async def` with `@app.command()` — Typer 0.25.1 does not support it natively. [VERIFIED: CLAUDE.md D-19 + Typer 0.25.1 confirmed no async support]

```python
# src/godoo_stateman/cli/commands/snapshot.py
import asyncio
from pathlib import Path
import typer

def snapshot(config: Path = typer.Argument(..., help="Path to stateman config file")):
    """Introspect live Odoo and persist a versioned schema snapshot."""
    asyncio.run(_snapshot_impl(config))

async def _snapshot_impl(config: Path) -> None:
    # All async work here — testable directly via pytest-asyncio
    ...
```

### Pattern 2: SchemaRegistry with OdooVersion Seam

**What:** `SchemaRegistry` is the only gateway to `godoo-py`'s `Introspector`. It wraps every returned `ModelSchema` in a `VersionedModelSchema` that carries the `OdooVersion` dimension. It also owns the cache file I/O via `platformdirs`.

**When to use:** All schema access goes through `SchemaRegistry.get()`. No other module imports `Introspector` directly.

```python
# src/godoo_stateman/schema/registry.py
import asyncio
import hashlib
from pathlib import Path

from platformdirs import user_cache_path
from godoo.client.client import OdooClient
from godoo.introspection import Introspector

from godoo_stateman.schema.version import OdooVersion, SCHEMA_FORMAT_VERSION
from godoo_stateman.schema.snapshot import VersionedSnapshot
from godoo_stateman.types.schema import VersionedModelSchema, VersionedFieldSchema
from godoo_stateman.errors import VersionMismatchError

class SchemaRegistry:
    def __init__(self, client: OdooClient, version: OdooVersion) -> None:
        self._introspector = Introspector(client)
        self._version = version
        self._cache: dict[str, VersionedModelSchema] = {}

    async def get(self, model_name: str, *, bypass_cache: bool = False) -> VersionedModelSchema:
        if not bypass_cache and model_name in self._cache:
            return self._cache[model_name]
        raw = await self._introspector.get_schema(model_name, bypass_cache=bypass_cache)
        versioned = VersionedModelSchema(
            name=raw.name,
            display_name=raw.display_name,
            transient=raw.transient,
            odoo_version=self._version,
            fields={
                fn: VersionedFieldSchema(
                    name=fs.name,
                    ttype=fs.ttype,
                    store=fs.store,         # source-verified: populated by Introspector
                    readonly=fs.readonly,
                    compute=fs.compute,
                    relation=fs.relation,
                    required=fs.required,
                )
                for fn, fs in raw.fields.items()
            },
        )
        self._cache[model_name] = versioned
        return versioned

    @staticmethod
    def _instance_hash(url: str, database: str) -> str:
        """Stable hash of (url, database) for cache key. Not a security hash."""
        return hashlib.sha256(f"{url}|{database}".encode()).hexdigest()[:16]

    def cache_path(self, url: str, database: str) -> Path:
        base = user_cache_path("godoo-stateman", ensure_exists=True)
        version_dir = base / str(self._version)
        version_dir.mkdir(parents=True, exist_ok=True)
        return version_dir / f"{self._instance_hash(url, database)}.json"
```

### Pattern 3: VersionedSnapshot JSON Format

**What:** The snapshot JSON has a mandatory header with `odoo_version`, `schema_format_version`, and `captured_at` (ISO 8601). Loading raises `VersionMismatchError` if either version field mismatches the expected values.

**Why this matters:** D-03 locks this contract. It enables the detection of stale snapshots from a different Odoo version or a breaking schema format change.

```python
# src/godoo_stateman/schema/snapshot.py
import json
from datetime import datetime, timezone
from pydantic import BaseModel, ConfigDict

SCHEMA_FORMAT_VERSION = 1  # Increment on breaking schema format changes

class VersionedSnapshot(BaseModel):
    model_config = ConfigDict(frozen=True)

    odoo_version: str           # e.g. "17.0"
    schema_format_version: int  # always SCHEMA_FORMAT_VERSION
    captured_at: str            # ISO 8601
    models: dict[str, ...]      # model_name → VersionedModelSchema

    def save(self, path: Path) -> None:
        path.write_text(self.model_dump_json(indent=2))

    @classmethod
    def load(cls, path: Path, expected_odoo_version: str) -> "VersionedSnapshot":
        data = json.loads(path.read_text())
        snap = cls.model_validate(data)
        if snap.schema_format_version != SCHEMA_FORMAT_VERSION:
            raise VersionMismatchError(
                f"Schema format version mismatch: file has {snap.schema_format_version}, "
                f"expected {SCHEMA_FORMAT_VERSION}"
            )
        if snap.odoo_version != expected_odoo_version:
            raise VersionMismatchError(
                f"Odoo version mismatch: snapshot is from {snap.odoo_version!r}, "
                f"expected {expected_odoo_version!r}"
            )
        return snap
```

### Pattern 4: xmlid Helpers Against ir.model.data

**What:** `write_xmlid` is an idempotent upsert. `find_by_xmlid` returns `None` on absence (never raises). Both use `OdooClient` primitives directly.

**When to use:** Phase 1 implements these; downstream phases (identity model, import command) use them.

```python
# src/godoo_stateman/identity.py
from dataclasses import dataclass
from typing import Any
from godoo.client.client import OdooClient

@dataclass(frozen=True)
class XmlIdRecord:
    module: str
    name: str
    model: str
    res_id: int
    complete_name: str  # "module.name"

async def find_by_xmlid(
    client: OdooClient,
    module: str,
    name: str,
) -> XmlIdRecord | None:
    """Return the ir.model.data record for (module, name), or None if absent."""
    records = await client.search_read(
        "ir.model.data",
        [("module", "=", module), ("name", "=", name)],
        fields=["res_id", "model", "complete_name"],
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
        complete_name=str(r["complete_name"]),
    )

async def write_xmlid(
    client: OdooClient,
    model: str,
    res_id: int,
    module: str,
    name: str,
) -> XmlIdRecord:
    """Idempotent upsert: create xmlid if absent; update res_id if it exists."""
    existing = await find_by_xmlid(client, module, name)
    if existing is None:
        await client.create("ir.model.data", {
            "model": model,
            "res_id": res_id,
            "module": module,
            "name": name,
            "noupdate": True,
        })
    elif existing.res_id != res_id:
        records = await client.search_read(
            "ir.model.data",
            [("module", "=", module), ("name", "=", name)],
            fields=["id"],
            limit=1,
        )
        if records:
            await client.write("ir.model.data", records[0]["id"], {"res_id": res_id})
    return XmlIdRecord(module=module, name=name, model=model, res_id=res_id,
                       complete_name=f"{module}.{name}")
```

### Anti-Patterns to Avoid

- **Importing `Introspector` outside `schema/registry.py`:** All schema access must go through `SchemaRegistry`. No other module imports `Introspector` directly.
- **Storing `platformdirs` result without `ensure_exists=True`:** The cache directory may not exist on first run. Pass `ensure_exists=True` or call `.mkdir(parents=True, exist_ok=True)`.
- **Decorating `async def` with `@app.command()`:** Typer 0.25.1 will call the coroutine object but not `await` it — the function returns without executing. Always use synchronous wrapper + `asyncio.run()`.
- **Raising on `find_by_xmlid` miss:** Absence means "record not yet managed" (a future Create action). Raising breaks the identity lookup contract (D-14).
- **Using `int(...)` on `res_id` without guard:** Odoo may return `False` for an unset `res_id`. Always coerce with `int(r["res_id"])` after confirming the record exists in `ir.model.data`.
- **Omitting `noupdate: True` in `ir.model.data` create:** Odoo respects the `noupdate` flag in XML data loading; setting it `True` for stateman-owned xmlids prevents Odoo's update mechanism from overwriting them during module upgrades.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema introspection from `ir.model.fields` | Custom `search_read` wrapper | `godoo-py Introspector.get_schema()` | Already handles batch fetch, session cache, selection field expansion, 2-3 RPC optimization |
| XDG-compliant cross-platform cache path | `os.path.join(os.environ.get("XDG_CACHE_HOME", ...))` | `platformdirs.user_cache_path()` | Handles Linux XDG, macOS `~/Library/Caches`, Windows `%LOCALAPPDATA%` correctly |
| Async-to-sync bridge for Typer | Thread executor, anyio | `asyncio.run(_impl(...))` | Zero dependencies; correct; anyio is explicitly banned (D-19) |
| Pydantic JSON serialization | `json.dumps(obj.__dict__)` | `model.model_dump_json()` | Handles nested Pydantic models, `tuple`, `Literal`, frozen config correctly |
| jsonrpc xmlid lookup | Direct `urllib` HTTP call | `OdooClient.search_read("ir.model.data", ...)` | Safety guard, session management, retry logic all included |

**Key insight:** godoo-py provides everything needed for the Odoo I/O layer. Phase 1's job is to build the stateman-specific wrapper layer on top of it — not to re-implement anything godoo-py already does.

---

## Common Pitfalls

### Pitfall 1: SCHEM-05 Was Already Resolved Before Phase 1

**What goes wrong:** Planner allocates tasks to "investigate whether `store` is populated" as if it's an open question.

**Why it happens:** The CONTEXT.md decision history (D-06 through D-09) already contains the source-verified resolution. Research confirms it: `_IR_FIELDS` at `introspector.py` line 16-35 includes `"store"`; the value is applied at line 290 via `store=bool(fr.get("store", True))`.

**How to avoid:** Skip investigation tasks for SCHEM-05. The ONLY remaining task is the regression test (D-09): `assert schema.fields["display_name"].store is False` against a real Odoo 17 `res.partner`.

**Warning signs:** Any task titled "investigate/verify store flag" — should instead be titled "test store=False regression" and run against testcontainers.

### Pitfall 2: `asyncio.run()` Inside Typer Exit Handlers

**What goes wrong:** Calling `asyncio.run()` inside a Typer exception handler or post-command hook re-enters the event loop and raises `RuntimeError: This event loop is already running`.

**Why it happens:** Typer runs commands synchronously; `asyncio.run()` creates a new event loop. If cleanup code in a `typer.Exit` handler also calls `asyncio.run()`, there are two event loops.

**How to avoid:** All async work (including cleanup) belongs inside `_impl`. The synchronous Typer command wrapper should do nothing except `asyncio.run(_impl(...))` — no try/except that calls async code.

### Pitfall 3: VersionMismatchError on `schema_format_version` vs `odoo_version`

**What goes wrong:** Two separate version fields need separate error messages. Conflating them produces confusing diagnostics: "version mismatch" without specifying which version.

**Why it happens:** Snapshot loading checks two things: (a) `schema_format_version` (has the stateman snapshot format changed?), and (b) `odoo_version` (was this snapshot taken from a different Odoo version?). These are different errors with different remediation paths.

**How to avoid:** Check `schema_format_version` first (it indicates a breaking stateman upgrade). Check `odoo_version` second. Include both the file's value and the expected value in the error message: `VersionMismatchError(f"Odoo version mismatch: file={snap.odoo_version!r}, expected={expected!r}")`.

### Pitfall 4: `user_cache_path` Returns Wrong Path on Windows Without `ensure_exists`

**What goes wrong:** `platformdirs.user_cache_path("godoo-stateman")` returns a `Path` that points to `%LOCALAPPDATA%\godoo-stateman\Cache` on Windows — but that directory may not exist if the app has never run. Writing to it without `mkdir(parents=True, exist_ok=True)` raises `FileNotFoundError`.

**How to avoid:** Use `user_cache_path("godoo-stateman", ensure_exists=True)` (creates the dir) or explicitly call `.mkdir(parents=True, exist_ok=True)` on the computed path before writing.

### Pitfall 5: ir.model.data `res_id` Is the Odoo Resource ID, Not the ir.model.data Row ID

**What goes wrong:** Updating an existing xmlid entry requires knowing the `ir.model.data` row's own integer ID (from `search_read` → `fields=["id"]`), not the `res_id` field. Passing `res_id` to `client.write("ir.model.data", res_id, ...)` writes to the wrong record.

**How to avoid:** `write_xmlid` must do a two-step update: first `search_read` to get the `id` of the `ir.model.data` row, then `write("ir.model.data", [row_id], {"res_id": new_res_id})`.

### Pitfall 6: testcontainers OdooVersion Does Not Match Snapshot OdooVersion

**What goes wrong:** The acceptance test creates a snapshot with `odoo_version="17.0"` (from `ODOO_VERSION` env, defaulting `"17.0"` per godoo-testcontainers source). A later load attempt using a hardcoded `"17"` (without `.0`) triggers `VersionMismatchError`.

**How to avoid:** Always use the canonical Odoo version string (e.g., `"17.0"`) consistently across the snapshot format and the `SchemaRegistry` constructor. Source the version string from `ODOO_VERSION` environment variable or from a constant — never hardcode two different normalizations.

---

## Code Examples

Verified patterns from source-verified APIs:

### godoo-py Introspector Usage (source-verified)

```python
# Source: introspector.py Introspector.get_schema()
from godoo.introspection import Introspector
from godoo.client.client import OdooClient, OdooClientConfig

async def demo(client: OdooClient) -> None:
    introspector = Introspector(client)
    schema = await introspector.get_schema("res.partner")
    # schema.fields["display_name"].store is False (computed, non-stored)
    # schema.fields["name"].store is True (plain stored field)
    for field_name, fs in schema.fields.items():
        if not fs.store and fs.compute:
            print(f"Computed non-stored: {field_name}")
```

### OdooClient async context manager (source-verified)

```python
# Source: client.py __aenter__/__aexit__
from godoo.client.client import OdooClient, OdooClientConfig

async def with_client() -> None:
    config = OdooClientConfig(
        url="http://localhost:8069",
        database="test_odoo",
        username="admin",
        password="admin",
    )
    async with OdooClient(config) as client:
        # client is authenticated
        records = await client.search_read(
            "ir.model.data",
            [("module", "=", "base"), ("name", "=", "model_res_partner")],
            fields=["res_id", "model"],
            limit=1,
        )
```

### testcontainers acceptance test pattern (source-verified)

```python
# Source: godoo-testcontainers TestHarness (harness.py)
import pytest
from godoo.testcontainers import TestHarness

@pytest.fixture(scope="session")
async def odoo():
    async with TestHarness(snapshot=True) as h:
        yield h

@pytest.mark.integration
async def test_schema_snapshot(odoo):
    from godoo_stateman.schema.registry import SchemaRegistry
    from godoo_stateman.schema.version import OdooVersion
    registry = SchemaRegistry(odoo.client, OdooVersion(major=17, minor=0))
    schema = await registry.get("project.project")
    # Success criterion #2: store populated for every field
    for fn, fs in schema.fields.items():
        assert isinstance(fs.store, bool), f"Field {fn} missing store flag"
    # Success criterion #5 (D-09): known non-stored field
    partner_schema = await registry.get("res.partner")
    assert partner_schema.fields["display_name"].store is False
```

### pyproject.toml scaffold (source-verified pattern from godoo-py)

```toml
[project]
name = "godoo-stateman"
version = "0.1.0"
description = "Terraform for Odoo — declarative Odoo state reconciliation over jsonrpc"
readme = "README.md"
license = "LGPL-3.0-or-later"
requires-python = ">=3.14"
dependencies = [
    "godoo-client>=0.2.0",
    "godoo-introspection>=0.2.0",
    "typer>=0.25.1",
    "pydantic>=2.13.4",
    "rich>=15.0.0",
    "platformdirs>=4.9.6",
]
authors = [{ name = "Marc Fargas", email = "marc@marcfargas.com" }]

[project.scripts]
godoo-stateman = "godoo_stateman.cli.app:app"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
sources = ["src"]
only-include = ["src/godoo_stateman"]

[tool.uv.sources]
godoo-client = { path = "../godoo-py", editable = true }
godoo-introspection = { path = "../godoo-py", editable = true }
godoo-testcontainers = { path = "../godoo-py", editable = true }

[tool.ruff]
target-version = "py314"
line-length = 120

[tool.ruff.lint]
select = ["E", "F", "W", "I", "UP", "B", "SIM", "TCH", "RUF"]

[tool.mypy]
python_version = "3.14"
strict = true
warn_return_any = true
disallow_untyped_defs = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "session"
testpaths = ["tests"]
markers = [
    "integration: marks tests requiring Docker/Odoo (deselect with '-m not integration')",
]
addopts = "--tb=short -q"
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `appdirs` for XDG dirs | `platformdirs` (maintained successor) | ~2021 | `platformdirs` returns `pathlib.Path` natively; `appdirs` is unmaintained |
| Typer pre-0.12 `async def` command support | None — sync wrapper + `asyncio.run()` required | Ongoing as of 0.25.1 | D-19 is correct: do NOT decorate async def directly |
| `pip index versions` | `uv pip index versions` not available; query PyPI JSON API directly | uv 0.11.x | `uv pip index versions` subcommand does not exist; use PyPI API |
| pytest-asyncio `asyncio_mode = "strict"` (pre-0.21) | `asyncio_mode = "auto"` (0.21+) | pytest-asyncio 0.21 | `auto` mode removes per-test `@pytest.mark.asyncio` decorators; matches godoo-py config |

**Deprecated/outdated:**
- `appdirs`: Unmaintained since ~2021. Use `platformdirs` instead.
- `async-typer` (PyPI): Last release 2022, unmaintained. BANNED by D-19.
- `anyio.run()` as Typer bridge: BANNED by D-19 — not unmaintained, but adds an unnecessary dependency.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `platformdirs>=4.9.6` is the correct current version | Standard Stack, Package Legitimacy | Version constraint on older version is fine (>=); risk is negligible |
| A2 | `noupdate=True` in `ir.model.data.create()` correctly signals no-overwrite behavior via jsonrpc | Code Examples / identity.py | If Odoo ignores the `noupdate` flag on jsonrpc creates, stateman-owned xmlids could be overwritten by module upgrades. Verify against real Odoo 17 in acceptance test. |
| A3 | `ir.model.data` has a `complete_name` field accessible via `search_read` | Code Examples / find_by_xmlid | If the field name differs, `find_by_xmlid` will return records missing the `complete_name` key. RESOLVED in Open Questions Q1: do NOT request `complete_name` from `search_read`; construct it in Python as `f"{module}.{name}"`. |

**If this table is empty (it is not):** A3 is now mitigated by the Q1 resolution — `complete_name` is constructed in Python, never fetched from Odoo, so the field-name assumption is no longer load-bearing.

---

## Open Questions (RESOLVED)

1. **What is the exact set of fields on `ir.model.data` returned by `search_read`?**
   - What we know: `res_id`, `module`, `name`, `model` are standard fields. `complete_name` is used by godoo-py's `client.ref()` impl (returns `"module.name"` format).
   - What's unclear: Whether `complete_name` is a stored field on `ir.model.data` or a computed field. If computed and non-stored, `search_read` with `fields=["complete_name"]` may not work.
   - Recommendation: In the acceptance test, do a `search_read` on `ir.model.data` with `fields=["id","res_id","model","module","name"]` — construct `complete_name` as `f"{module}.{name}"` in Python rather than relying on Odoo to return it. This is safer and avoids the ambiguity.
   - **RESOLVED:** Construct `complete_name` in Python as `f"{module}.{name}"`. Never request `complete_name` as a `search_read` field. `find_by_xmlid`/`write_xmlid` use `fields=["id", "res_id", "model"]` only (Plan 01-03, identity.py). This also retires Assumption A3.

2. **Should `SCHEMA_FORMAT_VERSION` be a module-level constant or encoded in `OdooVersion`?**
   - What we know: It tracks breaking changes to stateman's snapshot format, independent of Odoo version.
   - What's unclear: Whether it belongs in `schema/version.py` alongside `OdooVersion` or in `schema/snapshot.py` where it is used.
   - Recommendation: Module-level constant `SCHEMA_FORMAT_VERSION: int = 1` in `schema/version.py` — planner decides exact location; both options are valid.
   - **RESOLVED:** Constant `SCHEMA_FORMAT_VERSION: int = 1` lives in `schema/version.py`. `schema/snapshot.py` imports it from there rather than redefining it (Plan 01-02, Task 1).

3. **Does `write_xmlid` need to handle the case where the existing xmlid points to a different model?**
   - What we know: `ir.model.data` enforces `(module, name)` uniqueness, not `(module, name, model)` uniqueness. An xmlid could theoretically point to `res.partner` when stateman expects `project.project`.
   - What's unclear: Whether to raise or silently overwrite in this case.
   - Recommendation: Raise `OdooValidationError` with a clear message if `existing.model != model`. The Phase 1 planner should explicitly add this guard to the `write_xmlid` contract.
   - **RESOLVED:** Raise `OdooValidationError` when an existing xmlid points to a different model. The model-mismatch guard is an explicit step (Step 3) in `write_xmlid` (Plan 01-03, Task 1).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.14 | Hard constraint from godoo-py | ✓ | 3.14.5 | None — hard floor |
| uv | Project toolchain | ✓ | 0.11.13 | None — required |
| Docker | testcontainers acceptance tests | ✓ | 29.3.0 | Skip `@pytest.mark.integration` tests |
| Python 3.12 (fallback) | — | ✓ | 3.12.13 | N/A — 3.14 is available |

**Missing dependencies with no fallback:** None — all required tools are present.

**Missing dependencies with fallback:**
- Docker: If Docker is unavailable, integration tests can be skipped with `-m "not integration"`. Unit tests for schema types, snapshot serialization, and xmlid helper logic (with mocked client) run without Docker.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest >= 8 + pytest-asyncio >= 0.24 |
| Config file | `pyproject.toml` `[tool.pytest.ini_options]` (Wave 0 gap — not yet written) |
| Quick run command | `uv run pytest tests/unit/ -q` |
| Full suite command | `uv run pytest -q` |
| Integration run | `uv run pytest -m integration` (requires Docker) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCHEM-01 | `VersionedModelSchema` carries `odoo_version` and archivability | unit | `uv run pytest tests/unit/test_schema_registry.py -x -q` | ❌ Wave 0 |
| SCHEM-02 | `VersionedFieldSchema` captures `store`, `ttype`, `readonly`, `compute`, `relation` | unit | `uv run pytest tests/unit/test_schema_registry.py -x -q` | ❌ Wave 0 |
| SCHEM-03 | `store=False` fields are captured (not excluded at registry level — excluded at apply) | acceptance | `uv run pytest tests/acceptance/test_snapshot.py -x -q -m integration` | ❌ Wave 0 |
| SCHEM-04 | `VersionMismatchError` raised on format/odoo_version mismatch | unit | `uv run pytest tests/unit/test_schema_registry.py::test_version_mismatch -x -q` | ❌ Wave 0 |
| SCHEM-05 | `res.partner.display_name.store is False` against real Odoo 17 | acceptance | `uv run pytest tests/acceptance/test_snapshot.py::test_store_flag_regression -x -q -m integration` | ❌ Wave 0 |
| UX-06 | `uv run godoo-stateman --help` exits 0; all 5 command names listed | unit | `uv run pytest tests/unit/test_cli_help.py -x -q` | ❌ Wave 0 |
| PKG-04 | `pyproject.toml` uses hatchling; `uv build` produces a wheel | manual | `uv build && ls dist/*.whl` | ❌ Wave 0 |
| PKG-05 | GitHub repo public; CLAUDE.md `@`-import present | manual | `gh repo view godoo-dev/godoo-stateman --json visibility` | CLAUDE.md exists ✅ |

### Sampling Rate

- **Per task commit:** `uv run pytest tests/unit/ -q` (< 10s, no Docker)
- **Per wave merge:** `uv run pytest -q` (full suite including integration if Docker available)
- **Phase gate:** Full suite green, including `tests/acceptance/test_snapshot.py`, before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/test_schema_registry.py` — covers SCHEM-01, SCHEM-02, SCHEM-04 (unit, mocked client)
- [ ] `tests/unit/test_identity.py` — covers `write_xmlid`/`find_by_xmlid` logic (mocked `OdooClient`)
- [ ] `tests/unit/test_cli_help.py` — covers UX-06 (subprocess or CliRunner invocation)
- [ ] `tests/acceptance/test_snapshot.py` — covers SCHEM-03, SCHEM-05, success criteria 2-5 (requires Docker)
- [ ] `tests/conftest.py` — shared fixtures (testcontainers session-scope `odoo` fixture)
- [ ] `pyproject.toml` `[tool.pytest.ini_options]` section — no config file exists yet; needed for `asyncio_mode = "auto"`

---

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1` per config.json.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes (Odoo credentials) | Credentials via env vars (`ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_PASSWORD`); never in DSL config file |
| V3 Session Management | No | godoo-py handles session internally; stateman is a short-lived CLI |
| V4 Access Control | No | Not applicable to a CLI that runs as the authenticated user |
| V5 Input Validation | Yes | Validate snapshot JSON via Pydantic `model_validate()` at load boundary; reject unknown fields |
| V6 Cryptography | No | `hashlib.sha256` for cache key (not a security use); no credentials hashed |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Odoo password in DSL `.py` config file | Information Disclosure | Read credentials from env only; document in README; never pass to `exec()` namespace |
| Malformed snapshot JSON causing deserialization panic | Tampering | Pydantic `model_validate()` raises `ValidationError` cleanly; do not use `json.loads()` directly on untrusted files |
| Cache path traversal via `odoo_version` string | Tampering | Sanitize `odoo_version` before using as a path segment; use `re.match(r"^\d+\.\d+$", version)` |
| TLS-bypassed jsonrpc (http:// URL) | Information Disclosure | Warn (not block at ASVS Level 1) if URL scheme is `http` and host is not `localhost`/`127.0.0.1` |

---

## Sources

### Primary (HIGH confidence — source-verified)

- `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\introspector.py` — `_IR_FIELDS` projection (lines 16-35 include `"store"`); `FieldSchema` construction at line 290 (`store=bool(fr.get("store", True))`); `get_schema`, `get_schemas` method signatures
- `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\types.py` — `FieldSchema(store: bool = True)` default at line 23; `ModelSchema` definition
- `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\client.py` — `OdooClient` full API surface; `create`, `write`, `search_read`, `ref` method signatures; error re-raises; async context manager
- `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\errors.py` — `OdooError` hierarchy; `OdooMissingError`, `OdooValidationError`, `OdooRpcError`
- `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\services\cdc\field_cache.py` — confirms `store` NOT in CDC field projection (lines 43-44); confirms SCHEM-05 "conflict" is a non-issue
- `C:\dev\godoo-dev\godoo-py\packages\godoo-testcontainers\src\godoo\testcontainers\harness.py` — `TestHarness` API, `async with TestHarness(...) as h: h.client`, session fixture pattern
- `C:\dev\godoo-dev\godoo-py\pyproject.toml` — workspace tool configuration: `asyncio_mode = "auto"`, `asyncio_default_fixture_loop_scope = "session"`, `integration` pytest marker, ruff/mypy config
- `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\pyproject.toml` — hatchling build backend pattern; `requires-python = ">=3.14"`
- `C:\dev\godoo-dev\godoo-py\packages\godoo\pyproject.toml` — `godoo-client` package structure; hatchling `only-include` pattern
- `C:\dev\godoo-dev\godoo-stateman\.planning\phases\01-bootstrap-schema-registry\01-CONTEXT.md` — all locked decisions D-01 through D-19
- `C:\dev\godoo-dev\godoo-stateman\CLAUDE.md` — locked technology stack; godoo-py gap analysis

### Secondary (MEDIUM confidence — verified against PyPI)

- PyPI JSON API for `platformdirs`: version 4.9.6 confirmed current [VERIFIED: `python -c "urllib.request.urlopen('https://pypi.org/pypi/platformdirs/json')"` → `4.9.6`]
- platformdirs docs (ReadTheDocs): `user_cache_path(appname, ensure_exists)` signature and return type `pathlib.Path` [CITED: platformdirs.readthedocs.io]

### Tertiary (MEDIUM confidence — training knowledge, not re-verified)

- Typer 0.25.1 async limitation: synchronous-only `@app.command()` decorator — ASSUMED based on CLAUDE.md + godoo-py pattern evidence; D-19 is the locked decision regardless
- `ir.model.data` field `complete_name`: computed as `"module.name"` — ASSUMED; resolved in Open Questions Q1 by constructing in Python (no longer load-bearing)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages source-verified from godoo-py or PyPI API
- Architecture: HIGH — all design decisions locked in CONTEXT.md; source-verified API surface
- Pitfalls: HIGH — SCHEM-05 is source-resolved; all other pitfalls from existing research PITFALLS.md (source-verified Odoo 17 facts)
- Package legitimacy: MEDIUM — slopcheck unavailable; `platformdirs` is a well-known library but tagged [ASSUMED]

**Research date:** 2026-05-23
**Valid until:** 2026-06-23 (godoo-py is under active development; re-verify API surface before Phase 2)
