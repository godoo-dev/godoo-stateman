# Phase 2: DSL Eval + Pure Pipeline - Pattern Map

**Mapped:** 2026-05-26
**Files analyzed:** 17 new/modified files
**Analogs found:** 17 / 17

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/godoo_stateman/dsl/__init__.py` | package-init | — | `src/godoo_stateman/schema/__init__.py` | exact |
| `src/godoo_stateman/dsl/types/__init__.py` | package-init | — | `src/godoo_stateman/types/__init__.py` | exact |
| `src/godoo_stateman/dsl/types/desired.py` | model | transform | `src/godoo_stateman/schema/snapshot.py` | role-match |
| `src/godoo_stateman/dsl/types/nodes.py` | model | transform | `src/godoo_stateman/schema/version.py` (`OdooVersion`) | role-match |
| `src/godoo_stateman/dsl/types/deferred.py` | model | transform | `src/godoo_stateman/schema/version.py` (`OdooVersion`) | role-match |
| `src/godoo_stateman/dsl/context.py` | utility | transform | `src/godoo_stateman/identity.py` | partial |
| `src/godoo_stateman/dsl/eval.py` | service | transform | `src/godoo_stateman/cli/commands/snapshot.py` | partial |
| `src/godoo_stateman/dsl/normalize.py` | service | transform | `src/godoo_stateman/schema/registry.py` | role-match |
| `src/godoo_stateman/dsl/graph.py` | service | transform | `src/godoo_stateman/schema/registry.py` | role-match |
| `src/godoo_stateman/errors.py` | utility | — | `src/godoo_stateman/errors.py` (extend) | exact |
| `src/godoo_stateman/cli/commands/plan.py` | controller | request-response | `src/godoo_stateman/cli/commands/snapshot.py` | role-match |
| `tests/unit/dsl/__init__.py` | test | — | `tests/unit/__init__.py` | exact |
| `tests/unit/dsl/test_eval.py` | test | transform | `tests/unit/test_schema_registry.py` | role-match |
| `tests/unit/dsl/test_normalize.py` | test | transform | `tests/unit/test_schema_registry.py` | role-match |
| `tests/unit/dsl/test_graph.py` | test | transform | `tests/unit/test_schema_registry.py` | role-match |
| `tests/unit/dsl/test_deferred.py` | test | transform | `tests/unit/test_identity.py` | role-match |
| `pyproject.toml` | config | — | `pyproject.toml` (extend `[project.dependencies]`) | exact |

---

## Pattern Assignments

### `src/godoo_stateman/dsl/__init__.py` and `src/godoo_stateman/dsl/types/__init__.py`

**Analog:** `src/godoo_stateman/schema/__init__.py` (empty package marker)

These are empty package marker files. The schema and types `__init__.py` files in Phase 1 are empty — copy that pattern exactly. The `dsl/__init__.py` will re-export the public surface later; for Phase 2 keep it empty or with minimal `__all__`.

---

### `src/godoo_stateman/dsl/types/desired.py` (model, transform)

**Analog:** `src/godoo_stateman/schema/snapshot.py`

**Imports pattern** (`snapshot.py` lines 1–13):
```python
from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from godoo_stateman.errors import VersionMismatchError
from godoo_stateman.schema.version import SCHEMA_FORMAT_VERSION
from godoo_stateman.types.schema import VersionedModelSchema
```

**Frozen Pydantic model pattern** (`snapshot.py` lines 15–32):
```python
class VersionedSnapshot(BaseModel):
    """..."""

    model_config = ConfigDict(frozen=True)

    odoo_version: str
    schema_format_version: int
    captured_at: str  # ISO 8601
    models: dict[str, VersionedModelSchema]
```

**Key adaptations for `DesiredState`:**
- Use `model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)` — the `resources` and `data_sources` fields will contain `ResourceNode` objects whose `fields` dict may hold `Deferred` (a callable-bearing dataclass). Without `arbitrary_types_allowed=True` Pydantic raises `PydanticSchemaGenerationError` at schema build time.
- Field types: `module: str`, `resources: tuple[ResourceNode, ...]`, `data_sources: tuple[DataSourceNode, ...]`, `config_parameters: tuple[dict[str, str], ...]`
- Use `tuple` not `list` for collections — `frozen=True` freezes attribute rebinding but not mutable container contents; `tuple` prevents accidental item append.

---

### `src/godoo_stateman/dsl/types/nodes.py` (model, transform)

**Analog:** `src/godoo_stateman/schema/version.py` (frozen dataclass pattern)

**Frozen dataclass pattern** (`version.py` lines 1–24):
```python
from __future__ import annotations

from dataclasses import dataclass

@dataclass(frozen=True)
class OdooVersion:
    """Immutable Odoo version descriptor."""

    major: int
    minor: int

    def __str__(self) -> str:
        return f"{self.major}.{self.minor}"
```

**Key adaptations for `ResourceNode` and `DataSourceNode`:**
- `ResourceNode` and `DataSourceNode` are `@dataclass(frozen=True)` pure value objects — not Pydantic models. They carry `fields: dict[str, Any]` which is inherently mutable; document this matches Phase-1 precedent (`VersionedModelSchema.fields`).
- `ResourceNode` needs: `model: str`, `slug: str`, `fields: dict[str, Any]`, `xmlid_module: str | None = None`, `parent_slug: str | None = None`. The `parent_slug` field is required so `build_graph()` can add parent→child edges without a second scan.
- `DataSourceNode` needs: `model: str`, `selector: dict[str, Any]`, `node_key: str`. The `node_key` is derived deterministically (e.g., `f"data.{model}[{sorted_selector_repr}]"`).
- Import `from __future__ import annotations` and `from typing import Any`.
- `ChildrenWrapper` also belongs here (or in `context.py`) — it is a `@dataclass(frozen=True)` holding `child_model: str`, `inverse_field: str`, `children: tuple[Any, ...]`.

---

### `src/godoo_stateman/dsl/types/deferred.py` (model, transform)

**Analog:** `src/godoo_stateman/schema/version.py` (frozen dataclass pattern)

**Pattern** (`version.py` lines 10–23, adapted):
```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

@dataclass(frozen=True)
class Deferred:
    """Eager thunk for a deferred computation — fires at read seam, not eval time."""

    fn: Any             # Callable; typed Any to allow frozen Pydantic field storage
    deps: frozenset[str]  # slug names of all *refs — become DAG edges
```

**`resolve()` function signature:**
```python
def resolve(fn: Any, *refs: Any) -> Deferred:
    """Return a Deferred thunk. Never calls fn in Phase 2.

    Extracts the identifier from each ref: .slug first (ResourceNode), then .node_key
    (DataSourceNode), then skips if neither attribute is a non-empty str. Both slug and
    node_key identifiers become DAG edges in the same deps frozenset.
    """
    deps: list[str] = []
    for r in refs:
        if hasattr(r, "slug") and isinstance(r.slug, str):
            deps.append(r.slug)
        elif hasattr(r, "node_key") and isinstance(r.node_key, str):
            deps.append(r.node_key)
        # else: skip — unrecognized ref type, produces no DAG edge
    return Deferred(fn=fn, deps=frozenset(deps))
```

**IMPORTANT (BLOCKER 3 fix):** The single-`.slug`-only variant shown in RESEARCH.md Pattern 2 is INCOMPLETE.
The correct implementation uses slug-first, node_key-fallback as shown above. Any implementation
that only extracts `.slug` will silently drop DataSourceNode refs and fail
`test_resolve_deps_from_data_source_node_key` (02-01) and `test_deferred_data_source_edge` (02-04).
The action text in 02-01 Task 2 is authoritative — this snippet now matches it.

Note: `fn` is typed `Any` (not `Callable[..., Any]`) because `Callable` annotation causes Pydantic schema generation issues when `ResourceNode.fields` values hold `Deferred`. The `Any` annotation is intentional and must be preserved.

---

### `src/godoo_stateman/dsl/context.py` (utility, transform)

**Analog:** `src/godoo_stateman/identity.py` (module-level functions + frozen dataclass)

**Imports pattern** (`identity.py` lines 1–31):
```python
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from godoo.client.client import OdooClient
```

**Key adaptations for `context.py`:**
- No `TYPE_CHECKING` guard needed (no async deps).
- Must define: `ResourceProxy`, `DataProxy`, `OdooModuleProxy`, `ConfigParameterProxy` — all as classes with `__getattr__` returning builder callables/sub-proxies.
- Must define `build_dsl_namespace(collector: _Collector) -> dict[str, Any]` — returns the `exec()` namespace dict.
- The `_Collector` internal class (or dataclass) accumulates resource/data/config lists during eval.
- Pattern: `ResourceProxy.__getattr__(model_name)` returns a callable `(slug, **fields) -> ResourceNode` that appends to the collector and returns the node for reference chaining.
- `with resource.res_partner("slug") as r:` works via `__enter__`/`__exit__` on a context manager returned from the proxy call.

---

### `src/godoo_stateman/dsl/eval.py` (service, transform)

**Analog:** `src/godoo_stateman/cli/commands/snapshot.py` (the only existing file that drives a multi-step pipeline)

**Sync function wrapping async impl pattern** (`snapshot.py` lines 22–28):
```python
def snapshot(
    config: Path = typer.Argument(..., help="Path to stateman config .py file"),
) -> None:
    """Introspect live Odoo and persist a versioned schema snapshot."""
    asyncio.run(_snapshot_impl(config))


async def _snapshot_impl(config: Path) -> None:
    """Async implementation — ..."""
```

**Key adaptations for `eval.py`:**
- `eval_config` is **sync** (not async) — no `asyncio.run()` wrapper needed. The Typer bridge is only for async CLI commands that call Odoo. DSL eval is pure sync.
- Structure: `def eval_config(path: Path) -> DesiredState:` is the public API.
- Use `compile(path.read_text(), str(path), "exec")` before `exec()` to get proper tracebacks with the config file's path.
- Extract `module` from `exec_locals` first, then `exec_globals` — never only one (Pitfall 2 from RESEARCH.md).
- Call `_flatten(collector.resources)` as the final step before constructing `DesiredState` — `DesiredState` must never contain `ChildrenWrapper` values.
- Raise `MissingModuleError` (new error subclass) if `module` is absent or not a non-empty `str`.

**Error raising pattern** (`snapshot.py` lines 51–53):
```python
if missing:
    raise typer.BadParameter(f"Missing required environment variables: {', '.join(missing)}")
```
Adapted: `raise MissingModuleError(f"Config file {path} must declare: module = \"<name>\"")` — same guard-and-raise idiom, using `StatemanError` subclass instead of `typer.BadParameter`.

---

### `src/godoo_stateman/dsl/normalize.py` (service, transform)

**Analog:** `src/godoo_stateman/schema/registry.py` (schema-driven transformation pipeline)

**Schema-driven field iteration pattern** (`registry.py` lines 54–65):
```python
versioned_fields = {
    fn: VersionedFieldSchema(
        name=fs.name,
        ttype=fs.ttype,
        store=fs.store,
        readonly=fs.readonly,
        compute=fs.compute,
        relation=fs.relation,
        required=fs.required,
    )
    for fn, fs in raw.fields.items()
}
```

**Key adaptations for `normalize.py`:**
- Signature: `def normalize(state: DesiredState, snapshot: VersionedSnapshot | None) -> DesiredState`
- Iterates over `state.resources`, and for each resource iterates over `resource.fields.items()`.
- For each field value, looks up `snapshot.models[resource.model].fields[field_name].ttype` (when snapshot is not `None` and the model/field exists).
- Returns a new `DesiredState` (frozen — must rebuild via constructor with new `ResourceNode` instances using `dataclasses.replace(node, fields=normalized_fields)`).
- When `snapshot is None`, return `state` unchanged — documented code path.
- `_normalize_value(value, ttype)` as private helper — see RESEARCH.md Pattern 4 for the exact implementation including `boolean` ttype carve-out (Pitfall 6, Assumption A1).
- Import: `from __future__ import annotations`, `import dataclasses`, `from typing import Any`.

---

### `src/godoo_stateman/dsl/graph.py` (service, transform)

**Analog:** `src/godoo_stateman/schema/registry.py` (stateful build + error raising)

**Build-and-validate pattern** (`registry.py` lines 39–76, structure):
```python
async def get(self, model_name: str, *, bypass_cache: bool = False) -> VersionedModelSchema:
    # 1. check cache
    # 2. fetch raw
    # 3. derive metadata
    # 4. build versioned result
    # 5. store in cache
    return versioned
```

**Key adaptations for `graph.py`:**
- Signature: `def build_graph(state: DesiredState) -> nx.DiGraph`
- Pure sync function — no `async def`.
- Pattern: add all nodes first, then add edges, then call `nx.find_cycle()`.
- Critical: wrap `nx.find_cycle(G)` in `try/except nx.NetworkXNoCycle` — NOT `if ... is None` (Pitfall 1 from RESEARCH.md).
- Raise `CycleError(f"Dependency cycle detected: {cycle_str}")` with the reconstructed path string.
- Child nodes (those where `node.parent_slug is not None`) get a `parent_slug → child_slug` edge.
- `Deferred` values in `resource.fields.values()` yield their `deps` frozenset as edges.
- Direct resource references in field values yield edges via `hasattr(field_val, "slug")`.
- Imports: `import networkx as nx`, `from godoo_stateman.errors import CycleError`.

---

### `src/godoo_stateman/errors.py` (extend existing file)

**Analog:** `src/godoo_stateman/errors.py` lines 1–18 (the existing file — extend it)

**Existing pattern** (lines 1–18):
```python
"""godoo-stateman local error hierarchy."""

from __future__ import annotations


class StatemanError(Exception):
    """Base class for all godoo-stateman local errors."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class VersionMismatchError(StatemanError):
    """Raised when a snapshot's odoo_version or schema_format_version does not match."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
```

**New subclasses to append** (copy the `VersionMismatchError` pattern exactly):
```python
class DslEvalError(StatemanError):
    """Raised when a DSL config file fails to evaluate."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class MissingModuleError(DslEvalError):
    """Raised when a DSL config file does not declare a top-level `module = "..."` variable."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class CycleError(StatemanError):
    """Raised when the dependency graph contains a cycle."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
```

Note: `MissingModuleError` subclasses `DslEvalError` (not `StatemanError` directly) — it is a specific eval failure. `CycleError` subclasses `StatemanError` directly — it is raised by `graph.py`, not by the DSL evaluator.

---

### `src/godoo_stateman/cli/commands/plan.py` (controller, request-response — stub update)

**Analog:** `src/godoo_stateman/cli/commands/plan.py` (current stub, lines 1–14)

**Current stub pattern** (lines 1–14):
```python
"""[stub] plan command — compute diff and emit a plan (Phase 3)."""

from __future__ import annotations

import typer
from rich.console import Console


def plan() -> None:
    """[stub] Compute diff and emit a plan (Phase 3)."""
    console = Console()
    console.print("[yellow]plan: not yet implemented (Phase 3)[/yellow]")
    raise typer.Exit(code=1)
```

**Phase 2 update:** Wire `eval_config` so the stub can be exercised locally. Minimal change — call `eval_config(config)` and print the module name + resource count. The command stays a stub (no diff, no plan output) but exercises the new DSL layer.

**Async bridge pattern** (`snapshot.py` lines 22–29) — only apply if `plan` needs async ops (Phase 2 eval is sync, so NO `asyncio.run()` wrapper needed here):
```python
def plan(...) -> None:
    asyncio.run(_plan_impl(...))

async def _plan_impl(...) -> None:
    ...
```

For Phase 2 the plan stub remains sync — call `eval_config(config)` directly.

---

### `tests/unit/dsl/test_eval.py` (test, transform)

**Analog:** `tests/unit/test_schema_registry.py`

**Module docstring + imports pattern** (`test_schema_registry.py` lines 1–22):
```python
"""Unit tests for schema types, version constants, registry, and snapshot.

Covers SCHEM-01 through SCHEM-04. All tests use mocked Introspector — no Docker required.
asyncio_mode = "auto" in pyproject.toml means no @pytest.mark.asyncio decorator is needed.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from godoo.introspection.types import FieldSchema, ModelSchema
from pydantic import ValidationError

from godoo_stateman.errors import VersionMismatchError
from godoo_stateman.schema.registry import SchemaRegistry
...
```

**Helper factory pattern** (`test_schema_registry.py` lines 28–47):
```python
def _make_field_schema(
    name: str,
    *,
    ttype: str = "char",
    store: bool = True,
    ...
) -> FieldSchema:
    """Build a minimal FieldSchema for testing."""
    return FieldSchema(name=name, ttype=ttype, ...)
```

**Top-level test function pattern** (no `class TestX`):
```python
def test_odoo_version_str_format() -> None:
    """OdooVersion(17, 0).__str__() returns '17.0'."""
    v = OdooVersion(major=17, minor=0)
    assert str(v) == "17.0"
```

**Key adaptations for `test_eval.py`:**
- Use `tmp_path: Path` fixture (pytest built-in) to write throwaway `.py` config files for `eval_config()` tests.
- Helper: `_write_config(tmp_path, content: str) -> Path` — writes content to a temp `.py` file and returns the path.
- No `@pytest.mark.asyncio` needed — `asyncio_mode = "auto"` is set globally, but `eval_config` is sync so test functions are plain `def`, not `async def`.
- Each test function covers one requirement (RSRC-01, RSRC-02, etc.) — one assert per requirement per function is the convention.

---

### `tests/unit/dsl/test_normalize.py` (test, transform)

**Analog:** `tests/unit/test_schema_registry.py`

**`_make_minimal_snapshot()` fixture-injection pattern** (`test_schema_registry.py` lines 81–104):
```python
def _make_minimal_snapshot(
    *,
    odoo_version: str = "17.0",
    schema_format_version: int = SCHEMA_FORMAT_VERSION,
    captured_at: str = "2026-01-01T00:00:00+00:00",
    models: dict[str, VersionedModelSchema] | None = None,
) -> VersionedSnapshot:
    if models is None:
        field = _make_versioned_field("name")
        model = VersionedModelSchema(
            name="res.partner",
            ...
        )
        models = {"res.partner": model}
    return VersionedSnapshot(
        odoo_version=odoo_version,
        schema_format_version=schema_format_version,
        captured_at=captured_at,
        models=models,
    )
```

**Key adaptations for `test_normalize.py`:**
- Define a local `_make_snapshot_with_field(model, field_name, ttype) -> VersionedSnapshot` helper following this exact pattern.
- Tests call `normalize(desired_state, snapshot)` with a fixture snapshot — never Docker.
- Idempotency test: call `normalize()` twice on the same input, assert output is structurally equal both times (SC-2).

---

### `tests/unit/dsl/test_graph.py` (test, transform)

**Analog:** `tests/unit/test_schema_registry.py`

**Error type assertion pattern** (`test_schema_registry.py` lines 245–253):
```python
def test_load_raises_on_schema_format_version_mismatch(tmp_path: Path) -> None:
    """VersionedSnapshot.load() raises VersionMismatchError on schema format version mismatch."""
    snap_with_future_version = _make_minimal_snapshot(schema_format_version=999)
    path = tmp_path / "future_snap.json"
    snap_with_future_version.save(path)

    with pytest.raises(VersionMismatchError) as exc_info:
        VersionedSnapshot.load(path, "17.0")
    assert "schema format version" in str(exc_info.value).lower()
```

**Key adaptations for `test_graph.py`:**
- Error assertion: `with pytest.raises(CycleError) as exc_info:` then `assert "cycle" in str(exc_info.value).lower()`.
- Also assert the cycle path nodes appear in the error message (REL-02 requires cycle path reporting).
- Construct `DesiredState` directly in test bodies (no file eval needed) — build `ResourceNode` objects manually and wrap in `DesiredState`.

---

### `tests/unit/dsl/test_deferred.py` (test, transform)

**Analog:** `tests/unit/test_identity.py` (pure unit tests — no async, no mocks needed)

**Pattern** (`test_identity.py` lines 59–64):
```python
async def test_find_by_xmlid_absent_returns_none() -> None:
    """find_by_xmlid returns None when search_read returns [] — never raises."""
```

**Key adaptations for `test_deferred.py`:**
- All tests are plain `def` (not `async def`) — `Deferred` and `resolve()` are sync.
- Tests verify: `resolve()` returns a `Deferred` instance, `fn` is stored but never called, `deps` contains exactly the slugs of the passed refs, `Deferred` is frozen (`dataclasses.FrozenInstanceError` on mutation attempt).
- SC-5 spike test: `test_resolve_dag_edges` — build a small `DesiredState` with `resolve()` in a field, call `build_graph()`, assert the expected edges exist in the returned `DiGraph`.

---

### `pyproject.toml` (extend `[project.dependencies]`)

**Analog:** `pyproject.toml` lines 8–15 (existing dependencies block)

**Current `[project.dependencies]`** (lines 8–15):
```toml
dependencies = [
    "godoo-client>=0.2.0",
    "godoo-introspection>=0.2.0",
    "typer>=0.25.1",
    "pydantic>=2.13.4",
    "rich>=15.0.0",
    "platformdirs>=4.9.6",
]
```

**Change needed:** Move `networkx>=3.6.1` from `[dependency-groups] dev` (line 52) to `[project.dependencies]`. NetworkX is a runtime dependency of `graph.py` — not dev-only. (RESEARCH.md Assumption A3: if left as dev dep only, `import networkx` fails at runtime for end users.)

---

## Shared Patterns

### Frozen immutable object pattern
**Source:** `src/godoo_stateman/types/schema.py` lines 14–47 and `src/godoo_stateman/schema/version.py` lines 10–23
**Apply to:** `dsl/types/desired.py`, `dsl/types/nodes.py`, `dsl/types/deferred.py`

Two forms used in this project — apply based on whether the type needs JSON serialization:
- **Pydantic `BaseModel` + `ConfigDict(frozen=True)`** — for pipeline tokens that may be serialized (e.g., `DesiredState`). Add `arbitrary_types_allowed=True` when the model holds `ResourceNode` objects.
- **`@dataclass(frozen=True)`** — for pure value objects that do not need serialization (`ResourceNode`, `DataSourceNode`, `Deferred`, `OdooVersion`, `XmlIdRecord`).

### `from __future__ import annotations` + `TYPE_CHECKING`
**Source:** `src/godoo_stateman/identity.py` lines 1–31 and `src/godoo_stateman/schema/registry.py` lines 1–18
**Apply to:** All new `src/` files
```python
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from some.module import SomeType  # only for types used exclusively in annotations
```
Note: Pydantic and Typer call `get_type_hints()` at runtime; types used in model fields or command signatures must NOT be in `TYPE_CHECKING` guards.

### Error hierarchy pattern
**Source:** `src/godoo_stateman/errors.py` lines 7–18
**Apply to:** `errors.py` (extend), all modules that raise errors
```python
class SomeError(StatemanError):
    """Docstring."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
```
All error subclasses use the same `__init__(self, message: str) -> None` signature — no extra fields.

### Typer async bridge (CLI commands with Odoo I/O only)
**Source:** `src/godoo_stateman/cli/commands/snapshot.py` lines 22–29
**Apply to:** CLI commands that make Odoo calls (Phase 3+). Do NOT apply to pure-pipeline stages.
```python
def command_name(config: Path = typer.Argument(...)) -> None:
    """Public docstring."""
    asyncio.run(_command_name_impl(config))

async def _command_name_impl(config: Path) -> None:
    """Async implementation."""
    ...
```
Phase 2 stages (`eval_config`, `normalize`, `build_graph`) are **sync** — no `asyncio.run()` wrapper.

### Test structure conventions
**Source:** `tests/unit/test_schema_registry.py` lines 1–26
**Apply to:** All new `tests/unit/dsl/test_*.py` files
- Module docstring citing which requirements are covered.
- `from __future__ import annotations` first.
- Private `_make_*` helper functions for fixture construction (not pytest fixtures).
- Test functions are top-level `def` (no `class TestX`).
- No `@pytest.mark.asyncio` decorator — `asyncio_mode = "auto"` handles it globally.
- `@pytest.mark.integration` only for Docker-backed tests (none in Phase 2).
- Descriptive docstrings on every test function (first line = what it asserts).

### Rich Console for CLI output
**Source:** `src/godoo_stateman/cli/commands/snapshot.py` lines 21, 31
**Apply to:** Updated `plan.py` stub
```python
from rich.console import Console
console = Console()
console.print("[yellow]message[/yellow]")
```

---

## No Analog Found

All files have analogs. The proxy objects in `context.py` (`ResourceProxy`, `DataProxy`, etc.) have no close analog in the codebase — the closest is `identity.py`'s module-level functions, but the proxy pattern (`__getattr__` chain) is novel to this project. The RESEARCH.md Pattern 1 (exec() with restricted builtins) and Pattern 5 (`children()` wrapper) provide the authoritative implementation reference for these.

---

## Metadata

**Analog search scope:** `src/godoo_stateman/`, `tests/unit/`
**Files scanned:** 14 source files, 4 test files
**Pattern extraction date:** 2026-05-26
