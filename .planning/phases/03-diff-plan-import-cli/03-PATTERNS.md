# Phase 3: Diff + Plan + Import CLI - Pattern Map

**Mapped:** 2026-05-27
**Files analyzed:** 14 new/modified files
**Analogs found:** 14 / 14

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/godoo_stateman/dsl/types/desired.py` | model | transform | self (rename `.module` → `.xmlid_prefix`) | self |
| `src/godoo_stateman/dsl/eval.py` | service | transform | self (rename `module` extraction) | self |
| `src/godoo_stateman/dsl/context.py` | service | transform | self (rename `_module=` → `_xmlid_prefix=`) | self |
| `src/godoo_stateman/dsl/normalize.py` | service | transform | self (rename `state.module` reference) | self |
| `src/godoo_stateman/errors.py` | utility | — | self (add new error subclasses) | self |
| `src/godoo_stateman/plan/types.py` | model | — | `src/godoo_stateman/types/schema.py` | exact |
| `src/godoo_stateman/plan/render.py` | utility | request-response | `src/godoo_stateman/cli/commands/plan.py` (stub) | role-match |
| `src/godoo_stateman/live/livestate.py` | service | request-response | `src/godoo_stateman/identity.py` | role-match |
| `src/godoo_stateman/live/seam.py` | service | request-response | `src/godoo_stateman/identity.py` | role-match |
| `src/godoo_stateman/diff.py` | service | transform | `src/godoo_stateman/dsl/normalize.py` | role-match |
| `src/godoo_stateman/cli/commands/plan.py` | controller | request-response | `src/godoo_stateman/cli/commands/apply.py` | exact |
| `src/godoo_stateman/cli/commands/import_.py` | controller | request-response | `src/godoo_stateman/cli/commands/apply.py` | exact |
| `tests/unit/test_diff.py` | test | — | `tests/unit/test_schema_registry.py` | exact |
| `tests/unit/test_seam.py` | test | — | `tests/unit/test_identity.py` | exact |
| `tests/unit/test_plan_render.py` | test | — | `tests/unit/test_schema_registry.py` | role-match |
| `tests/unit/test_plan_command.py` | test | — | `tests/unit/test_cli_help.py` | role-match |
| `tests/acceptance/test_plan_import.py` | test | request-response | `tests/acceptance/test_snapshot.py` | exact |

---

## Pattern Assignments

### `src/godoo_stateman/dsl/types/desired.py` (model rename — D-05)

**Analog:** self

**Rename target** (`desired.py` lines 22–29 → lines 22–29 after edit):
```python
# BEFORE (lines 22-29):
class DesiredState(BaseModel):
    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    module: str          # ← rename to xmlid_prefix
    resources: tuple[ResourceNode, ...]
    data_sources: tuple[DataSourceNode, ...]
    config_parameters: tuple[dict[str, str], ...]

# AFTER:
class DesiredState(BaseModel):
    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    xmlid_prefix: str    # renamed from module (D-05)
    resources: tuple[ResourceNode, ...]
    data_sources: tuple[DataSourceNode, ...]
    config_parameters: tuple[dict[str, str], ...]
```

**Cascade callsites** — every `state.module` reference in:
- `dsl/eval.py` line 243: `module=module` → `xmlid_prefix=module_raw`
- `dsl/normalize.py` line 112: `module=state.module` → `xmlid_prefix=state.xmlid_prefix`
- `cli/commands/plan.py` stub line 29: `state.module` → `state.xmlid_prefix`

---

### `src/godoo_stateman/errors.py` (utility — add new subclasses)

**Analog:** `src/godoo_stateman/errors.py` lines 1–39

**Existing pattern** (lines 1–39):
```python
from __future__ import annotations


class StatemanError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)


class DslEvalError(StatemanError):
    def __init__(self, message: str) -> None:
        super().__init__(message)


class MissingModuleError(DslEvalError):
    def __init__(self, message: str) -> None:
        super().__init__(message)


class CycleError(StatemanError):
    def __init__(self, message: str) -> None:
        super().__init__(message)
```

**New classes to append** (follow identical `__init__` + docstring pattern):
```python
class XmlidCollisionError(StatemanError):
    """Raised when find_by_xmlid resolves to a record of a different model (D-02).

    The xmlid namespace is already owned by a different Odoo model than the
    config declares. This is a Reject action — operator must resolve manually.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)


class LiveStateFetchError(StatemanError):
    """Raised when a live Odoo fetch fails or returns unexpected results.

    Examples: DataSourceNode selector resolves 0 or >1 records (Pitfall 5).
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
```

**MissingModuleError:** Keep the class name; update the message in `eval.py` to reference `xmlid_prefix = "..."` instead of `module = "..."` (RESEARCH.md Open Question 1 recommendation).

---

### `src/godoo_stateman/plan/types.py` (model — frozen Pydantic)

**Analog:** `src/godoo_stateman/types/schema.py` (lines 1–48)

**Imports pattern** (copy from `types/schema.py` lines 1–8):
```python
from __future__ import annotations

from pydantic import BaseModel, ConfigDict
```

**Frozen Pydantic model pattern** (from `types/schema.py` lines 14–30):
```python
class VersionedFieldSchema(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    ttype: str
    store: bool
    readonly: bool
    compute: str | None
    relation: str | None
    required: bool
```

**New types to implement** (apply exact same `ConfigDict(frozen=True)` pattern, use `tuple` not `list` for collections per `DesiredState` precedent):
```python
from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict


class PlanAction(str, Enum):
    CREATE = "create"
    UPDATE = "update"
    NOOP = "noop"
    DELETE = "delete"
    ARCHIVE = "archive"
    REJECT = "reject"


class FieldDiff(BaseModel):
    model_config = ConfigDict(frozen=True)

    field_name: str
    old_value: Any
    new_value: Any


class PlanStep(BaseModel):
    model_config = ConfigDict(frozen=True)

    action: PlanAction
    slug: str
    model: str
    xmlid: str          # full xmlid e.g. "myprefix.my_slug"
    res_id: int | None  # None for Create (not yet exists)
    field_diff: tuple[FieldDiff, ...]  # empty for non-Update actions
```

**Why `tuple` not `list`:** Per `DesiredState` precedent (`desired.py` line 26) — `tuple` prevents accidental append on frozen Pydantic models.

---

### `src/godoo_stateman/live/livestate.py` (service — request-response)

**Analog:** `src/godoo_stateman/identity.py` (lines 51–79)

**Imports pattern** (copy from `identity.py` lines 24–32):
```python
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from godoo.client.client import OdooClient
```

**Async function pattern** (from `identity.py` lines 51–79):
```python
async def find_by_xmlid(
    client: OdooClient,
    module: str,
    name: str,
) -> XmlIdRecord | None:
    records = await client.search_read(
        "ir.model.data",
        [("module", "=", module), ("name", "=", name)],
        fields=["id", "res_id", "model"],
        limit=1,
    )
    if not records:
        return None
    r = records[0]
    return XmlIdRecord(...)
```

**Core pattern for LiveState.fetch()** (extend the `search_read` pattern from `identity.py`):
```python
# Step 1: managed-set scan (from RESEARCH.md Pattern 1)
managed_rows = await client.search_read(
    "ir.model.data",
    [("module", "=", xmlid_prefix)],
    fields=["name", "model", "res_id"],
    order="name",  # deterministic
)
# Step 2: group by model, one search_read per model (batch-fetch, not N+1)
# fields projection: only ResourceNode.fields keys (+ "id") — never omit fields=
live_records = await client.search_read(
    model,
    [("id", "in", res_ids_for_model)],
    fields=["id"] + sorted(desired_fields_for_model),
    order="id",  # deterministic
)
```

**Error handling pattern:** Raise `LiveStateFetchError` (from `errors.py`, same pattern as all `StatemanError` subclasses) when invariants are violated.

---

### `src/godoo_stateman/live/seam.py` (service — request-response)

**Analog:** `src/godoo_stateman/identity.py` (full file, async `search_read` pattern)

**Imports pattern** (identical `TYPE_CHECKING` guard from `identity.py` lines 24–32):
```python
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from godoo_stateman.errors import LiveStateFetchError

if TYPE_CHECKING:
    from godoo.client.client import OdooClient
    from godoo_stateman.dsl.types.nodes import DataSourceNode
```

**Core seam resolution pattern** (from RESEARCH.md Pattern 4, built on `identity.py` `search_read` idiom):
```python
async def resolve_data_sources(
    client: OdooClient,
    data_sources: tuple[DataSourceNode, ...],
) -> dict[str, int]:
    """Return node_key -> res_id for all data sources. (REL-03)"""
    result: dict[str, int] = {}
    for ds in data_sources:
        domain = [(k, "=", v) for k, v in sorted(ds.selector.items())]
        records = await client.search_read(ds.model, domain, fields=["id"], limit=2)
        if len(records) != 1:
            raise LiveStateFetchError(
                f"DataSource {ds.node_key!r}: expected 1 record, got {len(records)} "
                f"(model={ds.model!r}, selector={ds.selector!r})"
            )
        result[ds.node_key] = int(records[0]["id"])
    return result
```

**Deferred resolution pattern** (from RESEARCH.md Pattern 4 + `deferred.py` source):
```python
import dataclasses
from godoo_stateman.dsl.types.deferred import Deferred
from godoo_stateman.dsl.types.nodes import ResourceNode

def resolve_deferred(
    resource: ResourceNode,
    seam_result: dict[str, int],
) -> ResourceNode:
    """Return new ResourceNode with Deferred fields fired. (Pitfall 7 — no mutation)"""
    resolved: dict[str, Any] = {}
    for fname, fval in resource.fields.items():
        if isinstance(fval, Deferred):
            resolved_args = [seam_result[dep] for dep in sorted(fval.deps)]
            resolved[fname] = fval.fn(*resolved_args)
        else:
            resolved[fname] = fval
    return dataclasses.replace(resource, fields=resolved)
```

**Key constraint:** Never mutate `ResourceNode.fields` in place (Pitfall 7). Use `dataclasses.replace()` — same pattern as `normalize.py` line 110.

---

### `src/godoo_stateman/diff.py` (service — transform)

**Analog:** `src/godoo_stateman/dsl/normalize.py` (full file — same pure-function pipeline stage pattern)

**Imports pattern** (from `normalize.py` lines 18–28):
```python
from __future__ import annotations

import dataclasses
from typing import Any

from godoo_stateman.dsl.types.desired import DesiredState
from godoo_stateman.dsl.types.nodes import ResourceNode
from godoo_stateman.schema.snapshot import VersionedSnapshot
```

**Stage function signature pattern** (from `normalize.py` line 77):
```python
# normalize() takes (state, snapshot) → DesiredState
# diff() analogously takes (state, live_state, seam_result, registry) → list[PlanStep]
def normalize(state: DesiredState, snapshot: VersionedSnapshot | None) -> DesiredState:
```

**Live-value normalization** — import `_normalize_value` from `dsl.normalize` (not a new function). Per RESEARCH.md Pattern 3, diff must call:
```python
from godoo_stateman.dsl.normalize import _normalize_value

# For every live field before comparison:
normalized_live = _normalize_value(live_value, field_schema.ttype)
```

**Non-stored field skip** (from RESEARCH.md Pitfall 2, using `registry.py` pattern):
```python
# Skip fields where store=False or readonly=True — cannot be written, skip diff
field_schema = model_schema.fields.get(fname)
if field_schema is None or not field_schema.store or field_schema.readonly:
    continue
```

**Diff classification pattern** (from RESEARCH.md Pattern 2):
```python
# effective_prefix follows Pitfall 3 fix:
effective_prefix = resource.xmlid_module or state.xmlid_prefix
record = live_state.find(effective_prefix, resource.slug)
# record is XmlIdRecord | None

if record is None:
    return PlanAction.CREATE          # D-01: no natural-identity probing

if record.model != resource.model:
    return PlanAction.REJECT          # D-02: xmlid-namespace collision only

# Compare fields → NoOp | Update
# Delete/Archive: managed set minus desired set; Archive iff model.archivable
```

---

### `src/godoo_stateman/plan/render.py` (utility — UI)

**Analog:** `src/godoo_stateman/cli/commands/plan.py` stub (lines 8–9, Rich Console pattern)

**Imports pattern** (from stub `plan.py` lines 1–10):
```python
from __future__ import annotations

from rich.console import Console
from rich.text import Text
```

**Console pattern** (from stub `plan.py` line 18, extended per D-09):
```python
# Stub uses Console() — Phase 3 must use Console(force_terminal=False) for D-09
# Rich strips ANSI automatically when not a TTY with this flag
console = Console(force_terminal=False)
```

**Action symbols** (from RESEARCH.md Pattern 6 — planner/implementor fills archive/noop symbols):
```python
ACTION_SYMBOLS: dict[PlanAction, str] = {
    PlanAction.CREATE:  "+",
    PlanAction.UPDATE:  "~",
    PlanAction.DELETE:  "-",
    PlanAction.REJECT:  "x",
    PlanAction.ARCHIVE: "a",   # symbol TBD by implementor
    PlanAction.NOOP:    "=",   # symbol TBD by implementor
}
```

**Topological order with slug tie-breaking** (from RESEARCH.md Pattern 6 + `graph.py` lines 49–122):
```python
import networkx as nx

# Use topological_generations for D-08 tie-breaking
# (verify nx.topological_generations exists; fallback: custom stable sort)
for generation in nx.topological_generations(graph):
    for slug in sorted(generation):   # slug sort within generation = tie-break
        step = plan_steps_by_slug[slug]
        ...
```

**D-07 NoOp suppression:**
```python
noop_count = sum(1 for s in plan_steps if s.action == PlanAction.NOOP)
# Only emit noop steps when --verbose; always show trailing summary:
console.print(f"  {noop_count} resources unchanged")
```

**Update field diff lines** (D-06: plain `field: old → new`, not `rich.syntax.Syntax("diff")`):
```python
for fd in step.field_diff:
    console.print(f"    {fd.field_name}: {fd.old_value!r} → {fd.new_value!r}")
```

---

### `src/godoo_stateman/cli/commands/plan.py` (controller — request-response)

**Analog:** `src/godoo_stateman/cli/commands/apply.py` (lines 1–14, stub pattern to extend)

**Imports pattern** (from stub `plan.py` lines 1–12):
```python
from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console

from godoo_stateman.dsl.eval import eval_config
from godoo_stateman.errors import DslEvalError
```

**Typer command pattern** (from stub `plan.py` lines 14–32):
```python
def plan(
    config: Path = typer.Argument(..., help="Path to stateman config .py file"),
) -> None:
    """..."""
    console = Console()
    try:
        state = eval_config(config)
    except DslEvalError as exc:
        console.print(f"[red]Error evaluating config: {exc}[/red]")
        raise typer.Exit(code=1) from exc
    ...
    raise typer.Exit(code=0)
```

**Async `_impl` + `asyncio.run()` wrapper pattern** (established convention from RESEARCH.md "Established Patterns" — no anyio, no async-typer):
```python
import asyncio

async def _plan_impl(config: Path, ...) -> int:
    """Async implementation — returns exit code."""
    async with OdooClient(cfg) as client:
        ...
    return exit_code   # 0 = all NoOp, 2 = changes pending (D-18), 1 = error

def plan(
    config: Path = typer.Argument(...),
    ...
) -> None:
    """Plan command — synchronous Typer entry point."""
    exit_code = asyncio.run(_plan_impl(config, ...))
    raise typer.Exit(code=exit_code)
```

**Exit code contract** (from RESEARCH.md Pitfall 6, Phase 1 D-18):
- `0` = all NoOp (no changes pending)
- `2` = any Create / Update / Delete / Archive / Reject in plan (changes pending)
- `1` = error (exception raised)

---

### `src/godoo_stateman/cli/commands/import_.py` (controller — request-response)

**Analog:** `src/godoo_stateman/cli/commands/apply.py` (full stub, same pattern)

**Imports pattern** (same as `plan.py` + identity imports):
```python
from __future__ import annotations

import asyncio

import typer
from rich.console import Console

from godoo_stateman.identity import find_by_xmlid, write_xmlid
from godoo_stateman.errors import StatemanError
```

**Typer command with options pattern** (D-10 signature from RESEARCH.md):
```python
def import_(
    model: str = typer.Option(..., help="Odoo model name (e.g. res.partner)"),
    id: int = typer.Option(..., help="Record ID to import"),
    module: str = typer.Option(..., help="xmlid prefix (module segment)"),
    name: str = typer.Option(..., help="xmlid name (slug segment)"),
    force: bool = typer.Option(False, "--force", help="Overwrite existing xmlid binding"),
) -> None:
    """Import an existing Odoo record into stateman managed state."""
    exit_code = asyncio.run(_import_impl(model, id, module, name, force))
    raise typer.Exit(code=exit_code)
```

**Async impl with validate-before-write pattern** (D-11 flow):
```python
async def _import_impl(
    model: str, record_id: int, module: str, name: str, force: bool
) -> int:
    async with OdooClient(cfg) as client:
        # Step 1: confirm record exists (validate-before-write)
        records = await client.search_read(model, [("id", "=", record_id)], fields=["id"], limit=1)
        if not records:
            console.print(f"[red]Record {model}:{record_id} not found in Odoo[/red]")
            return 1

        # Step 2: check existing xmlid binding
        existing = await find_by_xmlid(client, module, name)
        if existing is not None:
            if existing.res_id == record_id:
                console.print(f"[dim]Already managed: {module}.{name} → {model}:{record_id}[/dim]")
                return 0                          # idempotent no-op (IDENT-05)
            if not force:
                console.print(f"[red]xmlid {module}.{name} already bound to {existing.model}:{existing.res_id}. Use --force.[/red]")
                return 1

        # Step 3: write xmlid
        await write_xmlid(client, model, record_id, module, name)
        console.print(f"[green]+[/green] Imported: {module}.{name} → {model}:{record_id}")
        return 0
```

---

## Test Patterns

### `tests/unit/test_diff.py` (unit — offline)

**Analog:** `tests/unit/test_schema_registry.py` (full file — closest to an offline unit test with fixture injection)

**Module header pattern** (from `test_schema_registry.py` lines 1–22):
```python
"""Unit tests for diff.py — classify Create/Update/NoOp/Delete/Archive/Reject.

All tests use injected fixture objects — no Docker required.
asyncio_mode = "auto" in pyproject.toml means no @pytest.mark.asyncio decorator is needed.

Covers: CORE-03, SAFE-03, REL-04
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from godoo_stateman.diff import diff
from godoo_stateman.plan.types import PlanAction
```

**Fixture helper pattern** (from `test_schema_registry.py` lines 28–104 — `_make_*` helper functions):
```python
def _make_minimal_snapshot(...) -> VersionedSnapshot:
    ...  # inject controlled schema with known ttypes
```

**Top-level async test function** (from `test_schema_registry.py` lines 314–347 — no class, no decorator):
```python
async def test_registry_get_wraps_model_schema() -> None:
    """..."""
    mock_client = MagicMock()
    mock_introspector = MagicMock()
    mock_introspector.get_schema = AsyncMock(return_value=raw_schema)
    ...
```

**AsyncMock pattern** (from `test_identity.py` lines 32–51):
```python
def _make_client(
    *,
    search_read_return: list[list[dict]] | None = None,
) -> AsyncMock:
    client = AsyncMock()
    if search_read_return is None:
        client.search_read.return_value = []
    elif len(search_read_return) == 1:
        client.search_read.return_value = search_read_return[0]
    else:
        client.search_read.side_effect = search_read_return
    return client
```

---

### `tests/unit/test_seam.py` (unit — offline)

**Analog:** `tests/unit/test_identity.py` (closest — same async helper pattern, AsyncMock for OdooClient)

**Key test cases** (from RESEARCH.md Validation Architecture):
- `test_datasource_resolves_to_id` — happy path, `search_read` returns 1 record
- `test_datasource_zero_records_raises` — Pitfall 5: `len == 0` → `LiveStateFetchError`
- `test_datasource_two_records_raises` — Pitfall 5: `len == 2` → `LiveStateFetchError`
- `test_deferred_fires_with_resolved_args` — `Deferred.fn` called with correct args

---

### `tests/unit/test_plan_render.py` (unit — offline)

**Analog:** `tests/unit/test_schema_registry.py` (module-level structure)

**Rich output capture pattern** (from RESEARCH.md Validation Architecture):
```python
import io
from rich.console import Console

def _capture_render(plan_steps, graph, *, verbose: bool = False) -> str:
    """Capture render_plan() output as plain string (non-TTY)."""
    buf = io.StringIO()
    console = Console(file=buf, force_terminal=False)
    render_plan(plan_steps, graph, console, verbose=verbose)
    return buf.getvalue()
```

**Key test cases:**
- `test_non_tty_output` — UX-05: no ANSI codes in output when `force_terminal=False`
- `test_noop_hidden_by_default` — D-07: NoOp steps absent from output; trailing summary present
- `test_noop_shown_with_verbose` — D-07 verbose path
- `test_update_shows_field_diff` — D-06: `field: old → new` lines for Update
- `test_deterministic_order` — SC-2 / D-08: same steps always emit same order

---

### `tests/unit/test_plan_command.py` (unit — offline)

**Analog:** `tests/unit/test_cli_help.py` (CLI command registration test)

**Key test cases:**
- `test_plan_exit_code_zero_on_all_noop` — UX-02: exit 0 when no changes
- `test_plan_exit_code_two_on_changes` — UX-02: exit 2 when any Create/Update/etc.
- `test_plan_exit_code_one_on_error` — UX-02: exit 1 on exception

---

### `tests/acceptance/test_plan_import.py` (integration — Docker)

**Analog:** `tests/acceptance/test_snapshot.py` (full file — exact same pattern)

**Module header pattern** (from `test_snapshot.py` lines 1–19):
```python
"""Acceptance tests for the plan and import pipeline against real Odoo 17.

All tests require Docker (session-scoped ``odoo`` fixture in conftest.py).
Skip when Docker unavailable:
    uv run pytest -m "not integration" -q

Run only:
    uv run pytest -m integration -q

Requirements covered:
- IDENT-01/02/04/05: state in ir.model.data; determinism; import round-trip
- META-01: plan lists all managed resources
"""

from __future__ import annotations

import pytest

from godoo_stateman.identity import find_by_xmlid
from godoo_stateman.schema.registry import SchemaRegistry
from godoo_stateman.schema.version import OdooVersion
```

**Session fixture usage pattern** (from `test_snapshot.py` lines 36–46):
```python
@pytest.mark.integration
async def test_plan_creates_on_new_resource(odoo: object) -> None:
    """..."""
    client = odoo.client  # type: ignore[attr-defined]
    registry = SchemaRegistry(client, OdooVersion(17, 0))
    ...
```

**Base models to use** (from RESEARCH.md Validation Architecture + project memory):
- `res.partner` — name, email, active (archivable), country_id (m2o)
- `res.country` — stable data source for m2o tests
- `res.lang` — stable data source for selector tests
- Do NOT use `project.project`, `project.task.type`

---

## Shared Patterns

### `from __future__ import annotations` + `TYPE_CHECKING`
**Source:** All existing source files (`identity.py` line 24, `normalize.py` line 18, `graph.py` line 40, `registry.py` line 1, etc.)
**Apply to:** Every new `.py` source file in this phase.
```python
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from godoo.client.client import OdooClient   # heavy import; guard behind TYPE_CHECKING
```

### Frozen Pydantic v2 Model
**Source:** `src/godoo_stateman/types/schema.py` lines 14–23; `src/godoo_stateman/dsl/types/desired.py` lines 10–23
**Apply to:** `plan/types.py` (`PlanStep`, `FieldDiff`)
```python
from pydantic import BaseModel, ConfigDict

class SomeModel(BaseModel):
    model_config = ConfigDict(frozen=True)
    # use tuple[T, ...] not list[T] for ordered frozen collections
```

### Frozen dataclass for value objects
**Source:** `src/godoo_stateman/identity.py` lines 35–48; `src/godoo_stateman/dsl/types/nodes.py` lines 9–29
**Apply to:** Any pure value object in `live/` that does not need Pydantic serialization.
```python
from dataclasses import dataclass

@dataclass(frozen=True)
class SomeValueObject:
    field_a: str
    field_b: int
```

### `dataclasses.replace()` for frozen-node mutation
**Source:** `src/godoo_stateman/dsl/normalize.py` line 110
**Apply to:** `live/seam.py` deferred resolution; any place that needs a new `ResourceNode` with modified `fields`.
```python
import dataclasses
new_node = dataclasses.replace(resource, fields=new_fields_dict)
```

### Async `_impl` + `asyncio.run()` Typer wrapper
**Source:** RESEARCH.md "Established Patterns" section; demonstrated by stub command pattern in `apply.py`/`plan.py` (stubs do not yet have it — this pattern is the Phase 3 convention to adopt).
**Apply to:** `cli/commands/plan.py` and `cli/commands/import_.py`.
```python
import asyncio

async def _plan_impl(...) -> int:
    async with OdooClient(cfg) as client:
        ...
    return exit_code

def plan(...) -> None:
    exit_code = asyncio.run(_plan_impl(...))
    raise typer.Exit(code=exit_code)
```
**Never use:** anyio, async-typer (rejected in CLAUDE.md tech stack).

### Error hierarchy: always subclass `StatemanError`
**Source:** `src/godoo_stateman/errors.py` lines 7–39
**Apply to:** `XmlidCollisionError`, `LiveStateFetchError` (new errors this phase)
```python
class NewError(StatemanError):
    """One-line docstring describing when this is raised."""
    def __init__(self, message: str) -> None:
        super().__init__(message)
```

### `search_read` — always use `fields=` projection + `order=` for determinism
**Source:** `src/godoo_stateman/identity.py` lines 64–69
**Apply to:** All `client.search_read` calls in `live/livestate.py`, `live/seam.py`, `cli/commands/import_.py`.
```python
records = await client.search_read(
    "ir.model.data",
    [("module", "=", module), ("name", "=", name)],
    fields=["id", "res_id", "model"],  # always explicit; never omit
    limit=1,
)
```

### `@pytest.mark.integration` for Docker tests
**Source:** `tests/acceptance/test_snapshot.py` lines 36, 60, 77, 107, 134
**Apply to:** All tests in `tests/acceptance/test_plan_import.py`.
```python
@pytest.mark.integration
async def test_some_live_odoo_behavior(odoo: object) -> None:
    client = odoo.client  # type: ignore[attr-defined]
    ...
```

### Unit tests: top-level functions, no class, no `@pytest.mark.asyncio`
**Source:** `tests/unit/test_schema_registry.py` lines 112–400; `tests/unit/test_identity.py`
**Apply to:** All unit test files this phase.
```python
# asyncio_mode = "auto" is set in pyproject.toml — no decorator needed
async def test_some_async_behavior() -> None:
    """One-line description of what is verified."""
    ...

def test_some_sync_behavior() -> None:
    """..."""
    ...
```

---

## No Analog Found

All files have analogs. No entries.

---

## Metadata

**Analog search scope:** `src/godoo_stateman/`, `tests/`
**Files scanned:** 14 existing source files, 5 existing test files
**Pattern extraction date:** 2026-05-27
