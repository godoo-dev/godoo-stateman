# Phase 4: Apply (core actions) — VAL-01 gate - Pattern Map

**Mapped:** 2026-06-04
**Files analyzed:** 16 (8 net-new, 8 modified)
**Analogs found:** 16 / 16 (every new/modified file has a real Phase 1–3 analog in `src/`)

All analog files were confirmed to exist in the current tree (not just cited by research). All excerpts below are from real source read this session. Apply is ~90% wiring existing parts; the patterns here exist to be copied verbatim, not reinvented.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/godoo_stateman/cli/commands/apply.py` (replace stub) | controller (CLI) | request-response | `src/godoo_stateman/cli/commands/plan.py` + `cli/commands/import_.py` | exact (both) |
| `src/godoo_stateman/apply/executor.py` (new) | service | event-driven (step loop) | `src/godoo_stateman/cli/commands/plan.py` `_plan_impl` (pipeline) + `diff.py` (dispatch-on-action) | role+flow match |
| `src/godoo_stateman/apply/serialize.py` (new) | utility (transform) | transform | `src/godoo_stateman/dsl/normalize.py` `_normalize_value` (type-keyed field transform) | role+flow match |
| `src/godoo_stateman/apply/state.py` → `GlobalLiveState` (new) | model/store (mutable) | event-driven | `src/godoo_stateman/live/livestate.py` `LiveState` (the read-only foundation it seeds from) | role match (mutable vs frozen) |
| `src/godoo_stateman/plan/types.py` (extend `PlanStep`) | model | — | itself (`PlanStep`, `FieldDiff` frozen Pydantic) | exact |
| `src/godoo_stateman/dsl/types/nodes.py` (add `options` to `ResourceNode`) | model | — | itself (`ResourceNode` frozen dataclass) | exact |
| `ResourceOptions` Pydantic model (new — likely in `dsl/types/nodes.py` or new `dsl/types/options.py`) | model | — | `src/godoo_stateman/plan/types.py` `FieldDiff` (frozen Pydantic value object) | role match |
| `src/godoo_stateman/dsl/context.py` (consume `_options=`) | utility (DSL proxy) | transform | itself — `_ResourceBuilder` / `_ModelResourceCallable` (`_module=` handling is the pattern reference per CONTEXT) | exact |
| `src/godoo_stateman/errors.py` (add `ApplyError` + 3 subclasses) | config (error hierarchy) | — | itself (`StatemanError` subclasses) | exact |
| `src/godoo_stateman/cli/app.py` (already wires `apply`) | config (CLI) | — | itself | exact (no change needed) |
| `tests/acceptance/test_apply.py` (new) | test (acceptance) | request-response | `tests/acceptance/test_plan_import.py` | exact |
| `tests/acceptance/fixtures/val01/01-initial.py`, `02-mid-lifecycle.py` (new) | test fixture (DSL config) | — | the DSL surface in `dsl/context.py` (`resource.x(...)`) | role match |
| Phase-4 session fixture (`project` module install) | test (conftest) | — | `tests/conftest.py` `odoo` fixture (`TestHarness(snapshot=True)`) | exact |
| `tests/unit/test_serialize.py`, `test_executor_order.py`, `test_delete_behavior.py`, `test_options_dsl.py`, `test_partial_progress.py`, `test_apply_cli.py`, `test_apply_exit_codes.py`, `test_apply_progress.py`, `test_apply_errors.py` (new) | test (unit) | — | `tests/unit/test_diff.py` (`_make_snapshot`/`_make_versioned_field` builders) + `tests/acceptance/test_plan_import.py` (`_run_pipeline`) | exact / role match |

---

## Pattern Assignments

### `src/godoo_stateman/cli/commands/apply.py` (controller, request-response)

**Analogs:** `plan.py` (pipeline + exit-code + env-read), `import_.py` (mutation command shape).

**Async `_impl` + sync Typer wrapper** — copy from `plan.py:47-54, 168-192` and `import_.py:44-56, 171-172`:
```python
async def _apply_impl(config: Path, auto_approve: bool, verbose: bool) -> int:
    console = Console(force_terminal=False)
    ...
def apply(
    config: Path = typer.Argument(..., exists=True, file_okay=True, dir_okay=False, readable=True),
    auto_approve: bool = typer.Option(False, "--auto-approve", help="..."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="..."),
) -> None:
    exit_code = asyncio.run(_apply_impl(config, auto_approve, verbose))
    raise typer.Exit(code=exit_code)
```

**GODOO_* env-read block (T-03-10, ASVS V2)** — copy verbatim from `plan.py:64-81` (identical block also at `import_.py:57-73`). This is exactly the D-04 "rule of three" extraction target:
```python
missing: list[str] = []
url = os.environ.get("GODOO_URL", "")
db = os.environ.get("GODOO_DB", "")
user = os.environ.get("GODOO_USER", "")
password = os.environ.get("GODOO_PASSWORD", "")
if not url: missing.append("GODOO_URL")
# ... db, user, password ...
if missing:
    console.print(f"[red]Missing required environment variable(s): {', '.join(missing)}[/red]")
    return 1
```
> **D-04:** extract this + the `OdooClient(OdooClientConfig(...))` construction + the `ODOO_VERSION` regex-validate (`plan.py:88-92`) into one shared helper, then refactor `plan.py` and `import_.py` to consume it. Keep the helper signature returning `(client_cm, registry, console)` or similar — planner's call.

**Client lifecycle + pipeline reuse** — copy `plan.py:83-150` (steps 3–12) to obtain `plan_steps` and `graph`, then hand them to the executor. Apply MUST NOT re-call `diff()` after the executor starts (Pitfall 4 in research):
```python
async with OdooClient(OdooClientConfig(url=url, database=db, username=user, password=password)) as client:
    ... # steps 3-12 from plan.py verbatim → plan_steps = diff(state, live_state, snapshot)
    render_plan(plan_steps, graph, console, verbose=verbose)
    # NEW: confirmation prompt (R8) → executor.run(...) → exit code (R12)
```

**Exit-code contract pattern** — `plan.py:155-158, 191-192` returns an int from `_impl` then `raise typer.Exit(code=...)`. Apply extends the same shape to codes 0/1/3/4/5 (R12). The error funnel at `plan.py:160-165` / `import_.py:114-123` is the template for code 1:
```python
except (StatemanError, LiveStateFetchError) as exc:
    console.print(f"[red]{exc}[/red]")
    return 1
except Exception as exc:
    console.print(f"[red]Unexpected error: {exc}[/red]")
    return 1
```

**Confirmation prompt (R8/SAFE-04):** no existing analog — net-new. Use Typer/Rich (`typer.confirm` or `Console` + stdin). All-NoOp short-circuit: reuse the `any(s.action != PlanAction.NOOP for s in plan_steps)` check from `plan.py:157`.

---

### `src/godoo_stateman/apply/executor.py` (service, event-driven step loop)

**Analog:** `plan.py` `_plan_impl` (orchestration shape) + `diff.py` (dispatch-on-`PlanAction`) + `render.py` (the exact ordering to reuse).

**Dispatch-on-action pattern** — mirror `diff.py:84-195`'s pass structure and `render.py`'s action-keyed dicts. The executor dispatches each step by `step.action` (see research "Executor dispatch skeleton", lines 236-265). NoOp/Reject → no Odoo call (Pitfall 5):
```python
if step.action is PlanAction.NOOP or step.action is PlanAction.REJECT:
    return None
if step.action is PlanAction.CREATE:
    payload = serialize_fields(...)
    new_id = await client.create(step.model, payload)   # client.py: create -> int
    gls[step.slug] = new_id                              # register BEFORE next step (REL-05)
    await write_xmlid(client, step.model, new_id, module, name)   # identity.py — reuse
```

**Execution ordering (R2, CORE-05, REL-08)** — DO NOT hand-roll. Reuse `render.py:91-128`'s exact traversal: `nx.topological_generations(graph)` with `sorted(generation)`, then the second loop for graph-less Delete/Archive/Reject steps (`render.py:122-142`). Within a generation, order Creates→Updates→Deletes/Archives then slug. The plan list from `diff.py` already orders Pass-2 (Delete/Archive) by complete xmlid (`diff.py:176-178`).

**xmlid binding after create** — reuse `identity.write_xmlid` (`identity.py:82-135`) verbatim; it is the idempotent upsert. The CREATE branch must split `step.xmlid` ("prefix.slug") into `(module, name)` — note `write_xmlid(client, model, res_id, module, name)` arg order.

**Archive preflight (R6/R13/SAFE-02)** — call `(await registry.get(step.model)).archivable` BEFORE any `client.*` for the step (`registry.py:39-52` derives `archivable`). Raise `ArchiveNotSupportedError` with zero RPC issued (Pitfall 3):
```python
if step.action is PlanAction.ARCHIVE:
    if not (await registry.get(step.model)).archivable:
        raise ArchiveNotSupportedError(model=step.model, slug=step.slug)
    await client.write(step.model, [step.res_id], {"active": False})
```

**Stop-on-first-failure (R9)** — wrap each step in `try/except Exception`, re-raise as `ApplyStepError(slug, action, cause)`, record status, mark remaining steps `skipped`. The Odoo error surface to catch is the broad base; `str(exc)` yields `.human_message` (research §"Error surface", `client/errors.py`).

**Progress (R10)** — `[N/total] <action> <model> <slug> … <status>` via Rich `Console`. Reuse the `ACTION_SYMBOLS`/`ACTION_STYLES` dicts from `render.py:39-55` for consistency; `Console(force_terminal=False)` strips ANSI on non-tty (`render.py` D-09 note).

**`async def` + `from __future__ import annotations` + `TYPE_CHECKING`** for `OdooClient` import — pattern from `livestate.py:20-28`, `registry.py:8-18`.

---

### `src/godoo_stateman/apply/serialize.py` (utility, transform)

**Analog:** `dsl/normalize.py` `_normalize_value` (type-keyed transform — same shape: switch on `ttype`, transform value). Research §"m2m serialization seam" lines 268-281.

**Schema access path** (confirmed against real types): `snapshot.models[model].fields[name].ttype` — `VersionedSnapshot.models: dict[str, VersionedModelSchema]` (`snapshot.py:32`), `VersionedModelSchema.fields: dict[str, VersionedFieldSchema]` (`schema.py:47`), `VersionedFieldSchema.ttype: str` (`schema.py:26`). `ttype == "many2many"` is the m2m discriminator.

```python
def serialize_fields(model_schema, fields, gls) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name, value in fields.items():
        ttype = model_schema.fields[name].ttype
        if ttype == "many2many":
            ids = [gls[v] if isinstance(v, str) else int(v) for v in value]
            out[name] = [(6, 0, ids)]   # SET — idempotent (REL-06); empty → [(6, 0, [])]
        else:
            out[name] = value           # m2o int / char / bool pass-through (verify A1)
    return out
```
> Isolated for unit-testability without Odoo (R4 acceptance asserts shape in isolation) — same "pure transform, no I/O" discipline as `diff.py` and `normalize.py`. Scalar mapping beyond m2m is Claude's-discretion; pin via live round-trip (A1).

---

### `src/godoo_stateman/apply/state.py` → `GlobalLiveState` (model/store, mutable)

**Analog:** `live/livestate.py` `LiveState` — the read-only frozen foundation it seeds from. `GlobalLiveState` is a SEPARATE mutable object; NEVER mutate the frozen `LiveState` (Pitfall 1 → `FrozenInstanceError`).

**Shape (locked D-02/R3):** `dict[str, int]` keyed by `ResourceNode.slug`. Seed from BOTH:
1. `LiveState.managed` values → `XmlIdRecord.res_id` (`livestate.py:44`, `identity.py:36-48` for `XmlIdRecord` shape: `.res_id: int`).
2. `seam_result` (data-source ids, `dict[node_key → int]` from `resolve_data_sources`, see `plan.py:136`).

Then `gls[slug] = new_res_id` after each successful CREATE, before the next step. A thin `dataclass`-with-`dict` wrapper or a bare dict — planner's call; keep it the executor's only cross-step state.

---

### `src/godoo_stateman/plan/types.py` (model — extend `PlanStep`)

**Analog:** itself. `PlanStep` is frozen Pydantic (`plan/types.py:60-77`). Extend in place per D-03:
```python
class PlanStep(BaseModel):
    model_config = ConfigDict(frozen=True)
    action: PlanAction
    slug: str
    model: str
    xmlid: str
    res_id: int | None
    field_diff: tuple[FieldDiff, ...]
    # NEW (D-03): carry delete_behavior so executor needs no DesiredState back-ref.
    delete_behavior: Literal["delete", "archive", "reject"] = "reject"
    # NEW (Open Q1): CREATE needs full desired dict (field_diff is UPDATE-only).
    #   Option A (recommended): desired_fields: dict[str, Any] | None = None
    #   — keeps executor DesiredState-free, single source of truth.
```
> **Coordinate two D-03 extensions + Open-Q1** here. `diff.py:96-105` (CREATE) and `diff.py:160-169` (UPDATE/NOOP) and `diff.py:186-195` (DELETE/ARCHIVE) all construct `PlanStep` — every construction site must pass the new fields (default-valued so existing tests stay green, but `diff()` must populate `delete_behavior` from `resource.options.delete_behavior` and the full desired dict for CREATE).
> **Caution:** Pydantic `frozen=True` + a `dict[str, Any]` field is fine for storage, but `dict` is unhashable — `PlanStep` is not currently used as a set/dict key, so this is safe. If `desired_fields` must be hashable, planner converts to a frozen mapping.

---

### `src/godoo_stateman/dsl/types/nodes.py` (model — add `options` to `ResourceNode`)

**Analog:** itself. `ResourceNode` is a frozen dataclass (`nodes.py:9-29`) with `model`, `slug`, `fields`, `xmlid_module`, `parent_slug`. Add `options` following the same default-valued field pattern as `xmlid_module: str | None = None`:
```python
@dataclass(frozen=True)
class ResourceNode:
    model: str
    slug: str
    fields: dict[str, Any]
    xmlid_module: str | None = None
    parent_slug: str | None = None
    options: ResourceOptions = field(default_factory=ResourceOptions)   # NEW (R5)
```
> **Claude's-discretion (CONTEXT):** `ResourceNode` is a frozen *dataclass* while `ResourceOptions` is Pydantic. A `default_factory` is required (mutable-default rule). `ResourceOptions` must be frozen/hashable if `ResourceNode` is ever hashed — `ResourceNode` is currently used in tuples/lists (`DesiredState.resources: tuple[...]`) and `_node` refs, not as a dict key, so hashability is not strictly required, but frozen Pydantic gives it for free. Match `desired.py:23` `arbitrary_types_allowed=True` consideration if `ResourceOptions` ends up inside a Pydantic model.

---

### `ResourceOptions` Pydantic model (new value object)

**Analog:** `plan/types.py` `FieldDiff` — minimal frozen Pydantic value object:
```python
class ResourceOptions(BaseModel):
    model_config = ConfigDict(frozen=True)
    delete_behavior: Literal["delete", "archive", "reject"] = "reject"
```
> Design must not preclude per-resource-type subclasses (`ProjectResourceOptions`) — the `ResourceNode.options` field is typed as the base class (R5). Place in `dsl/types/nodes.py` (alongside `ResourceNode`) or a new `dsl/types/options.py` — planner's call.

---

### `src/godoo_stateman/dsl/context.py` (utility — consume `_options=`)

**Analog:** itself. CONTEXT names `_module=` handling as the pattern reference, but note: the CURRENT `context.py` does NOT yet handle `_module=` in `_ModelResourceCallable.__call__` (`context.py:107-109` only takes `slug, **fields`). The `xmlid_module` field exists on `ResourceNode` but is set elsewhere. The reserved-kwarg-strip pattern to mirror is the `_`-prefix guard in `_ResourceBuilder.__setattr__` (`context.py:79-86`) which already rejects underscore-prefixed field names.

Implement `_options=` consumption in `_ModelResourceCallable.__call__` — pop it from `**fields` before constructing `ResourceNode`, so it never lands in `fields`:
```python
def __call__(self, slug: str, **fields: Any) -> _ResourceBuilder:
    options = fields.pop("_options", ResourceOptions())   # strip reserved kwarg
    node = ResourceNode(model=self._model, slug=slug, fields=dict(fields), options=options)
    return _ResourceBuilder(node, self._collector)
```
> **R5 acceptance:** `resource.res_partner("p", _options=ResourceOptions(delete_behavior="archive"), name="X")` → `node.options.delete_behavior == "archive"` AND `"X"` still in `fields`. Default `"reject"` when `_options` omitted.

---

### `src/godoo_stateman/errors.py` (config — extend hierarchy)

**Analog:** itself. Every error follows the same `class X(Base): def __init__(self, message: str) -> None: super().__init__(message)` shape (`errors.py:14-60`). Add per R14 — but note `ApplyStepError` carries extra attrs (`slug`, `action`, `cause`), so its `__init__` diverges from the message-only template:
```python
class ApplyError(StatemanError):
    """Base for all apply-stage errors."""
    def __init__(self, message: str) -> None:
        super().__init__(message)

class ArchiveNotSupportedError(ApplyError):
    def __init__(self, *, model: str, slug: str) -> None:
        super().__init__(f"Model {model!r} is not archivable (no writable 'active' field); slug={slug!r}")

class DeleteRejectedError(ApplyError):
    def __init__(self, *, slug: str) -> None:
        super().__init__(f"delete_behavior='reject' for slug {slug!r}; no deletion performed")

class ApplyStepError(ApplyError):
    def __init__(self, *, slug: str, action: str, cause: Exception) -> None:
        self.slug, self.action, self.cause = slug, action, cause
        super().__init__(f"apply step failed: {action} {slug}: {cause}")
```
> All inherit `StatemanError` → caught by the existing `except (StatemanError, ...)` funnels in CLI commands. `mypy --strict` clean required (R14).

---

## Shared Patterns

### GODOO_* env-read + OdooClient construction (apply to: `apply.py`, refactor `plan.py` + `import_.py`)
**Source:** `plan.py:64-92` (env-read + ODOO_VERSION validate + client construction) — identical block at `import_.py:57-76`.
**D-04 (locked):** rule-of-three reached — extract a shared helper this phase. Single connection/credential surface. Never accept credentials from CLI args (ASVS V2 — process-listing leak).
```python
async with OdooClient(OdooClientConfig(url=url, database=db, username=user, password=password)) as client:
```

### Async `_impl` + sync Typer wrapper (apply to: `apply.py`)
**Source:** `plan.py:47/168-192`, `import_.py:44/126-172`.
**Pattern:** `async def _x_impl(...) -> int` returns an exit code; the sync Typer command does `raise typer.Exit(code=asyncio.run(_x_impl(...)))`. No `anyio`, no `async-typer`.

### Frozen Pydantic / frozen dataclass discipline (apply to: `PlanStep`, `ResourceOptions`, `ResourceNode`, `GlobalLiveState`)
**Source:** `plan/types.py` (`ConfigDict(frozen=True)`), `nodes.py` (`@dataclass(frozen=True)`), `desired.py:23` (`arbitrary_types_allowed=True` when fields hold callables).
**Rule:** serializable pipeline objects → frozen Pydantic; internal value objects → frozen dataclass. `GlobalLiveState` is the deliberate exception (mutable by design).

### Reuse, don't re-implement (apply to: `executor.py`)
**Sources:** `nx.topological_generations(graph)` (`render.py:92`), `identity.write_xmlid`/`find_by_xmlid` (`identity.py`), `SchemaRegistry.get(model).archivable` (`registry.py:50-52`), `(6,0,[ids])` SET tuple. All four are "Don't Hand-Roll" items from research.

### Test builders + integration harness (apply to: all new tests)
**Source (unit):** `tests/unit/test_diff.py:31-70` `_make_versioned_field` / `_make_snapshot` compact builders — reuse for `test_serialize.py`, `test_executor_order.py`, `test_delete_behavior.py`.
**Source (acceptance):** `tests/acceptance/test_plan_import.py` — `_run_pipeline` helper (`:122-169`), `_set_env_from_harness` (`:85-103`), `cleanup_xmlids` autouse fixture (`:66-82`), `@pytest.mark.integration` markers, `_step_for` helper.
**Source (conftest):** `tests/conftest.py:18-30` `odoo` fixture = `async with TestHarness(snapshot=True)`. Phase-4 `project`-module fixture mirrors this with `TestHarness(modules=["project"], snapshot=True)` (research recommendation: snapshot-cached, stays under 120s).
**VAL-01 lifecycle caution (Pitfall 6):** model the 5 subtests as ONE ordered lifecycle (or a sequenced `TestClass`) sharing a prefix — not 5 independent tests fighting over shared container state. Cleanup must unlink BOTH xmlid rows AND created project/stage records.

### VAL-01 fixture field discipline (apply to: `01-initial.py`, `02-mid-lifecycle.py`)
**Source:** DSL surface in `context.py` (`resource.project_project("...", name=...)`, `resource.project_task_type(...)` with `_options=...`). Use `name` + cross-version-stable scalars only. **VERIFY before locking (A2):** `client.fields_get("project.task.type")` on Odoo 17/18/19 to confirm the m2m field is `project_ids` (Pitfall 7 — field drift across versions, documented in PROJECT.md).

---

## No Analog Found

| File / Concern | Role | Data Flow | Reason |
|----------------|------|-----------|--------|
| SAFE-04 confirmation prompt (`apply.py`) | controller | request-response | No interactive stdin prompt exists anywhere in Phase 1–3 (all commands non-interactive). Use `typer.confirm` / Rich + stdin; net-new. |
| Stop-on-first-failure + partial-progress reporting (`executor.py`) | service | event-driven | No multi-step mutation loop exists yet (Phase 1–3 were read-only/pure). Reporting structure (committed/error/skipped) is net-new, though `ACTION_SYMBOLS` styling is reusable. |
| Mock/counting `OdooClient` wrapper (R7 idempotency) | test util | — | No mutation-counting test double exists. Net-new — wrap `OdooClient` and count create/write/unlink calls to assert zero on re-apply. |
| `project`-module session fixture | test (conftest) | — | The `odoo` fixture installs no modules. Net-new variant (`TestHarness(modules=["project"])`) — but structurally identical to the existing `odoo` fixture. |

---

## Metadata

**Analog search scope:** `src/godoo_stateman/**` (all 33 source modules listed), `tests/**` (acceptance + unit + conftest).
**Files scanned (read in full):** plan.py, apply.py (stub), plan/types.py, errors.py, dsl/types/nodes.py, dsl/context.py, live/livestate.py, schema/registry.py, plan/render.py, diff.py, identity.py, tests/conftest.py, tests/acceptance/test_plan_import.py, cli/commands/import_.py, dsl/types/desired.py, cli/app.py, types/schema.py, schema/snapshot.py, tests/unit/test_diff.py (head).
**Cross-checks confirmed:** schema access path `snapshot.models[m].fields[f].ttype` verified against `snapshot.py` + `schema.py`; `archivable` derivation verified at `registry.py:50-52`; `XmlIdRecord.res_id: int` verified at `identity.py:36-48`; `write_xmlid` arg order verified at `identity.py:82-88`.
**Pattern extraction date:** 2026-06-04

## PATTERN MAPPING COMPLETE

**Phase:** 4 - Apply (core actions) — VAL-01 gate
**Files classified:** 16 (8 net-new code/test groups + 8 modified existing)
**Analogs found:** 16 / 16

### Coverage
- Files with exact analog: 9 (apply.py, PlanStep, ResourceNode, context.py, errors.py, app.py, test_apply.py, project-fixture, unit-test builders)
- Files with role-match analog: 7 (executor.py, serialize.py, GlobalLiveState, ResourceOptions, fixtures)
- Files with no analog (net-new behavior): 4 concerns (SAFE-04 prompt, partial-progress reporting, mutation-counting client, are all listed)

### Key Patterns Identified
- Every CLI command is `async def _x_impl(...) -> int` returning an exit code, wrapped by a sync Typer command that does `raise typer.Exit(code=asyncio.run(...))`; credentials come from `GODOO_*` env only (D-04 extracts the shared block this phase).
- Pipeline objects are frozen Pydantic (`ConfigDict(frozen=True)`); internal value objects are frozen dataclasses; `GlobalLiveState` is the one deliberate mutable, seeded from (never mutating) the frozen `LiveState`.
- Execution ordering, xmlid binding, archivability, and m2m SET are all REUSE targets: `nx.topological_generations` (render.py), `identity.write_xmlid` (identity.py), `registry.get(m).archivable` (registry.py), `[(6,0,[ids])]` — no hand-rolling.
- Diff/serialize/normalize share one "pure type-keyed transform, no I/O" shape — `serialize.py` copies `_normalize_value`'s switch-on-`ttype` structure and is unit-testable without Odoo.

### File Created
`C:\dev\godoo-dev\godoo-stateman\.planning\phases\04-apply-core-actions-val01-gate\04-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can reference each analog by file:line in PLAN.md action sections. Two live-introspection gates (A1 scalar serialization, A2 `project_ids` field name) carry forward from CONTEXT/RESEARCH and must be resolved in the first VAL-01 plan task before fixtures lock.
