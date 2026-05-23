# Phase 1: Bootstrap + Schema Registry - Pattern Map

**Mapped:** 2026-05-23
**Files analyzed:** 13 new files
**Analogs found:** 13 / 13 (all from godoo-py — stateman src/ is empty)

> All analogs are drawn from `C:\dev\godoo-dev\godoo-py\packages\` because godoo-stateman
> has no existing source tree. This is expected and documented in the phase context.

---

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `pyproject.toml` | config | — | `godoo-py/packages/godoo-introspection/pyproject.toml` | exact |
| `src/godoo_stateman/__init__.py` | config | — | `godoo-py/packages/godoo/src/godoo/client/__init__.py` | role-match |
| `src/godoo_stateman/errors.py` | utility | — | `godoo-py/packages/godoo/src/godoo/client/errors.py` | exact |
| `src/godoo_stateman/cli/app.py` | config | request-response | `godoo-py/packages/godoo/src/godoo/client/config.py` (env-config pattern) | partial |
| `src/godoo_stateman/cli/commands/snapshot.py` | utility/command | request-response | `godoo-py/packages/godoo/src/godoo/client/services/attendance/functions.py` | role-match |
| `src/godoo_stateman/cli/commands/plan.py` (stub) | utility/command | request-response | same as snapshot.py | role-match |
| `src/godoo_stateman/cli/commands/apply.py` (stub) | utility/command | request-response | same as snapshot.py | role-match |
| `src/godoo_stateman/cli/commands/verify.py` (stub) | utility/command | request-response | same as snapshot.py | role-match |
| `src/godoo_stateman/cli/commands/import_.py` (stub) | utility/command | request-response | same as snapshot.py | role-match |
| `src/godoo_stateman/types/schema.py` | model | — | `godoo-py/packages/godoo-introspection/src/godoo/introspection/types.py` | exact |
| `src/godoo_stateman/schema/registry.py` | service | CRUD | `godoo-py/packages/godoo-introspection/src/godoo/introspection/introspector.py` | exact |
| `src/godoo_stateman/schema/snapshot.py` | service | file-I/O | `godoo-py/packages/godoo-introspection/src/godoo/introspection/types.py` (data shapes) | partial |
| `src/godoo_stateman/identity.py` | service | CRUD | `godoo-py/packages/godoo/src/godoo/client/client.py` (`ref` method, lines 287-304) | role-match |
| `tests/unit/test_schema_registry.py` | test | — | `godoo-py/packages/godoo-introspection/tests/test_introspector.py` | exact |
| `tests/unit/test_identity.py` | test | — | `godoo-py/packages/godoo/tests/test_client.py` | exact |
| `tests/unit/test_cli_help.py` | test | — | `godoo-py/packages/godoo/tests/test_errors.py` (structure) | role-match |
| `tests/acceptance/test_snapshot.py` | test | request-response | `godoo-py/packages/godoo-introspection/tests/test_introspector.py` | role-match |
| `tests/conftest.py` | config | — | `godoo-py/packages/godoo-introspection/tests/test_introspector.py` (fixture pattern) | role-match |

---

## Pattern Assignments

### `pyproject.toml` (config)

**Analog:** `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\pyproject.toml`

**Full file (all 30 lines — copy this structure exactly):**
```toml
[project]
name = "godoo-introspection"
version = "0.2.0"
description = "Schema discovery and codegen for Odoo models"
readme = "README.md"
license = "LGPL-3.0-or-later"
requires-python = ">=3.14"
dependencies = ["godoo-client>=0.1.0"]
authors = [{ name = "Marc Fargas", email = "marc@marcfargas.com" }]
classifiers = [
    "Development Status :: 2 - Pre-Alpha",
    "Framework :: AsyncIO",
    "Framework :: Odoo",
    "Intended Audience :: Developers",
    "Typing :: Typed",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
sources = ["src"]
only-include = ["src/godoo/introspection"]
```

**Tool configuration block** (from `C:\dev\godoo-dev\godoo-py\pyproject.toml`, lines 20-51):
```toml
[tool.ruff]
target-version = "py314"
line-length = 120

[tool.ruff.lint]
select = ["E", "F", "W", "I", "UP", "B", "SIM", "TCH", "RUF"]

[tool.mypy]
python_version = "3.14"
strict = true
warn_return_any = true
warn_unused_configs = true
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

**Stateman-specific additions** (not in analog — new for stateman):
- `[project.scripts]` entry point: `godoo-stateman = "godoo_stateman.cli.app:app"`
- `[tool.uv.sources]` pointing workspace siblings at `../godoo-py`
- Dev dependencies block: `pytest>=8`, `pytest-asyncio>=0.24`, `ruff>=0.8`, `mypy>=1.13`, `godoo-testcontainers>=0.2.0`
- Runtime dependencies: `typer>=0.25.1`, `pydantic>=2.13.4`, `rich>=15.0.0`, `platformdirs>=4.9.6`

---

### `src/godoo_stateman/errors.py` (utility)

**Analog:** `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\errors.py`

**Imports pattern** (lines 1-6):
```python
from __future__ import annotations

from typing import TYPE_CHECKING, Any
```

**Error hierarchy pattern** (lines 9-30) — copy the base class structure, then add stateman-specific errors:
```python
class OdooError(Exception):
    """Base class for all Odoo client errors."""

    def to_json(self) -> dict[str, Any]:
        return {
            "error": "ODOO_ERROR",
            "message": str(self),
            "details": None,
        }


class OdooRpcError(OdooError):
    """Generic RPC error returned by the Odoo server."""

    def __init__(
        self,
        message: str,
        *,
        code: int | None = None,
        data: dict[str, Any] | None = None,
        cause: Exception | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.data = data
        if cause is not None:
            self.__cause__ = cause
```

**Stateman-specific error** (no analog — add below the imports from godoo-py errors):
```python
# Stateman-specific errors — do NOT subclass OdooError (these are local, not RPC errors)
class StatemanError(Exception):
    """Base class for all godoo-stateman local errors."""


class VersionMismatchError(StatemanError):
    """Raised when a snapshot's odoo_version or schema_format_version does not match."""
```

**Key decision:** `VersionMismatchError` subclasses `StatemanError` (local), NOT `OdooError` (remote). The godoo-py error hierarchy handles RPC errors; stateman adds its own hierarchy for local errors. Both trees coexist.

---

### `src/godoo_stateman/types/schema.py` (model)

**Analog:** `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\types.py`

**Full analog file (46 lines — read completely):**
```python
"""ModelSchema and FieldSchema dataclasses — typed schema representations."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class FieldSchema:
    name: str
    ttype: str
    field_description: str = ""
    relation: str | None = None
    relation_field: str | None = None
    required: bool = False
    readonly: bool = False
    store: bool = True       # <-- line 23: default True, set from ir.model.fields
    index: bool = False
    copy: bool = True
    translate: bool = False
    help: str = ""
    compute: str | None = None
    depends: tuple[str, ...] = ()
    modules: tuple[str, ...] = ()
    on_delete: str | None = None
    size: int | None = None
    digits: tuple[int, int] | None = None
    selection: list[tuple[str, str]] = field(default_factory=list)


@dataclass  # NOT frozen=True — has dict field (unhashable)
class ModelSchema:
    name: str
    display_name: str = ""
    transient: bool = False
    fields: dict[str, FieldSchema] = field(default_factory=dict)
```

**Stateman variant:** `VersionedFieldSchema` and `VersionedModelSchema` mirror this structure but:
- Use `pydantic.BaseModel` with `model_config = ConfigDict(frozen=True)` instead of `@dataclass(frozen=True)` — required for JSON serialization via `model_dump_json()`
- Add `odoo_version: str` field to `VersionedModelSchema`
- Subset of fields: `name`, `ttype`, `store`, `readonly`, `compute`, `relation`, `required` — only what stateman needs for plan decisions
- `VersionedModelSchema` also includes `archivable: bool` (derived from whether `active` field exists with `store=True`)

---

### `src/godoo_stateman/schema/registry.py` (service, CRUD)

**Analog:** `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\introspector.py`

**Class init pattern** (lines 125-136):
```python
class Introspector:
    def __init__(self, client: OdooClient) -> None:
        self._client = client
        self._cache = IntrospectionCache()
```
Copy this init pattern: `SchemaRegistry.__init__` takes `(client: OdooClient, version: OdooVersion)` and stores both.

**Cache pattern** (lines 92-118 — `IntrospectionCache` class):
```python
class IntrospectionCache:
    """Per-instance dict cache keyed by model name."""

    def __init__(self) -> None:
        self._cache: dict[str, ModelSchema] = {}

    def get(self, name: str) -> ModelSchema | None:
        return self._cache.get(name)

    def set(self, name: str, schema: ModelSchema) -> None:
        self._cache[name] = schema

    def invalidate(self, name: str) -> None:
        self._cache.pop(name, None)

    def clear(self) -> None:
        self._cache.clear()
```
Copy this pattern for `SchemaRegistry`'s in-memory cache (`dict[str, VersionedModelSchema]`).

**Async get pattern** (lines 137-151):
```python
async def get_schema(self, name: str, *, bypass_cache: bool = False) -> ModelSchema:
    if not bypass_cache:
        cached = self._cache.get(name)
        if cached is not None:
            return cached
    schemas = await self.get_schemas([name], bypass_cache=bypass_cache)
    if name not in schemas:
        raise OdooMissingError(f"Model not found in ir.model: {name!r}")
    return schemas[name]
```
Copy this cache-check-then-fetch pattern for `SchemaRegistry.get()`.

**Field wrapping pattern** (lines 282-302):
```python
field_schemas[field_name] = FieldSchema(
    name=field_name,
    ttype=ttype,
    ...
    store=bool(fr.get("store", True)),   # source-verified at line 290
    readonly=bool(fr.get("readonly", False)),
    compute=compute,
    relation=relation,
    required=bool(fr.get("required", False)),
)
```
This is the exact pattern for wrapping `godoo-py FieldSchema` into `VersionedFieldSchema`.

**TYPE_CHECKING import guard pattern** (lines 10-11):
```python
if TYPE_CHECKING:
    from godoo.client.client import OdooClient
```
Use this for `OdooClient` to avoid circular imports at runtime.

---

### `src/godoo_stateman/schema/snapshot.py` (service, file-I/O)

**Analog:** `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\types.py` (data shape pattern) + RESEARCH.md Pattern 3.

**Pydantic frozen model pattern** (from RESEARCH.md, which itself derives from godoo-py's Pydantic v2 usage):
```python
from pydantic import BaseModel, ConfigDict

class VersionedSnapshot(BaseModel):
    model_config = ConfigDict(frozen=True)

    odoo_version: str
    schema_format_version: int
    captured_at: str           # ISO 8601
    models: dict[str, VersionedModelSchema]

    def save(self, path: Path) -> None:
        path.write_text(self.model_dump_json(indent=2))

    @classmethod
    def load(cls, path: Path, expected_odoo_version: str) -> "VersionedSnapshot":
        data = json.loads(path.read_text())
        snap = cls.model_validate(data)
        # Check schema_format_version first (breaking stateman upgrade)
        if snap.schema_format_version != SCHEMA_FORMAT_VERSION:
            raise VersionMismatchError(
                f"Schema format version mismatch: file has {snap.schema_format_version}, "
                f"expected {SCHEMA_FORMAT_VERSION}"
            )
        # Check odoo_version second (wrong Odoo instance)
        if snap.odoo_version != expected_odoo_version:
            raise VersionMismatchError(
                f"Odoo version mismatch: file={snap.odoo_version!r}, expected={expected_odoo_version!r}"
            )
        return snap
```

**No direct analog for snapshot save/load** — this pattern is stateman-specific. The closest godoo-py analog is the `IntrospectionCache` class (in-memory dict), but disk I/O is new here. RESEARCH.md Pattern 3 is authoritative.

---

### `src/godoo_stateman/identity.py` (service, CRUD)

**Analog:** `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\client.py` — specifically the `ref()` method (lines 287-304).

**`ref()` — the pattern to extend for `find_by_xmlid`** (lines 287-304):
```python
async def ref(self, xml_id: str) -> int:
    """Resolve an external ID (module.name) to a numeric record id.

    Raises OdooValidationError for malformed xml_id.
    Raises OdooMissingError when the xml_id is not found.
    """
    parts = xml_id.split(".", 1)
    if len(parts) != 2:
        raise OdooValidationError(f"Invalid XML ID format (expected 'module.name'): {xml_id!r}")
    module, name = parts
    records = await self.search_read(
        "ir.model.data",
        [("module", "=", module), ("name", "=", name)],
        fields=["res_id"],
    )
    if not records:
        raise OdooMissingError(f"XML ID not found: {xml_id!r}")
    return cast("int", records[0]["res_id"])
```

**Key difference from analog:** `find_by_xmlid` returns `None` on absence (D-14), never raises `OdooMissingError`. The `ref()` raises — stateman's helper must NOT copy that behavior.

**`search_read` call pattern** (lines 194-213):
```python
async def search_read(
    self,
    model: str,
    domain: list[Any] | None = None,
    *,
    fields: list[str] | None = None,
    limit: int | None = None,
    ...
) -> list[dict[str, Any]]:
```
Use keyword args for `fields` and `limit` in all `search_read` calls — matches the godoo-py signature.

**`create` call pattern** (lines 336-358):
```python
async def create(
    self,
    model: str,
    values: dict[str, Any] | list[dict[str, Any]],
    **kwargs: Any,
) -> int | list[int]:
    # Pass single dict → returns int
    return cast("int", await self.call(model, "create", [values], kwargs))
```

**`write` call pattern** (lines 360-369):
```python
async def write(
    self,
    model: str,
    ids: int | list[int],
    values: dict[str, Any],
    **kwargs: Any,
) -> bool:
    if isinstance(ids, int):
        ids = [ids]
    return cast("bool", await self.call(model, "write", [ids, values], kwargs))
```

**`XmlIdRecord` shape** — use `@dataclass(frozen=True)` (matching `FieldSchema` pattern from introspection/types.py line 8):
```python
from dataclasses import dataclass

@dataclass(frozen=True)
class XmlIdRecord:
    module: str
    name: str
    model: str
    res_id: int
    complete_name: str  # constructed as f"{module}.{name}" in Python (see Open Question #1)
```

---

### `src/godoo_stateman/cli/app.py` (config, request-response)

**Analog:** `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\config.py` — specifically `config_from_env()` (lines 14-53) for env-var credential reading pattern.

**Env-var config pattern** (lines 14-53):
```python
def config_from_env(prefix: str = "ODOO") -> OdooClientConfig:
    url = os.environ.get(f"{prefix}_URL")
    database = os.environ.get(f"{prefix}_DB") or os.environ.get(f"{prefix}_DATABASE")
    username = os.environ.get(f"{prefix}_USER") or os.environ.get(f"{prefix}_USERNAME")
    password = os.environ.get(f"{prefix}_PASSWORD")

    missing: list[str] = []
    if not url:
        missing.append(f"{prefix}_URL")
    # ... collect all missing
    if missing:
        raise OdooError(f"Missing required environment variables: {', '.join(missing)}")
```
Copy this pattern for `app.py`'s common options callback that reads `ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_PASSWORD`.

**No Typer CLI analog in godoo-py** — godoo-py has no CLI layer. The Typer app structure (app instantiation, command registration, async bridge) has no analog and must follow RESEARCH.md patterns directly.

---

### `src/godoo_stateman/cli/commands/snapshot.py` (command, request-response)

**Analog:** `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\services\attendance\functions.py` — standalone async function pattern (lines 1-50).

**Async function pattern** (lines 22-35):
```python
async def resolve_employee_id(
    client: OdooClient,
    employee_id: int | None = None,
) -> int:
    """Resolve an employee ID, falling back to the current session user."""
    if employee_id is not None:
        return employee_id
    session = client.get_session()
    if session is None:
        raise OdooValidationError("Not authenticated — cannot resolve employee")
    ids = await client.search(_EMPLOYEE_MODEL, [("user_id", "=", session.uid)], limit=1)
```
Copy this standalone `async def` function pattern for `_snapshot_impl`. Business logic lives in the `async def _impl`; the Typer command is a thin sync wrapper.

**Async bridge pattern** (from RESEARCH.md Pattern 1 — no godoo-py analog, Typer-specific):
```python
# The ONLY pattern for Typer commands in stateman:
def snapshot(config: Path = typer.Argument(..., help="...")):
    """Introspect live Odoo and persist a versioned schema snapshot."""
    asyncio.run(_snapshot_impl(config))

async def _snapshot_impl(config: Path) -> None:
    # All async work here
    ...
```

**Stub pattern** (for plan/apply/verify/import_ — from D-18):
```python
def plan(...):
    """[stub] Compute diff and emit a plan (Phase 3)."""
    console = Console()
    console.print("[yellow]plan: not yet implemented (Phase 3)[/yellow]")
    raise typer.Exit(code=1)
```
No godoo-py analog — pure Typer pattern from RESEARCH.md.

---

### `tests/unit/test_schema_registry.py` (test)

**Analog:** `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\tests\test_introspector.py`

**Imports and fixture pattern** (lines 1-33):
```python
from __future__ import annotations

import httpx
import pytest
import respx
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooMissingError, OdooValidationError
from godoo.introspection.introspector import IntrospectionCache, Introspector
from godoo.introspection.types import FieldSchema, ModelSchema

BASE_URL = "http://odoo.test"
DB = "testdb"


def _rpc_response(result, id=1) -> httpx.Response:
    return httpx.Response(200, json={"jsonrpc": "2.0", "id": id, "result": result})


def _make_client() -> OdooClient:
    return OdooClient(OdooClientConfig(url=BASE_URL, database=DB, username="admin", password="admin"))


@pytest.fixture
async def auth_client():
    client = _make_client()
    with respx.mock:
        respx.post(f"{BASE_URL}/jsonrpc").mock(return_value=_rpc_response(2))
        await client.authenticate()
    yield client
    await client.aclose()
```
Copy this fixture pattern exactly: `_make_client()` helper + `auth_client` async fixture with `respx.mock` for transport mocking. Note: `pytest-asyncio` `asyncio_mode = "auto"` means no `@pytest.mark.asyncio` decorator needed.

**Test class structure** (lines 40-76 — no classes, top-level functions):
```python
def test_field_meta_default_attrs():
    meta = FieldMeta(ttype="many2one")
    assert meta.store is True

def test_model_schema_not_hashable():
    schema = ModelSchema(name="res.partner")
    with pytest.raises(TypeError):
        hash(schema)
```
Use top-level test functions (not `class TestX`). This is godoo-py's convention.

---

### `tests/unit/test_identity.py` (test)

**Analog:** `C:\dev\godoo-dev\godoo-py\packages\godoo\tests\test_client.py` (lines 1-58)

**Mock fixture pattern** (lines 30-43):
```python
@pytest.fixture
async def auth_client():
    c = OdooClient(_make_config())
    with respx.mock:
        respx.post(f"{BASE_URL}/jsonrpc").mock(return_value=httpx.Response(200, json=_jsonrpc_result(2)))
        await c.authenticate()
    yield c
```

**Respx mock for RPC calls pattern** (lines 51-57):
```python
@respx.mock
@pytest.mark.asyncio
async def test_authenticate_success(client):
    respx.post(f"{BASE_URL}/jsonrpc").mock(return_value=httpx.Response(200, json=_jsonrpc_result(2)))
    session = await client.authenticate()
    assert session.uid == 2
```
Use `@respx.mock` decorator + `respx.post(url).mock(return_value=...)` to mock individual jsonrpc calls in identity tests.

---

### `tests/unit/test_errors.py` / `test_cli_help.py` (test)

**Analog:** `C:\dev\godoo-dev\godoo-py\packages\godoo\tests\test_errors.py`

**Error hierarchy test pattern** (lines 1-35):
```python
from __future__ import annotations

from godoo.client.errors import (
    OdooError,
    OdooRpcError,
    OdooMissingError,
    OdooValidationError,
)

def test_is_exception() -> None:
    err = OdooError("something went wrong")
    assert isinstance(err, Exception)

def test_to_json_shape() -> None:
    err = OdooError("base message")
    result = err.to_json()
    assert result["error"] == "ODOO_ERROR"
    assert result["message"] == "base message"
    assert result["details"] is None
```
Copy this pattern for `test_version_mismatch_error.py`: instantiate, assert isinstance, assert message.

---

### `tests/acceptance/test_snapshot.py` (test, integration)

**Analog:** `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\tests\test_introspector.py` fixture pattern + RESEARCH.md Code Example "testcontainers acceptance test pattern".

**Session-scoped fixture pattern** (lines 26-33 of test_introspector.py, adapted):
```python
@pytest.fixture(scope="session")
async def auth_client():
    client = _make_client()
    with respx.mock:
        ...
    yield client
    await client.aclose()
```

**TestHarness async context manager** (from `harness.py` lines 45-61):
```python
async def __aenter__(self) -> TestHarness:
    container = OdooTestContainer(...)
    self._started = await container.start()
    return self

# Usage:
@pytest.fixture(scope="session")
async def odoo():
    async with TestHarness(snapshot=True) as h:
        yield h
```

**Integration marker pattern** (from `godoo-py/pyproject.toml` lines 48-50):
```toml
markers = [
    "integration: marks tests requiring Docker/Odoo (deselect with '-m not integration')",
]
```
Mark acceptance tests with `@pytest.mark.integration`.

---

### `tests/conftest.py` (config)

**Analog:** `C:\dev\godoo-dev\godoo-py\packages\godoo\tests\test_client.py` lines 24-27 (`_make_config` helper).

**Shared helpers pattern:**
```python
def _make_config(**kwargs):
    defaults = dict(url=BASE_URL, database=DB, username="admin", password="admin")
    defaults.update(kwargs)
    return OdooClientConfig(**defaults)
```
Put shared `_make_config()`, `_jsonrpc_result()`, and the `session`-scoped `odoo` TestHarness fixture in `conftest.py`.

---

## Shared Patterns

### `from __future__ import annotations` Header
**Source:** Every godoo-py Python file, line 1.
**Apply to:** All stateman Python files.
```python
from __future__ import annotations
```
This is universal in godoo-py — apply without exception.

### TYPE_CHECKING Guard for Heavy Imports
**Source:** `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\introspector.py`, lines 10-11; `client.py` lines 21-31.
**Apply to:** Any file that imports `OdooClient` at type annotation level only.
```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from godoo.client.client import OdooClient
```

### Async OdooClient Context Manager
**Source:** `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\client.py`, lines 438-460.
**Apply to:** `snapshot.py` command `_impl` function and acceptance tests.
```python
async with OdooClient(config) as client:
    # client is authenticated; aclose() called on exit
    ...
```

### Error Hierarchy Extension (stateman-specific)
**Source:** `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\errors.py`, lines 9-17.
**Apply to:** `errors.py`.
```python
class OdooError(Exception):
    def to_json(self) -> dict[str, Any]:
        return {"error": "ODOO_ERROR", "message": str(self), "details": None}
```
Stateman's `StatemanError` follows this pattern but does NOT subclass `OdooError`.

### Frozen Dataclass for Value Objects
**Source:** `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\types.py`, line 8.
**Apply to:** `XmlIdRecord` in `identity.py`.
```python
@dataclass(frozen=True)
class XmlIdRecord:
    ...
```
Use `frozen=True` for all value objects that are returned from async functions and may be cached.

### Pydantic `ConfigDict(frozen=True)` for Serializable Models
**Source:** RESEARCH.md Pattern 3 — no direct godoo-py analog (godoo-py uses dataclasses for types).
**Apply to:** `VersionedFieldSchema`, `VersionedModelSchema`, `VersionedSnapshot` in `types/schema.py` and `schema/snapshot.py`.
```python
from pydantic import BaseModel, ConfigDict

class VersionedSnapshot(BaseModel):
    model_config = ConfigDict(frozen=True)
```
Use Pydantic only where JSON serialization is needed (`model_dump_json()`, `model_validate()`). Use `@dataclass(frozen=True)` for pure in-memory value objects without serialization needs.

### Defensive `.get()` with Defaults on Odoo API Results
**Source:** `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\introspector.py`, lines 255-300.
**Apply to:** Any code that reads dicts returned from `client.search_read()`.
```python
field_name = str(fr.get("name") or "")
store = bool(fr.get("store", True))    # Odoo may omit the key; default True is safe
relation = _coerce_str_or_none(fr.get("relation"))  # Odoo returns False for empty relations
```
Never use `fr["key"]` directly on Odoo search_read results — always `.get()` with a safe default.

### `search_read` Keyword Argument Convention
**Source:** `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\client.py`, lines 194-213.
**Apply to:** All `client.search_read()` calls in `identity.py`, `schema/registry.py`.
```python
records = await client.search_read(
    "ir.model.data",
    [("module", "=", module), ("name", "=", name)],
    fields=["res_id", "model"],   # keyword arg
    limit=1,                      # keyword arg
)
```

### Config From Environment Variables
**Source:** `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\config.py`, lines 14-53.
**Apply to:** `cli/app.py` common options / callback.
```python
import os
url = os.environ.get("ODOO_URL")
database = os.environ.get("ODOO_DB") or os.environ.get("ODOO_DATABASE")
# Collect missing, raise with full list
```

---

## No Analog Found

These stateman concerns have no analog in godoo-py and must use RESEARCH.md patterns directly:

| File / Pattern | Role | Reason |
|----------------|------|--------|
| `src/godoo_stateman/cli/app.py` (Typer app creation) | config | godoo-py has no CLI layer |
| `src/godoo_stateman/cli/commands/*.py` (Typer `@app.command()` decorator) | command | godoo-py has no Typer commands |
| `src/godoo_stateman/schema/snapshot.py` (disk I/O with platformdirs) | service | godoo-py caches in-memory only; no disk persistence |
| `src/godoo_stateman/schema/version.py` (OdooVersion dataclass + `SCHEMA_FORMAT_VERSION`) | model | No version-tagged schema concept in godoo-py |
| Typer async bridge (`asyncio.run(_impl(...))`) | cross-cutting | godoo-py has no Typer; the bridge is CLI-layer-specific |

For all of the above, use RESEARCH.md Patterns 1-4 and the Architecture Patterns section directly.

---

## Metadata

**Analog search scope:** `C:\dev\godoo-dev\godoo-py\packages\` (all 3 sub-packages: godoo-client, godoo-introspection, godoo-testcontainers)
**Files scanned:** 14 source files + 5 test files + 3 pyproject.toml files
**Pattern extraction date:** 2026-05-23
**Note:** godoo-stateman `src/` is empty at time of mapping — all analogs are external (godoo-py). This is normal for Phase 1 bootstrap.
