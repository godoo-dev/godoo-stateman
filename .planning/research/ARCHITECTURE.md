# Architecture Research

**Domain:** Python reconciliation engine + CLI (Terraform for Odoo)
**Researched:** 2026-05-23
**Confidence:** HIGH

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CLI Layer  (Typer)                                                      │
│  plan | apply | verify | import | snapshot                               │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ orchestrates pipeline
┌──────────────────────────────▼──────────────────────────────────────────┐
│  Engine  (godoo_stateman.engine)                                          │
│                                                                          │
│   config ──► normalize ──► graph ──► diff ──► plan ──► apply ──► verify │
│      │                       │                  │        │               │
│      │                       │                  │        │               │
│   DSL eval              DAG + cycle         LiveState  Executor          │
│   (pure Python,         detection           fetch      (sequential,      │
│   no Odoo calls)        mixed node types    (read seam) stop-on-fail)    │
└──────────┬────────────────────────────────────────┬────────────────────-┘
           │                                        │
┌──────────▼──────────┐              ┌──────────────▼──────────────────────┐
│  Schema Registry     │              │  godoo-py  (external dependency)    │
│  (version-keyed;     │              │  OdooClient (async, httpx)          │
│   per-model +        │              │  Introspector (ir.model / fields)   │
│   per-field snapshot)│              │  ModuleManager (install/upgrade)    │
└─────────────────────-┘              └─────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `cli/` | Typer entry points; parse args, build context, call engine, render output | engine, config |
| `dsl/` | Evaluate `.py` config file; build `DesiredState` tree; zero Odoo calls | types only |
| `schema/` | Fetch, cache, and persist per-version schema snapshots from godoo-py Introspector | godoo-py Introspector |
| `engine/normalize.py` | Canonicalize values and relation shapes; propagate xmlid metadata | dsl types, schema |
| `engine/graph.py` | Build dependency DAG; cycle detection; topo-sort over mixed node types | dsl types, networkx |
| `engine/diff.py` | Desired vs. LiveState; emit per-resource plan actions | types, LiveState |
| `engine/plan.py` | Serialize ordered steps; resolve data-source reads (read seam) | diff output, godoo-py |
| `engine/apply.py` | Execute steps over jsonrpc; maintain global LiveState; cancellation | plan output, godoo-py |
| `engine/verify.py` | Post-apply re-plan; touched-resource drift check | plan, diff |
| `live_state.py` | Global address→remote_id registry; populated as apply proceeds | apply, diff |
| `types/` | Pydantic models for all pipeline data structures | all stages |

---

## Recommended Project Structure

```
src/godoo_stateman/
├── cli/
│   ├── __init__.py
│   ├── app.py              # Typer app, subcommand registration
│   ├── commands/
│   │   ├── plan.py
│   │   ├── apply.py
│   │   ├── verify.py
│   │   ├── import_.py
│   │   └── snapshot.py
│   └── output.py           # Rich rendering, progress display
│
├── dsl/
│   ├── __init__.py
│   ├── context.py          # EvalContext — ResourceBuilder, DataBuilder
│   ├── eval.py             # load_config(path) → DesiredState (pure, no Odoo calls)
│   └── helpers.py          # odoo_module(), resolve() escape hatch
│
├── schema/
│   ├── __init__.py
│   ├── registry.py         # SchemaRegistry — version-keyed, fetch + cache
│   ├── snapshot.py         # VersionedSnapshot dataclass; JSON serialization
│   └── version.py          # OdooVersion type; seam definition
│
├── engine/
│   ├── __init__.py
│   ├── normalize.py        # Stage 2 — canonicalize values + xmlid propagation
│   ├── graph.py            # Stage 3 — DAG build + cycle detection
│   ├── diff.py             # Stage 4 — desired vs. live; emit PlanAction per resource
│   ├── plan.py             # Stage 5 — ordered steps + read-seam resolution
│   ├── apply.py            # Stage 6 — sequential executor; LiveState maintenance
│   └── verify.py           # Stage 7 — re-plan post-apply
│
├── types/
│   ├── __init__.py
│   ├── desired.py          # DesiredState, ResourceNode, DataSourceNode, InlineChild
│   ├── live.py             # LiveState, LiveRecord
│   ├── plan.py             # PlanStep, PlanAction (Create|Update|NoOp|Delete|Archive|Reject)
│   └── schema.py           # VersionedModelSchema, VersionedFieldSchema (stateman view)
│
├── live_state.py           # GlobalLiveState — address → remote_id resolver
├── errors.py               # Domain error hierarchy
└── __init__.py

tests/
├── unit/                   # Pure function tests; no Odoo
│   ├── test_dsl_eval.py
│   ├── test_normalize.py
│   ├── test_graph.py
│   ├── test_diff.py
│   └── test_live_state.py
├── integration/            # godoo-py mocked; real pipeline flow
│   ├── test_plan.py
│   └── test_apply.py
└── acceptance/             # VAL-01, VAL-02 via testcontainers (real Odoo 17)
    ├── fixtures/
    │   ├── val01/          # 4 fixture files (initial + mid-lifecycle)
    │   └── val02/          # 4 fixture files
    ├── test_val01.py
    └── test_val02.py
```

### Structure Rationale

- **`dsl/` is pure**: zero imports from `engine/` or `schema/`; testable with no Odoo mocking
- **`types/` is the shared vocabulary**: all pipeline stages import types; nothing else crosses stage boundaries
- **`engine/` stages are functions, not classes**: `normalize(desired: DesiredState, schema: SchemaRegistry) -> NormalizedState`; makes unit testing trivial
- **`live_state.py` is top-level**: it is a cross-cutting concern shared between `engine/diff.py` (reads) and `engine/apply.py` (writes); not owned by either
- **`schema/` holds the version seam**: the only place where `OdooVersion` is a parameter; all other code receives an already-resolved `SchemaRegistry`

---

## Architectural Patterns

### Pattern 1: Pure-Function Pipeline Stages

**What:** Each stage is an `async def stage(input: StageInput, ...) -> StageOutput` function. Stages do not hold state. Data flows forward through immutable (Pydantic frozen model) structs.

**When to use:** Always — this is the core structural rule. No stage class with `__init__` and `run()`.

**Trade-offs:** Slightly verbose call sites at the engine orchestration layer; enormous gain in testability. Any stage can be unit-tested by constructing its input directly.

**Example:**
```python
# engine/normalize.py
async def normalize(
    desired: DesiredState,
    registry: SchemaRegistry,
) -> NormalizedState:
    """Stage 2: canonicalize values; propagate xmlid metadata."""
    ...

# engine/graph.py
def build_graph(normalized: NormalizedState) -> DependencyGraph:
    """Stage 3: build DAG; detect cycles. Sync — no I/O."""
    ...
```

### Pattern 2: Pydantic Frozen Models as Pipeline Tokens

**What:** Every inter-stage data structure is a `pydantic.BaseModel` with `model_config = ConfigDict(frozen=True)`. Field values that are mutable collections (lists of nodes) use `tuple` not `list`. This enforces the guarantee that stages cannot mutate their inputs.

**When to use:** All types in `types/`. The one exception is `GlobalLiveState` which is explicitly mutable by design — it is not a pipeline token.

**Trade-offs:** Pydantic v2 frozen models have excellent type inference and strict validation at construction time. The cost is that producing a "modified" struct requires `model.model_copy(update={...})` — explicit but clear.

**Example:**
```python
# types/desired.py
from pydantic import BaseModel, ConfigDict

class ResourceNode(BaseModel):
    model_config = ConfigDict(frozen=True)

    address: str          # "project.project:my-project"
    model: str            # "project.project"
    slug: str             # "my-project"
    xmlid: str            # "stateman.my_project"
    fields: dict[str, object]           # raw DSL values
    delete_behavior: Literal["delete", "archive", "reject"] = "reject"
    inline_children: tuple["ResourceNode", ...] = ()
```

### Pattern 3: GlobalLiveState — the Address→remote_id Resolver

**What:** A single mutable registry, created before `apply` begins, that maps canonical addresses to resolved Odoo integer IDs. Populated in two ways: (a) from the diff stage when live records already exist (xmlid lookup), and (b) incrementally by `apply` as each create/update step completes.

**Why this fixes the v1 gap:** In v1, cross-apply m2m resolution did not consult a global live state — it only knew about IDs for records created before the current step. The v2 design populates `GlobalLiveState` after every successful create, so a subsequent step that references the just-created record via an m2m can resolve its ID correctly.

**When to use:** `apply.py` is the only writer. `diff.py`, `plan.py`, and `normalize.py` are readers (read the already-populated state from a previous diff, not the in-flight apply state). The `apply` stage reads the resolver for each step immediately before executing it.

**Example:**
```python
# live_state.py
class GlobalLiveState:
    """Address → remote_id registry. Written by apply; read by apply's per-step resolver."""

    def __init__(self) -> None:
        self._map: dict[str, int] = {}

    def register(self, address: str, remote_id: int) -> None:
        self._map[address] = remote_id

    def resolve(self, address: str) -> int | None:
        return self._map.get(address)

    def resolve_or_raise(self, address: str) -> int:
        rid = self._map.get(address)
        if rid is None:
            raise ResolutionError(f"Cannot resolve address to remote_id: {address!r}")
        return rid
```

**m2m to data-source fix:** `DataSourceNode` addresses are populated into `GlobalLiveState` during the `plan` stage read-seam resolution (when data-source reads actually execute). This makes them available to the apply resolver on the same footing as managed resources. This is the fix for the v1 structural block.

### Pattern 4: The Read Seam (plan stage)

**What:** Data sources (`data.<type>(**selector)`) are declared in the DSL but do NOT execute any Odoo calls during config evaluation. They carry an unresolved `DataSourceNode` in the dependency graph. The read seam fires during `plan` — the plan stage executes `search_read` calls for all data sources, populates `GlobalLiveState` with their resolved IDs, and substitutes the concrete IDs into the ordered plan steps before serialization.

**Why at plan, not diff:** Diff needs to know that a managed resource depends on a data source, but does not need the concrete ID — it only needs to know the step must come after the data source resolves. The plan stage is the last pure-read phase before any mutations, making it the correct place to materialize data-source values.

**Implementation contract:** `plan.py` receives the `DependencyGraph` (which includes `DataSourceNode` entries), calls `client.search_read` for each, fails fast if a selector matches zero or multiple records (ambiguous reference), and writes the resolved ID into `GlobalLiveState`. Plan step serialization then references those IDs via `live_state.resolve_or_raise(address)`.

### Pattern 5: Dependency DAG with Mixed Node Types

**What:** The graph has three node types: `ManagedResource`, `InlineChild`, and `DataSource`. Edges are directed (dependency → dependent). Cycle detection runs on the full mixed graph with `networkx.find_cycle`. Topological sort determines apply order.

**Why networkx:** `networkx` is the standard Python library for graph algorithms. It has `DiGraph`, `find_cycle`, and `topological_sort` built in. No need to implement these from scratch.

**Node-type rules:**
- `DataSource` nodes have no incoming edges (they are roots by definition — nothing stateman manages depends on them in the "must create X before Y" sense; data sources are reads)
- `InlineChild` nodes have exactly one parent (`ManagedResource`); their apply order is determined by their parent's position, then their own declared order within the parent
- `ManagedResource` → `ManagedResource` edges arise from explicit field references: `resource.project.task(slug, stage_id=stage_ref)` implies the task depends on the stage

**Example:**
```python
# engine/graph.py
import networkx as nx

def build_graph(normalized: NormalizedState) -> DependencyGraph:
    g: nx.DiGraph = nx.DiGraph()
    for node in normalized.all_nodes():
        g.add_node(node.address, node=node)
    for node in normalized.all_nodes():
        for dep_address in node.dependencies:
            g.add_edge(dep_address, node.address)
    try:
        cycles = list(nx.find_cycle(g))
        if cycles:
            raise CycleError(f"Dependency cycle detected: {cycles}")
    except nx.NetworkXNoCycle:
        pass
    order = list(nx.topological_sort(g))
    return DependencyGraph(graph=g, apply_order=order)
```

### Pattern 6: Cancellation Threading (apply stage)

**What:** Module install/upgrade is the highest-risk step class because it is non-atomic, long-running (godoo-py's `ModuleManager` uses async retry loops internally), and can leave Odoo in a partially-migrated state if interrupted. Cancellation must be threaded through all long operations.

**Implementation:** The apply loop receives a `asyncio.Event` (or uses `asyncio.CancelledError` propagation). Each step executor checks the event before starting the next step. Module operations specifically: wrap `client.modules.install_module()` / `upgrade_module()` in a `asyncio.wait_for` with a configurable timeout. On `CancelledError`, apply reports partial progress (which steps completed, which failed) before re-raising.

**Progress reporting contract:** `apply` writes `ApplyProgress` after each step completes or fails. Progress is available to the CLI layer without waiting for the full run.

**Example:**
```python
# engine/apply.py
async def apply(
    plan: Plan,
    client: OdooClient,
    live_state: GlobalLiveState,
    *,
    cancel_event: asyncio.Event | None = None,
    progress_cb: Callable[[ApplyProgress], None] | None = None,
) -> ApplyResult:
    completed: list[str] = []
    for step in plan.ordered_steps:
        if cancel_event and cancel_event.is_set():
            return ApplyResult(completed=completed, failed=None, cancelled=True)
        try:
            await _execute_step(step, client, live_state)
            completed.append(step.address)
            if progress_cb:
                progress_cb(ApplyProgress(completed=completed, current=step.address))
        except Exception as exc:
            return ApplyResult(completed=completed, failed=FailedStep(step=step, error=exc))
    return ApplyResult(completed=completed, failed=None, cancelled=False)
```

### Pattern 7: Schema Registry with Explicit Odoo Version Seam

**What:** The `SchemaRegistry` is parameterized by `OdooVersion`. It wraps `godoo-py`'s `Introspector` for live fetches and additionally supports loading/saving a JSON snapshot artifact (the `build` command output). The version seam means that schema data for Odoo 17 and Odoo 18 live in separate keyed namespaces — a snapshot file carries its version, and the registry refuses to use a mismatched snapshot.

**Key fields guaranteed in the stateman schema view:**
- `store: bool` — mandatory; BUG-07-B lesson; never omit
- `ttype: str` — field type
- `readonly: bool` — writable-relation flag derived from this
- `relation: str | None` — relation target model
- `archivable: bool` — whether model has `active` field (derived: check `FieldSchema.name == "active"`)

**Snapshot source:** `godoo-py`'s `Introspector.get_schema()` already returns `FieldSchema` with `store`, `readonly`, `relation` — the stateman schema layer wraps this without re-fetching. The version seam is added by stateman.

**Example:**
```python
# schema/registry.py
@dataclass
class OdooVersion:
    major: int   # 17, 18, ...
    minor: int = 0

class SchemaRegistry:
    def __init__(self, client: OdooClient, version: OdooVersion) -> None:
        self._introspector = Introspector(client)
        self._version = version
        self._cache: dict[str, VersionedModelSchema] = {}

    async def get(self, model_name: str) -> VersionedModelSchema:
        ...  # wraps Introspector.get_schema; adds version; caches

    def to_snapshot(self) -> VersionedSnapshot:
        return VersionedSnapshot(version=self._version, models=dict(self._cache))

    @classmethod
    def from_snapshot(cls, snapshot: VersionedSnapshot, expected_version: OdooVersion) -> "SchemaRegistry":
        if snapshot.version != expected_version:
            raise VersionMismatchError(...)
        ...
```

---

## Data Flow

### Full Pipeline Flow

```
.py config file
    │
    ▼  [dsl/eval.py — pure Python, no I/O]
DesiredState (ResourceNode tree + DataSourceNode set)
    │
    ▼  [engine/normalize.py — schema-aware canonicalization]
NormalizedState (canonical field values; xmlid propagated; relation shapes normalized)
    │
    ▼  [engine/graph.py — pure, no I/O]
DependencyGraph (networkx DiGraph; apply_order: list[address])
    │
    ├──────────────────────────────────────┐
    │                                      │
    ▼  [diff.py]                           ▼  [plan.py — read seam fires here]
LiveState (fetched from Odoo via xmlid)  DataSourceNode reads execute →
    │                                    GlobalLiveState populated with data-source IDs
    ▼
PlanActions per resource (Create|Update|NoOp|Delete|Archive|Reject)
    │
    ▼  [plan.py — merges DAG order + PlanActions + resolved DataSource IDs]
Plan (ordered PlanSteps, reviewable, serializable)
    │
    ▼  [apply.py — sequential; stop-on-first-failure]
GlobalLiveState grows with each Create result →
ApplyResult (completed steps, optional FailedStep, partial-progress stream)
    │
    ▼  [verify.py — re-plan post-apply]
VerifyResult (touched-resource drift + optional full-managed drift check)
```

### Key Data Flows

1. **DSL evaluation → resource tree:** `load_config(path)` executes the user's `.py` file in a controlled namespace where `resource`, `data`, and helper symbols are injected. Execution populates an `EvalContext` that collects `ResourceNode` and `DataSourceNode` instances. No Odoo call occurs.

2. **m2m relation with data-source target (v1 gap fix):** User writes `stage_ids=[(4, data.project_task_type(name="Done"))]`. DSL eval records this as a `DataSourceRef` in the field value. Normalize converts it to a `PendingRef(address="project.task.type:done-data-source")`. Plan stage resolves the ref by executing the search_read and writing the concrete ID into `GlobalLiveState`. Apply reads `GlobalLiveState` when building the m2m write command — the data-source ID is present as if it were a managed resource ID.

3. **Cross-apply m2m resolution (v1 gap fix):** A managed resource `B` has `m2m_field_ids=[resource_a_ref]`. After `resource_a` is created (step N), apply calls `live_state.register(resource_a.address, new_id)`. When step N+k processes `resource_b.m2m_field_ids`, it calls `live_state.resolve_or_raise(resource_a.address)` and gets the just-created ID. No separate lookup required.

4. **Verify re-plan:** After apply, verify fetches fresh LiveState for touched resources and runs diff again. If any touched resource produces a non-NoOp action, it flags as drift. Optionally, if `--all-managed` is passed, it fetches all xmlids owned by stateman and re-diffs the full managed set.

---

## Recommended Build Order

The reimplement-clean decision means organizing capabilities end-to-end, not stage-by-stage ports. The recommended order:

**Phase 1 — Foundation + schema-snapshot**
Build `types/`, `schema/`, the schema registry with version seam, and godoo-py integration. Validate that `SchemaRegistry.get("project.project")` returns a correct `VersionedModelSchema` with `store` flags populated.

**Phase 2 — DSL eval + pure pipeline**
Build `dsl/` (pure eval, no Odoo), `engine/normalize.py`, `engine/graph.py`. Write unit tests for all three. No Odoo dependency — this is all pure-Python testable.

**Phase 3 — Diff + plan (first live Odoo calls)**
Build `LiveState` fetch (xmlid lookup), `engine/diff.py`, `engine/plan.py` (including read-seam resolution). At this point `plan` command works end-to-end against real Odoo. This is the first integration point.

**Phase 4 — Apply (MVP apply, no module ops)**
Build `engine/apply.py` with `GlobalLiveState`, the address→remote_id resolver, and the sequential executor for Create/Update/NoOp/Delete/Archive/Reject — excluding module install/upgrade. VAL-01 (projects + stages) passes here.

**Phase 5 — Module ops + verify + full VAL-02**
Add module install/upgrade support (godoo-py `ModuleManager` integration), cancellation threading, `engine/verify.py`, and `import` + `snapshot` commands. VAL-02 (module + namespaced config + server action) passes here.

Build order implications:
- Phases 1-2 produce zero Odoo traffic — fast iteration cycle
- Phase 3 is where testcontainers first runs — accept slower test feedback from here
- Phase 4 delivers the first working `apply` — VAL-01 fixture is the gate
- Phase 5 is the highest-risk phase (module ops are non-atomic) — save for last

---

## Anti-Patterns

### Anti-Pattern 1: Odoo Calls in DSL Evaluation

**What people do:** Call `client.search()` inside a `data.<type>()` constructor to "eagerly resolve" the reference at config load time.

**Why it's wrong:** Destroys the pure-eval guarantee. Config eval should be deterministic and side-effect-free — it runs before authentication, before the plan is reviewed, and must be repeatable. Eager resolution also breaks the dependency DAG (data-source nodes must be graph nodes, not resolved values).

**Do this instead:** DSL eval records a `DataSourceRef`. Resolution fires at the read seam in `plan.py`.

### Anti-Pattern 2: Flat LiveState (address-space collision)

**What people do:** Use just the slug as the key in `GlobalLiveState` (e.g., `"my-project"` → 42).

**Why it's wrong:** Different models can have the same slug. `project.project:my-project` and `project.task.type:my-project` are different resources.

**Do this instead:** Always key by full canonical address `"<model>:<slug>"`. The `address` property on `ResourceNode` enforces this.

### Anti-Pattern 3: Stage Classes with Shared Mutable State

**What people do:** Build an `ApplyEngine` class that accumulates state across method calls (`self._completed`, `self._live_state`).

**Why it's wrong:** Makes stages impossible to unit-test in isolation; creates ordering dependencies between method calls; hides the data contract between stages.

**Do this instead:** Pure functions that receive explicit inputs and return explicit outputs. `GlobalLiveState` is the one explicitly mutable object, passed explicitly to `apply()`.

### Anti-Pattern 4: Skipping the Store Flag in Schema Snapshots

**What people do:** Snapshot only the fields the normalizer currently uses, omitting `store`.

**Why it's wrong:** BUG-07-B from v1: computed non-stored fields look like writable fields in `fields_get` output. Writing to a non-stored field either silently no-ops or raises an error. Without the `store` flag, the normalizer cannot exclude these fields from diff/apply.

**Do this instead:** Always capture `store` in `VersionedFieldSchema`. The normalizer filters out `store=False` fields before diffing.

### Anti-Pattern 5: Synchronous Apply Loop

**What people do:** Use a synchronous loop for apply to "keep it simple."

**Why it's wrong:** Module install/upgrade uses `await asyncio.sleep()` in godoo-py's retry loop. A sync apply loop either blocks the event loop or requires threading. The entire `OdooClient` from godoo-py is async.

**Do this instead:** `async def apply(...)`. The CLI entry point runs `asyncio.run(engine.run_apply(...))`. Keep the async boundary at the CLI layer, not deeper.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Odoo 17 jsonrpc | `godoo-py` `OdooClient` (async/httpx) | Never call jsonrpc directly; always via client |
| `godoo-py` `Introspector` | Called by `SchemaRegistry`; not by engine stages | Schema registry is the only gateway |
| `godoo-py` `ModuleManager` | Called by `apply.py` for module steps only | Wrap in cancellation-aware timeout |
| Odoo `ir.model.data` | All xmlid reads/writes go through `OdooClient.ref()` and `create/write` on `ir.model.data` | This is the identity model; no sidecar |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `dsl/` → `types/` | `dsl` constructs `DesiredState` types; no reverse import | `types/` has zero knowledge of DSL |
| `engine/*` → `types/` | All stages import from `types/`; never import across engine stages | stage cross-imports are a smell |
| `engine/apply.py` → `live_state.py` | Apply is the only writer of `GlobalLiveState` | diff and plan are read-only users of a pre-populated state |
| `schema/` → `godoo-py` | Only `SchemaRegistry` imports from `godoo.introspection` | No other stateman module touches Introspector |
| `cli/` → `engine/` | CLI calls the engine orchestrator function; never individual stages | Orchestrator wires the 7-stage sequence |

---

## Scalability Considerations

This is a CLI tool, not a server. "Scale" means plan size (number of managed resources) and Odoo instance size.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| <100 resources | Current design is fine; sequential apply is correct |
| 100-1000 resources | Schema fetch should batch models (Introspector.get_schemas already supports batch); LiveState lookup is O(1) |
| >1000 resources | Consider apply-phase batching for create/write of independent resources; graph partition by model for schema fetching |

The sequential-apply constraint (stop-on-first-failure) is a deliberate correctness decision, not a performance limitation. Do not parallelize apply without re-examining this constraint.

---

## Sources

- godoo-py source: `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\client.py` (OdooClient API, async pattern)
- godoo-py source: `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\types.py` (FieldSchema — confirms `store` field present)
- godoo-py source: `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\introspector.py` (schema fetch, batch model support)
- godoo-py source: `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\services\modules\module_manager.py` (async retry pattern, ir_cron contention)
- godoo-py source: `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\safety\__init__.py` (SafetyLevel model — informs apply safety gate)
- godoo-stateman PROJECT.md — requirements, locked decisions, v1 gap inventory
- godoo-stateman SEED.md §2 — stage definitions, schema snapshot format, hard-won lessons verbatim
- networkx documentation: standard Python graph library; `find_cycle`, `topological_sort`
- pydantic v2 frozen models: `ConfigDict(frozen=True)` for immutable pipeline tokens

---
*Architecture research for: godoo-stateman — Python reconciliation engine + CLI*
*Researched: 2026-05-23*
