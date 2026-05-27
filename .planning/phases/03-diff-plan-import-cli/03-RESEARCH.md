# Phase 3: Diff + Plan + Import CLI - Research

**Researched:** 2026-05-27
**Domain:** Odoo jsonrpc live-state fetch, diff classification, read-seam resolution, Rich plan rendering, xmlid-driven import
**Confidence:** HIGH — all claims source-verified against actual codebase files

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Natural-identity / duplicate detection is NOT a stateman concern. `find_by_xmlid(xmlid_prefix, slug)` returning `None` → `Create`. stateman never searches Odoo for look-alike records. Odoo's own constraints arbitrate on apply.
- **D-02:** `Reject` survives only for xmlid-namespace collision: `find_by_xmlid` resolves to a record of a different model than the config declares. Decided from `ir.model.data` alone.
- **D-03:** Adoption happens only via explicit `import`. ROADMAP SC-3 and REQUIREMENTS SAFE-03 must be reworded before verification to match D-01/D-02.
- **D-04:** Managed universe = all `ir.model.data` rows whose `module` equals config's `xmlid_prefix`. Records in that set but absent from desired-state → Delete / Archive.
- **D-05:** Rename `module =` → `xmlid_prefix =` and `_module=` → `_xmlid_prefix=` at top-level config and per-resource override. Touches `DesiredState.module`, `ResourceNode.xmlid_module`, `dsl/eval.py`, `dsl/context.py`, `MissingModuleError`, and all Phase-2 tests asserting `state.module`. **This rename is Wave 0 / first task.**
- **D-06:** Terraform-style flat annotated list: `+` Create, `~` Update, `-` Delete, `x` Reject; Update shows `field: old → new` lines (not `rich.syntax.Syntax("diff")`).
- **D-07:** `NoOp` resources hidden by default; shown under `--verbose`. Trailing `N resources unchanged` summary line always visible.
- **D-08:** Deterministic ordering: topological order from NetworkX DAG (dependencies before dependents), ties broken by slug sort.
- **D-09:** Non-TTY fallback via `Console(force_terminal=False)`. All plan output via Rich.
- **D-10:** `import` signature: `import --model <m> --id <n> --module <prefix> --name <slug>`. `--module`/`--name` map to `ir.model.data` columns; `xmlid_prefix` rename does not change CLI flag names.
- **D-11:** `import` flow: (1) `search_read` target model by `--id` to confirm record exists; (2) `find_by_xmlid(prefix, name)` — same `res_id` → no-op exit 0, different record → error unless `--force`; (3) `write_xmlid(...)`.
- **D-12:** `--domain` selector and batch adoption deferred. Single record per invocation.

### Claude's Discretion

- LiveState fetch strategy (batch-fetch vs per-model; field projection).
- Module/class layout under `src/godoo_stateman/` for diff/plan/livestate code.
- `PlanStep`/action model shape (frozen Pydantic).
- New error subclasses under `errors.py` (e.g. xmlid-collision error).
- Exact archive/NoOp symbols in the annotated list.
- Whether read-seam resolution lives in a dedicated stage module or inside the plan stage.

### Deferred Ideas (OUT OF SCOPE)

- `import --domain` selector.
- Batch adoption.
- `natural_key=` DSL declaration (consciously rejected, D-01).
- ROADMAP/REQUIREMENTS wording update for SC-3/SAFE-03 (documentation correction, not feature).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORE-03 | Diff stage computes per-resource action (Create/Update/NoOp/Delete/Archive/Reject) | LiveState fetch + `find_by_xmlid` + field comparison patterns documented |
| CORE-04 | Plan stage resolves data-source reads (read seam) and serializes ordered steps without mutating Odoo | `Deferred.fn` firing contract, `DataSourceNode.selector`→ID resolution pattern documented |
| IDENT-01 | Every managed resource identified by xmlid in `ir.model.data`; no local state file | `find_by_xmlid`/`write_xmlid` already implemented; diff stage consumes them |
| IDENT-02 | Two machines converge identically | Deterministic ordering (D-08) + xmlid-as-sole-state ensures this |
| IDENT-03 | `write_xmlid`/`find_by_xmlid` helpers operate against `ir.model.data` via jsonrpc | Implemented in Phase 1; this phase consumes them |
| IDENT-04 | `import` CLI command adopts existing record by writing xmlid | D-10/D-11 flow documented |
| IDENT-05 | After `import`, subsequent `plan`/`apply` treat record as managed | Round-trip via `find_by_xmlid` returning non-None → Update/NoOp |
| REL-03 | Data-source records resolve at plan stage (read seam), IDs available to diff/apply | `DataSourceNode.selector` → `search_read` → ID; stored in read-seam result map |
| REL-04 | m2m fields may reference data-source records; must resolve correctly | m2m-to-datasource resolution documented; old Go v1 blocker fixed by making seam explicit |
| SAFE-03 | Never silently adopt; Reject = xmlid namespace collision (redefined per D-02) | `find_by_xmlid` model-field comparison → Reject action |
| UX-01 | CLI exposes exactly five top-level commands | Already registered in Phase 1; plan/import stubs replaced this phase |
| UX-02 | `plan` exit codes: 0 (no changes), 2 (changes pending), 1 (error) | Exit code pattern documented; reserved since Phase 1 D-18 |
| UX-03 | `plan` output shows slug, model, action, and per-field diff for Update | Rich rendering pattern documented |
| UX-05 | All plan output via Rich with plain-text TTY fallback | `Console(force_terminal=False)` pattern documented |
| META-01 | List all managed resources (equivalent to `terraform state list`) | `plan` output showing all resources + actions satisfies this |
</phase_requirements>

---

## Summary

Phase 3 is the first phase that makes live Odoo jsonrpc calls. It wires the pure DSL pipeline (Phases 1–2) to a live Odoo 17 CE instance via three new stages: **LiveState fetch** (reading `ir.model.data` and live record fields), **diff** (desired vs live → per-resource action), and **plan render** (Rich output with Terraform-style annotations). The `import` command is added as the explicit adoption pathway.

All godoo-py primitives this phase needs are source-verified: `OdooClient.search_read`, `create`, `write` are all async and confirmed in `client.py`. The `Introspector.get_schema` / `FieldSchema` surface is verified to populate `store` correctly (Phase 1 confirmed this). The existing `find_by_xmlid` / `write_xmlid` helpers in `identity.py` are the backbone of both the diff stage (managed-set lookup) and the import command — no new helpers are needed for these paths.

The phase has two logical sub-problems that must be solved cleanly:
1. **The diff engine**: fetching live state, classifying desired↔live differences, and firing the read seam (Deferred thunks + DataSourceNode resolution) before field comparison.
2. **The import command**: validate-before-write flow with `--force` clobber guard.

**Primary recommendation:** Implement in three waves: (W1) DSL rename D-05 + error additions; (W2) LiveState fetch + diff + read seam; (W3) plan render + import command. Each wave is independently testable.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| LiveState fetch (ir.model.data scan) | Pipeline stage (`livestate.py`) | CLI command (`plan.py`) calls it | Read-only; belongs in pipeline, not CLI |
| DataSource read-seam resolution | Pipeline stage (`seam.py` or `plan.py`) | Depends on LiveState result | Fires `Deferred.fn`; feeds resolved IDs into diff |
| Diff classification (per-resource action) | Pipeline stage (`diff.py`) | Consumes LiveState + read-seam result | Pure logic; unit-testable without Odoo |
| Plan rendering (Rich output) | `plan.py` CLI command | Calls render helper | UI concern; separate from diff logic |
| Import command (validate + write) | `import_.py` CLI command | `identity.py` helpers | Thin CLI wrapping existing `find_by_xmlid`/`write_xmlid` |
| Field comparison (desired vs live) | `diff.py` | `schema/registry.py` for ttype lookup | Schema-driven; avoids false positives from Odoo value shapes |
| Exit code decisions | `plan.py` CLI entry | — | UX-02 responsibility |
| Managed-set query (Delete/Archive candidates) | `livestate.py` | — | `ir.model.data` query by `module == xmlid_prefix` |

---

## Standard Stack

### Core (all already in pyproject.toml — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `godoo-client` | 0.2.0 | `OdooClient` — all live jsonrpc calls | Locked dependency; source-verified API |
| `godoo-introspection` | 0.2.0 | `Introspector`/`FieldSchema` for field ttype classification | Locked dependency; `store` flag confirmed populated |
| `rich` | >=15.0.0 | Plan output rendering | Already a runtime dep; `Console`, `Table`, `Text`, `Panel` |
| `networkx` | >=3.6.1 | Topological sort for deterministic plan order (D-08) | Already a runtime dep; `topological_sort` used in graph.py |
| `pydantic` | >=2.13.4 | `PlanStep` frozen model | Already a runtime dep; pattern established in Phase 1 |

### No new runtime dependencies are needed for Phase 3.

All required capabilities are covered by the already-declared dependencies. No package installs.

---

## Package Legitimacy Audit

> No new external packages are installed in this phase. All libraries used are already declared in `pyproject.toml` and verified during prior phases.

**Packages removed due to slopcheck:** none (no new packages)
**Packages flagged as suspicious:** none

---

## Architecture Patterns

### System Architecture Diagram

```
DSL config.py
     │
     ▼
eval_config() → DesiredState (frozen)
     │
     ▼
normalize() → DesiredState (canonical values)
     │
     ▼
build_graph() → nx.DiGraph (topo order, cycle detection)
     │
     ├─► LiveState.fetch(client, xmlid_prefix)
     │        ├── ir.model.data WHERE module=xmlid_prefix → managed set
     │        └── per-model search_read(desired_fields) → live field values
     │
     ├─► ReadSeam.resolve(client, data_sources)
     │        └── DataSourceNode.selector → search_read → {node_key: res_id}
     │
     ▼
diff(desired, live_state, seam_result, registry) → list[PlanStep]
     │   ├── find_by_xmlid(module, slug) → None → Create
     │   ├── find_by_xmlid → XmlIdRecord, model mismatch → Reject
     │   ├── find_by_xmlid → XmlIdRecord, same model
     │   │       └── compare normalized desired fields vs live fields
     │   │               → NoOp | Update
     │   └── managed set minus desired set → Delete | Archive
     │
     ▼
render_plan(plan_steps, graph, console) → Rich output [exit 0 or 2]
```

```
import --model M --id N --module P --name S
     │
     ▼
search_read(M, [("id","=",N)]) → confirm record exists
     │
     ▼
find_by_xmlid(P, S)
     ├── None → write_xmlid(M, N, P, S) → exit 0
     ├── same res_id → no-op → exit 0
     └── different res_id → error [--force: write_xmlid overwrite] → exit 1
```

### Recommended Project Structure

```
src/godoo_stateman/
├── dsl/                      # Phase 2 (rename module→xmlid_prefix this phase)
│   ├── eval.py               # module → xmlid_prefix rename here
│   ├── context.py            # _module= → _xmlid_prefix= rename here
│   ├── normalize.py          # DesiredState.module → .xmlid_prefix
│   ├── graph.py              # unchanged
│   └── types/
│       ├── desired.py        # DesiredState.module → .xmlid_prefix
│       └── nodes.py          # ResourceNode.xmlid_module (keep field name; maps to renamed DSL key)
├── live/                     # NEW this phase
│   ├── __init__.py
│   ├── livestate.py          # LiveState.fetch() — ir.model.data + search_read
│   └── seam.py               # read-seam: DataSourceNode resolution + Deferred firing
├── diff.py                   # NEW: diff() function → list[PlanStep]
├── plan/                     # NEW this phase
│   ├── __init__.py
│   ├── types.py              # PlanStep frozen Pydantic model; PlanAction enum
│   └── render.py             # Rich rendering; Console(force_terminal=False)
├── cli/commands/
│   ├── plan.py               # Replace stub with full plan command
│   └── import_.py            # Replace stub with full import command
├── errors.py                 # Add XmlidCollisionError, LiveStateFetchError
└── identity.py               # Unchanged (write_xmlid/find_by_xmlid)
```

**Note on layout choice:** `live/` as a subpackage isolates the network I/O layer cleanly. The diff stage (`diff.py`) stays at top level because it is a pure function — it takes `DesiredState` + `LiveState` + `SeamResult` + `SchemaRegistry` and returns `list[PlanStep]`. This keeps it fully unit-testable with fixture objects.

### Pattern 1: LiveState Batch Fetch

**What:** Fetch all managed state in two queries per model rather than one query per resource. Avoids N+1 queries.

**Strategy (Claude's Discretion recommendation):** Batch-fetch all managed xmlids from `ir.model.data` in one query, then group by model, then issue one `search_read` per model for the union of desired fields across all resources of that model.

**Source:** `client.py` (source-verified) — `search_read` signature confirmed:
```python
# Source: godoo-py packages/godoo/src/godoo/client/client.py (source-verified)
# [VERIFIED: source code]

# Step 1: scan managed set from ir.model.data
managed_rows = await client.search_read(
    "ir.model.data",
    [("module", "=", xmlid_prefix)],
    fields=["name", "model", "res_id"],
)
# Returns list[dict] with name, model, res_id

# Step 2: group by model, collect desired field names from ResourceNodes
# Step 3: one search_read per model
live_records = await client.search_read(
    model,
    [("id", "in", res_ids_for_model)],
    fields=["id"] + sorted(desired_fields_for_model),
    order="id",  # deterministic
)
```

**Why batch-fetch, not per-resource:** SC-2 requires deterministic output; batch queries are also deterministic. Per-resource queries would be N round-trips. Phase 3 only plans; network latency is acceptable but unnecessary.

**Field projection:** Request only the fields declared in `ResourceNode.fields` for that model (plus `id`). This avoids fetching compute fields that may fail or be irrelevant. Fields not in the schema or not `store=True` are excluded from comparison anyway (see Pitfall 2 below).

### Pattern 2: Diff Classification

**What:** Map each resource in `DesiredState.resources` to a `PlanAction`.

```python
# Source: identity.py find_by_xmlid (source-verified) + diff logic (new)
# [VERIFIED: source code]

from enum import Enum

class PlanAction(str, Enum):
    CREATE = "create"
    UPDATE = "update"
    NOOP = "noop"
    DELETE = "delete"
    ARCHIVE = "archive"
    REJECT = "reject"

async def classify(resource: ResourceNode, live_state: LiveState, ...) -> PlanAction:
    effective_prefix = resource.xmlid_module or state.xmlid_prefix
    record = live_state.find(effective_prefix, resource.slug)
    # record is XmlIdRecord | None

    if record is None:
        return PlanAction.CREATE

    if record.model != resource.model:
        return PlanAction.REJECT  # D-02: xmlid-namespace collision

    # Same model: compare fields
    live_fields = live_state.get_fields(record.res_id, resource.model)
    delta = compute_delta(resource.fields, live_fields, registry)
    if delta:
        return PlanAction.UPDATE
    return PlanAction.NOOP
```

**Delete/Archive candidates:** Managed set (ir.model.data rows for this xmlid_prefix) minus the desired-state slugs = candidates for Delete or Archive. The `delete_behavior` attribute on `ResourceNode` is Phase 4 concern — Phase 3 **classifies** the action using the model's `archivable` flag from `SchemaRegistry`. If the model is archivable, the default is Archive; if not, it is Delete. Phase 3 emits the classified action in the plan; Phase 4 executes it.

**Important:** Per D-01, the diff stage NEVER issues a `search_read` to look for look-alike records. The only `ir.model.data` query is the managed-set scan.

### Pattern 3: Field Comparison (Avoiding False-Positive Diffs)

**What:** Compare normalized desired fields against live Odoo field values, accounting for Odoo's encoding of relational fields.

**Odoo value shapes (source-verified from normalize.py + Odoo reality):**
```python
# Source: normalize.py (source-verified) + Odoo jsonrpc behavior [VERIFIED: source code]

# m2o: Odoo returns [id, display_name] list — normalize to int
# m2m: Odoo returns [id, id, ...] list — normalize to sorted list
# boolean: False means False (active=False = archive intent)
# char/text: False means None (unset)

# Desired side is already normalized by normalize() stage.
# Live side must be normalized with the SAME rules before comparison.

def normalize_live_value(value: Any, ttype: str) -> Any:
    """Apply the same normalization rules to live Odoo values as to desired values."""
    # Reuse _normalize_value from normalize.py — it handles all cases including
    # the boolean carve-out (A1 decision: active=False must survive).
    return _normalize_value(value, ttype)
```

**Key insight:** The normalize stage (Phase 2) already contains `_normalize_value()` with all the correct rules. The diff stage must call the same function on **live** field values before comparison, not a different one. Import `_normalize_value` from `dsl.normalize` (or refactor it to a shared location).

**Non-stored fields:** Skip comparison for fields where `schema.fields[fname].store is False` or `schema.fields[fname].readonly is True` — these cannot be written anyway and Odoo may return unexpected values for them. Use `SchemaRegistry.get(model)` to classify each field.

### Pattern 4: Read-Seam Resolution (Deferred + DataSourceNode)

**What:** Before the diff stage runs field comparison, fire all `Deferred.fn` thunks and resolve all `DataSourceNode` selectors to remote IDs.

```python
# Source: deferred.py (source-verified)
# Deferred.fn is Any (callable); Deferred.deps is frozenset[str]

# Step 1: Resolve all DataSourceNode selectors
seam_result: dict[str, int] = {}  # node_key -> res_id
for ds in state.data_sources:
    records = await client.search_read(ds.model, domain_from_selector(ds.selector), fields=["id"], limit=2)
    if len(records) != 1:
        raise LiveStateFetchError(f"DataSource {ds.node_key!r} resolved {len(records)} records; expected exactly 1")
    seam_result[ds.node_key] = int(records[0]["id"])

# Step 2: For each ResourceNode, fire any Deferred field values
# Deferred.fn receives the resolved values of its deps (in dep order)
for resource in state.resources:
    for fname, fval in resource.fields.items():
        if isinstance(fval, Deferred):
            # deps is frozenset[str] of slug/node_key — look up resolved IDs
            resolved_args = [seam_result[dep] for dep in sorted(fval.deps)]
            # fn is called with resolved IDs (REL-03, REL-04)
            resource.fields[fname] = fval.fn(*resolved_args)
```

**Important constraint:** `ResourceNode.fields` is a `dict[str, Any]` (mutable), but `ResourceNode` itself is `@dataclass(frozen=True)`. This means the `fields` dict contents CAN be mutated (the frozenness is on attribute rebinding, not contents). However, for pipeline hygiene, produce a NEW `ResourceNode` via `dataclasses.replace(resource, fields=resolved_fields)` rather than mutating in place — this preserves the frozen-pipeline-object pattern.

**m2m-to-DataSource (REL-04):** When a desired field value is a list that contains a `DataSourceNode` reference (or a reference resolved via `Deferred`), the seam result provides the remote ID. The plan stage emits this as the resolved integer ID in the plan step.

**DataSourceNode selector → domain mapping:**
```python
# DataSourceNode.selector is dict[str, Any] from DSL evaluation
# e.g. data.project_project(name="Internal") → selector={"name": "Internal"}
# Convert to Odoo domain:
def selector_to_domain(selector: dict[str, Any]) -> list[Any]:
    return [(k, "=", v) for k, v in sorted(selector.items())]
```

### Pattern 5: PlanStep Frozen Model

**What:** The ordered list of plan steps is the serializable output of the diff + plan stages.

```python
# Source: Pydantic v2 pattern from Phase 1/2 (source-verified)
# [VERIFIED: source code]

from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict


class FieldDiff(BaseModel):
    model_config = ConfigDict(frozen=True)
    field_name: str
    old_value: Any
    new_value: Any


class PlanStep(BaseModel):
    model_config = ConfigDict(frozen=True)
    action: PlanAction          # Create | Update | NoOp | Delete | Archive | Reject
    slug: str                   # resource slug (identity key)
    model: str                  # Odoo model name e.g. "project.project"
    xmlid: str                  # full xmlid e.g. "myprefix.my_slug"
    res_id: int | None          # None for Create (not yet exists)
    field_diff: tuple[FieldDiff, ...]  # empty for non-Update actions
```

**Why `tuple` not `list`:** Consistent with Phase 1/2 pattern — `DesiredState` uses `tuple` for frozen collection semantics.

### Pattern 6: Rich Plan Render (D-06, D-07, D-08, D-09)

```python
# Source: Rich docs pattern + D-06/D-07/D-09 decisions
# [CITED: rich.readthedocs.io/en/stable]

from rich.console import Console
from rich.text import Text

# D-09: non-TTY fallback
console = Console(force_terminal=False)
# When stdout is not a TTY, Console strips markup automatically.
# No special branch needed — Rich handles it.

ACTION_SYMBOLS = {
    PlanAction.CREATE: ("[green]+[/green]", "green"),
    PlanAction.UPDATE: ("[yellow]~[/yellow]", "yellow"),
    PlanAction.DELETE: ("[red]-[/red]", "red"),
    PlanAction.ARCHIVE: ("[magenta]a[/magenta]", "magenta"),
    PlanAction.REJECT: ("[red bold]x[/red bold]", "red bold"),
    PlanAction.NOOP: ("[dim]=[/dim]", "dim"),
}

# D-08: emit in topological order, ties broken by slug sort
# nx.topological_generations(G) gives generations; within each generation sort by slug.
for generation in nx.topological_generations(graph):
    for slug in sorted(generation):
        step = plan_steps_by_slug[slug]
        # emit step
        ...

# D-07: NoOp hidden by default; shown with --verbose
noop_count = sum(1 for s in plan_steps if s.action == PlanAction.NOOP)
console.print(f"  {noop_count} resources unchanged")
```

**Non-TTY behavior:** `Console(force_terminal=False)` combined with `Console.is_terminal` (or `console.file.isatty()`) lets the renderer detect piped output. Rich strips ANSI codes automatically when not a TTY. The only difference needed is that action symbols fall back to plain text (`+`, `~`, `-`, `a`, `x`, `=`) in non-TTY contexts — Rich handles this via its own markup stripping.

**Note on `nx.topological_generations`:** This NetworkX function produces generations (sets of nodes at the same level). It is the correct API for D-08 because it yields "all nodes with no remaining predecessors" at each step, which is exactly what enables per-generation slug-sort for tie-breaking. Verify it exists in NetworkX 3.6+. [ASSUMED — `topological_generations` was added in NetworkX 2.6+; likely present in 3.6.1 but not directly verified in this session. Alternative: `list(nx.topological_sort(G))` with a custom sort — use a stable topological sort respecting slug order.]

### Anti-Patterns to Avoid

- **Natural-identity probing:** Never `search_read` a model to find records matching desired field values. D-01 is a hard constraint. Any code path that searches Odoo for look-alike records is a defect.
- **Live-side normalization mismatch:** Comparing desired (normalized) values against raw Odoo values (e.g., comparing `1` against `[1, "Name"]` for m2o) produces false-positive Updates. Always normalize live values with the same `_normalize_value()` function.
- **Mutating ResourceNode.fields in place:** Use `dataclasses.replace(resource, fields=new_dict)` for seam resolution. Mutation-in-place makes testing harder and breaks the frozen-pipeline-object idiom.
- **Assuming DataSourceNode resolves to exactly one record silently:** When `search_read` returns 0 or >1 records for a selector, raise immediately with an actionable error. Silently picking the first record causes non-deterministic behavior.
- **Fetching all fields from Odoo:** Never `search_read` without a `fields=` projection. Odoo returns binary fields (base64-encoded images, PDFs) when fields is omitted. Project only what is in `ResourceNode.fields`.
- **`nx.topological_sort` for D-08 without slug tie-breaking:** `nx.topological_sort` is not stable across Python runs. Tie-breaking by slug sort within each generation is required for SC-2 (byte-identical output).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Topological ordering with tie-breaking | Custom sort | `nx.topological_generations(G)` + `sorted()` within each generation | NetworkX already has the primitives; hand-rolling introduces bugs |
| Field type classification for diff | Custom ttype table | `SchemaRegistry.get(model).fields[f].ttype` | `store`, `readonly`, `ttype` are all populated; SchemaRegistry is the sole gateway |
| Live-value normalization | New normalize function | Import `_normalize_value` from `dsl.normalize` | The function handles all Odoo value shapes including the boolean carve-out |
| DataSource domain construction | Complex domain builder | Simple `[(k, "=", v) for k, v in sorted(selector.items())]` | Selectors are equality comparisons only in Phase 3 |
| xmlid managed-set query | Local tracking dict | Single `search_read("ir.model.data", [("module","=",prefix)])` | State lives exclusively in Odoo; no local tracking |
| Rich non-TTY fallback | Custom TTY detection + stripping | `Console(force_terminal=False)` | Rich handles ANSI stripping automatically |

**Key insight:** The diff stage is almost entirely composition of existing pieces: `find_by_xmlid` (Phase 1), `_normalize_value` (Phase 2), `SchemaRegistry.get` (Phase 1), and `nx.topological_generations` (Phase 2's NetworkX dep). Very little new logic is needed.

---

## Common Pitfalls

### Pitfall 1: Live m2o Value Shape — False Positive Diffs
**What goes wrong:** Odoo returns m2o fields as `[id, "Display Name"]` (a list). Desired values after normalize are plain `int`. Direct comparison produces `[1, "Admin"] != 1` → spurious Update.
**Why it happens:** normalize.py converts `False` or `[id, name]` tuples to `int` for desired-side values. Live-side values are raw from Odoo and must be normalized too.
**How to avoid:** Call `_normalize_value(live_value, ttype)` for every live field before comparison. Import `_normalize_value` from `dsl.normalize`.
**Warning signs:** Updates shown for fields that haven't changed; m2o fields appear changed on every `plan` run.

### Pitfall 2: Comparing Non-Store Fields
**What goes wrong:** Computed fields (e.g., `display_name` on `res.partner` with `store=False`) appear in the live `search_read` response if included in the projection. Comparing them to desired values produces spurious diffs.
**Why it happens:** DSL authors may declare computed fields in `resource.fields`; normalize passes them through unchanged.
**How to avoid:** Skip fields where `schema.fields[fname].store is False` or `schema.fields[fname].readonly is True`. Only compare storable, writable fields. Do NOT include them in the `search_read` fields projection.
**Warning signs:** Fields the author never set appear as diffs; `plan` is not idempotent.

### Pitfall 3: DesiredState.module vs ResourceNode.xmlid_module
**What goes wrong:** Every resource has an effective xmlid prefix: `resource.xmlid_module or state.xmlid_prefix`. Forgetting to check `xmlid_module` before falling back to `state.xmlid_prefix` causes resources with per-resource overrides to be looked up under the wrong prefix.
**Why it happens:** Phase 2 code (before D-05 rename) uses `state.module` everywhere; the override field on `ResourceNode` is `xmlid_module` (not renamed, since it's an internal field name, not a DSL keyword).
**How to avoid:** Always use `effective_prefix = resource.xmlid_module or state.xmlid_prefix` in the diff and import stages.
**Warning signs:** Resources with `_xmlid_prefix=` overrides always produce Create (wrong prefix → find_by_xmlid returns None).

### Pitfall 4: D-05 Rename Scope — Missing Callsites
**What goes wrong:** The `module=` → `xmlid_prefix=` rename touches more than just `desired.py`. Missing any callsite causes `AttributeError: 'DesiredState' object has no attribute 'module'` at runtime.
**Why it happens:** `state.module` is referenced in `eval.py`, `context.py`, and all tests asserting `state.module`.
**How to avoid:** After rename, run `ruff check` and `mypy` — they will surface missing attribute references. Run full unit test suite before any integration tests.
**Warning signs:** `AttributeError` on `state.module` at any point after the rename.

### Pitfall 5: DataSourceNode Resolution — 0 or >1 Records
**What goes wrong:** `DataSourceNode.selector` maps to a domain that returns 0 records (typo in selector) or >1 records (ambiguous selector). Silently picking record 0 causes non-determinism.
**Why it happens:** DSL authors write selectors like `data.project_project(name="Sales")` assuming uniqueness; Odoo may have multiple records matching.
**How to avoid:** After `search_read`, assert `len(records) == 1`; raise `LiveStateFetchError` with the selector and result count if not. Use `limit=2` in the query to detect ambiguity efficiently.
**Warning signs:** Silent incorrect ID resolution; subsequent apply writes wrong m2o/m2m targets.

### Pitfall 6: Exit Code 2 vs 1 — `plan` Command
**What goes wrong:** `plan` exits 2 when there are pending changes (D-18 reserved from Phase 1). The stub currently exits 1. If the new implementation exits 1 on "changes pending," CI scripts that key on exit 2 break.
**Why it happens:** The stub intentionally exits 1 (per D-18: stubs use 1, Phase 3 reserves 2). The new implementation must change this.
**How to avoid:** Exit 0 = all NoOp; exit 2 = any Create/Update/Delete/Archive/Reject in the plan; exit 1 = error (exception).
**Warning signs:** CI pipelines that check `plan` exit code behave incorrectly.

### Pitfall 7: Frozenness of ResourceNode After Seam Resolution
**What goes wrong:** `ResourceNode` is `@dataclass(frozen=True)` but its `fields: dict[str, Any]` is mutable. Mutating the dict in-place inside a seam resolution loop corrupts the original `DesiredState` object.
**Why it happens:** Python `frozen=True` on a dataclass prevents attribute rebinding, not mutation of mutable field contents.
**How to avoid:** Produce a `SeamResult` that maps `(model, slug, field_name) → resolved_value` rather than mutating `ResourceNode.fields`. The diff stage looks up seam results separately. Alternatively, produce new `ResourceNode` instances via `dataclasses.replace`.
**Warning signs:** Deferred values not re-resolving correctly on second `plan` run in the same process.

### Pitfall 8: ir.model.data noupdate=True During Import
**What goes wrong:** `write_xmlid` already sets `noupdate=True` on create. The import command must not try to create a second time if the xmlid already points to the same record (idempotency check).
**Why it happens:** Import flow (D-11) checks `find_by_xmlid` first — same `res_id` is a no-op. The existing `write_xmlid` handles this case correctly already.
**How to avoid:** The `import` command calls `find_by_xmlid` first (as specified in D-11), then conditionally calls `write_xmlid`. This is already the correct flow.
**Warning signs:** Duplicate `ir.model.data` rows for the same xmlid after repeated `import` calls.

---

## Code Examples

### Managed-Set Fetch from ir.model.data
```python
# Source: identity.py (source-verified) — pattern extended for managed-set scan
# [VERIFIED: source code]

managed_rows = await client.search_read(
    "ir.model.data",
    [("module", "=", xmlid_prefix)],
    fields=["name", "model", "res_id"],
    order="name",  # deterministic
)
# Returns: [{"name": "my_slug", "model": "project.project", "res_id": 42}, ...]
# Build lookup: slug -> XmlIdRecord
managed: dict[str, XmlIdRecord] = {
    r["name"]: XmlIdRecord(
        module=xmlid_prefix,
        name=str(r["name"]),
        model=str(r["model"]),
        res_id=int(r["res_id"]),
        complete_name=f"{xmlid_prefix}.{r['name']}",
    )
    for r in managed_rows
}
```

### import Command Implementation (D-10, D-11)
```python
# Source: D-10/D-11 decisions + identity.py (source-verified)
# [VERIFIED: source code]

async def _import_impl(
    client: OdooClient,
    model: str,
    record_id: int,
    module: str,  # CLI flag --module maps to xmlid_prefix
    name: str,    # CLI flag --name maps to xmlid slug
    force: bool,
) -> None:
    # Step 1: confirm record exists (D-11)
    records = await client.search_read(model, [("id", "=", record_id)], fields=["id"], limit=1)
    if not records:
        raise typer.BadParameter(f"Record {model}:{record_id} not found in Odoo")

    # Step 2: check existing xmlid binding (D-11)
    existing = await find_by_xmlid(client, module, name)
    if existing is not None:
        if existing.res_id == record_id:
            # Idempotent no-op (IDENT-05)
            console.print(f"[dim]Already managed: {module}.{name} → {model}:{record_id}[/dim]")
            return
        if not force:
            # SAFE-03: no silent clobber -- print an actionable message before exiting.
            console.print(
                f"[red]xmlid {module}.{name} already bound to "
                f"{existing.model}:{existing.res_id}. Use --force to overwrite.[/red]"
            )
            raise typer.Exit(code=1)  # different record, no --force
        # --force: fall through to write_xmlid (overwrites)

    # Step 3: write xmlid (D-11)
    await write_xmlid(client, model, record_id, module, name)
    console.print(f"[green]+[/green] Imported: {module}.{name} → {model}:{record_id}")
```

### OdooClient Authentication Pattern (source-verified)
```python
# Source: client.py __aenter__/__aexit__ (source-verified)
# [VERIFIED: source code]

async def _plan_impl(config: Path, ...) -> int:
    odoo_cfg = OdooClientConfig(url=url, database=db, username=user, password=pwd)
    async with OdooClient(odoo_cfg) as client:
        # client is authenticated inside the block
        registry = SchemaRegistry(client, OdooVersion(17, 0))
        state = eval_config(config)
        # ... pipeline stages
    return exit_code
```

### DataSourceNode Selector → Domain Conversion
```python
# Source: DataSourceNode.selector contract (source-verified in nodes.py)
# [VERIFIED: source code]

def selector_to_domain(selector: dict[str, Any]) -> list[Any]:
    """Convert a DataSourceNode selector dict to an Odoo search domain.

    All selectors are equality comparisons in Phase 3.
    Sorted for determinism (SC-2).
    """
    return [(k, "=", v) for k, v in sorted(selector.items())]

# Resolution (REL-03, REL-04):
async def resolve_data_sources(
    client: OdooClient,
    data_sources: tuple[DataSourceNode, ...],
) -> dict[str, int]:
    """Return node_key -> res_id mapping for all data sources."""
    result: dict[str, int] = {}
    for ds in data_sources:
        domain = selector_to_domain(ds.selector)
        records = await client.search_read(ds.model, domain, fields=["id"], limit=2)
        if len(records) != 1:
            raise LiveStateFetchError(
                f"DataSource {ds.node_key!r}: expected 1 record, got {len(records)} "
                f"(model={ds.model!r}, selector={ds.selector!r})"
            )
        result[ds.node_key] = int(records[0]["id"])
    return result
```

### Topological Order with Slug Tie-Breaking (D-08)
```python
# Source: networkx.org (ASSUMED — topological_generations present in nx 3.x)
# [ASSUMED]

import networkx as nx

def plan_order(graph: nx.DiGraph, plan_steps: dict[str, "PlanStep"]) -> list["PlanStep"]:
    """Return plan steps in topological order with slug tie-breaking (D-08, SC-2)."""
    ordered: list[PlanStep] = []
    for generation in nx.topological_generations(graph):
        for slug in sorted(generation):  # tie-break by slug within generation
            if slug in plan_steps:
                ordered.append(plan_steps[slug])
    return ordered
```

### TestHarness Pattern for Acceptance Tests (source-verified)
```python
# Source: godoo-testcontainers harness.py (source-verified)
# [VERIFIED: source code]

@pytest.fixture(scope="session")
async def odoo() -> TestHarness:
    async with TestHarness(snapshot=True) as h:
        yield h

@pytest.mark.integration
async def test_plan_creates_on_new_resource(odoo: TestHarness) -> None:
    # Use base-addon models only (res.partner, res.country, project.project etc.)
    # No custom addons — vanilla Odoo 17 CE base only
    client = odoo.client
    ...
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Go v1: m2m-to-data-source blocked | Python rebuild: explicit seam result dict feeds m2m fields | Phase 3 design | REL-04 fixed from day one |
| Go v1: no xmlid helpers, sidecar state | Python: `ir.model.data` as state, `find_by_xmlid`/`write_xmlid` | Phase 1 | No sidecar file; two-machine convergence |
| Go v1: natural-identity probing for Reject | Python: Reject = xmlid namespace collision only (D-01/D-02) | Phase 3 context | Simpler; Odoo constraints arbitrate duplicates |
| Stub `plan` exits code 1 | Real `plan`: exit 0 / 2 / 1 (UX-02) | Phase 3 | IaC CLI convention; CI-friendly |

**Deprecated/outdated:**
- `DesiredState.module` / `state.module` — renamed to `xmlid_prefix` in D-05; any code referencing `.module` on `DesiredState` after this phase is a bug.
- `MissingModuleError` — rename message/name to `MissingXmlidPrefixError` or keep class name but update message (planner decides).
- Plan stub in `cli/commands/plan.py` — replaced wholesale.
- Import stub in `cli/commands/import_.py` — replaced wholesale.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `nx.topological_generations(G)` is available in NetworkX 3.6.1 | Code Examples / Anti-Patterns | Would need `list(nx.topological_sort(G))` with a custom stable sort instead; minor refactor |
| A2 | Odoo 17 CE `ir.model.data` search_read on `module` field returns all rows without pagination issues for typical config sizes (<1000 resources) | LiveState fetch pattern | For very large configs, would need `iter_search_read`; not a correctness issue, only a performance one |
| A3 | `DataSourceNode.selector` dict is always a flat equality map (no OR domains, no inequalities) in Phase 3 scope | Seam resolution | If a DSL author uses a complex selector, `selector_to_domain` produces wrong results; deferred to Phase 4+ |

**If this table is empty for A1:** Check `nx.topological_generations` exists: `python -c "import networkx as nx; print(nx.topological_generations)"` — if `AttributeError`, use `nx.topological_sort` with a stable slug-order sort.

---

## Open Questions

1. **MissingModuleError rename during D-05**
   - What we know: `MissingModuleError` is in `errors.py`; D-05 renames the DSL keyword.
   - What's unclear: Whether to rename the exception class itself to `MissingXmlidPrefixError` or keep the class name and update only the error message.
   - Recommendation: Update the message (references `module = "..."` → `xmlid_prefix = "..."`); keep the class name `MissingModuleError` for now to avoid unnecessary churn in Phase 3 tests. Rename in Phase 6 if desired.

2. **SeamResult architecture: separate dict vs annotated ResourceNode**
   - What we know: `ResourceNode.fields` is a mutable dict inside a frozen dataclass. Mutating it in-place works but is fragile (Pitfall 7).
   - What's unclear: Whether a `SeamResult: dict[str, dict[str, Any]]` (slug → resolved fields) or a post-seam list of new `ResourceNode` instances is cleaner.
   - Recommendation: Produce new `ResourceNode` instances via `dataclasses.replace(resource, fields=resolved_fields_dict)` after seam resolution. This is consistent with how `normalize()` produces new nodes.

3. **CLI flag names for `import` command (D-10) vs `xmlid_prefix` rename (D-05)**
   - What we know: D-10 says keep `--module`/`--name` as CLI flag names (per SC-5). D-05 renames the DSL keyword to `xmlid_prefix`.
   - What's unclear: Whether to rename the CLI flag `--module` to `--xmlid-prefix` for consistency.
   - Recommendation: Keep `--module` for the import CLI flag as specified in D-10 / SC-5. The rename is a DSL authoring surface change; CLI flag naming is a separate concern. The help text should clarify "xmlid module/prefix".

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Acceptance tests (testcontainers) | Assumed ✓ | Unknown | Mark tests `@pytest.mark.integration`; skip with `-m "not integration"` |
| `godoo-client` 0.2.0 | All live jsonrpc | ✓ (uv.sources path) | 0.2.0 local | — |
| `godoo-introspection` 0.2.0 | SchemaRegistry | ✓ (uv.sources path) | 0.2.0 local | — |
| `godoo-testcontainers` 0.2.0 | Acceptance tests | ✓ (dev dep) | 0.2.0 local | — |
| `networkx` >=3.6.1 | Topological sort | ✓ (runtime dep) | 3.6.1+ | — |
| `rich` >=15.0.0 | Plan rendering | ✓ (runtime dep) | 15.0.0+ | — |

**Missing dependencies with no fallback:** None.

**Note:** All required packages are already declared in `pyproject.toml`. No new installs needed for Phase 3.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest >=8 + pytest-asyncio >=0.24 |
| Config file | `pyproject.toml` (`[tool.pytest.ini_options]`) |
| Quick run command | `uv run pytest -m "not integration" -q` |
| Full suite command | `uv run pytest -q` |
| Integration only | `uv run pytest -m integration -q` |
| asyncio_mode | `auto` (set in pyproject.toml from Phase 2) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORE-03 | Diff classifies Create/Update/NoOp/Delete/Archive/Reject correctly | unit | `uv run pytest tests/unit/test_diff.py -x` | ❌ Wave 0 |
| CORE-04 | Read seam resolves DataSourceNode selectors and fires Deferred.fn | unit | `uv run pytest tests/unit/test_seam.py -x` | ❌ Wave 0 |
| IDENT-01 | State lives only in ir.model.data (verified by acceptance round-trip) | integration | `uv run pytest tests/acceptance/test_plan_import.py -m integration -x` | ❌ Wave 0 |
| IDENT-02 | Two plan runs against unchanged Odoo produce identical output (SC-2) | integration | `uv run pytest tests/acceptance/test_plan_import.py::test_plan_is_deterministic -m integration -x` | ❌ Wave 0 |
| IDENT-03 | write_xmlid/find_by_xmlid round-trip | integration | Already in `tests/acceptance/test_snapshot.py` | ✅ |
| IDENT-04 | import --id flow writes xmlid | integration | `uv run pytest tests/acceptance/test_plan_import.py::test_import_writes_xmlid -m integration -x` | ❌ Wave 0 |
| IDENT-05 | Post-import plan sees record as managed | integration | `uv run pytest tests/acceptance/test_plan_import.py::test_import_then_plan_shows_noop -m integration -x` | ❌ Wave 0 |
| REL-03 | DataSourceNode resolves at plan stage | unit | `uv run pytest tests/unit/test_seam.py::test_datasource_resolves_to_id -x` | ❌ Wave 0 |
| REL-04 | m2m field referencing data-source resolves correctly | unit | `uv run pytest tests/unit/test_diff.py::test_m2m_datasource_resolved -x` | ❌ Wave 0 |
| SAFE-03 | Xmlid collision → Reject (D-02 redefinition) | unit | `uv run pytest tests/unit/test_diff.py::test_xmlid_collision_produces_reject -x` | ❌ Wave 0 |
| UX-01 | Five commands registered | unit | Already in `tests/unit/test_cli_help.py` | ✅ |
| UX-02 | plan exits 0/2/1 | unit | `uv run pytest tests/unit/test_plan_command.py::test_plan_exit_codes -x` | ❌ Wave 0 |
| UX-03 | plan output shows slug/model/action/field diff | unit | `uv run pytest tests/unit/test_plan_render.py -x` | ❌ Wave 0 |
| UX-05 | Non-TTY output is plain text | unit | `uv run pytest tests/unit/test_plan_render.py::test_non_tty_output -x` | ❌ Wave 0 |
| META-01 | plan lists all managed resources | integration | `uv run pytest tests/acceptance/test_plan_import.py::test_plan_lists_managed_set -m integration -x` | ❌ Wave 0 |

### Unit Test Strategy (offline — no Docker)

Phase 3 introduces the first live Odoo calls, but the **diff logic is fully unit-testable offline** by injecting:
1. A fixture `VersionedSnapshot` (established pattern from `test_schema_registry.py`'s `_make_minimal_snapshot()`)
2. A fixture `LiveState` dict (mock `ir.model.data` rows + live field values)
3. A fixture `SeamResult` dict (mock DataSourceNode resolution)

The Rich render tests use `Console(file=io.StringIO(), force_terminal=False)` to capture output without a TTY.

The read-seam tests can mock `OdooClient.search_read` using `unittest.mock.AsyncMock`.

### Acceptance Tests (require Docker)

Phase 3 acceptance tests live in `tests/acceptance/test_plan_import.py` and are marked `@pytest.mark.integration`. They use the session-scoped `odoo` fixture (already in `conftest.py`).

Base-addon models to use (vanilla Odoo 17 CE — confirmed from project memory):
- `res.partner` — always present; has `name`, `email`, `active` (archivable), `country_id` (m2o)
- `res.country` — stable; use as DataSourceNode for m2o resolution tests
- `res.lang` — for selector-based DataSourceNode tests

**Avoid:** `project.project`, `project.task.type` — while present in CE, their field surface varies more than `res.partner`/`res.country`.

### Sampling Rate

- **Per task commit:** `uv run pytest -m "not integration" -q`
- **Per wave merge:** `uv run pytest -q` (full suite including integration if Docker available)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/test_diff.py` — covers CORE-03, SAFE-03, REL-04
- [ ] `tests/unit/test_seam.py` — covers CORE-04, REL-03
- [ ] `tests/unit/test_plan_render.py` — covers UX-03, UX-05
- [ ] `tests/unit/test_plan_command.py` — covers UX-02 (exit codes)
- [ ] `tests/acceptance/test_plan_import.py` — covers IDENT-01/02/04/05, META-01 (integration)
- [ ] `src/godoo_stateman/plan/types.py` — PlanStep, PlanAction, FieldDiff models
- [ ] `src/godoo_stateman/plan/render.py` — Rich rendering
- [ ] `src/godoo_stateman/live/livestate.py` — LiveState.fetch()
- [ ] `src/godoo_stateman/live/seam.py` — read-seam resolution
- [ ] `src/godoo_stateman/diff.py` — diff() function

---

## Security Domain

> `security_enforcement` is enabled and `security_asvs_level` is 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes — Odoo credentials passed to OdooClient | `OdooClientConfig` takes url/db/user/password; credentials must come from env vars or config file, never hardcoded |
| V3 Session Management | partial — OdooClient manages session internally | `OdooClient.__aenter__` authenticates; `aclose()` tears down; no persistent session storage |
| V4 Access Control | no — stateman is a client-side tool; access control is Odoo's responsibility | — |
| V5 Input Validation | yes — CLI args `--model`, `--id`, `--module`, `--name` | Typer provides basic type validation; `--model` should be validated as a non-empty dotted string; `--id` as a positive int |
| V6 Cryptography | no — no encryption in this phase | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Odoo credentials in CLI args / env | Information disclosure | Use env vars (never log credentials); `OdooClientConfig` isolates credential handling |
| DSL config file path traversal (`--config ../../../../etc/passwd`) | Elevation of privilege | `Path(config).resolve()` — Typer `Path(exists=True)` validation; DSL eval is exec() which would fail gracefully on non-Python files |
| Malformed xmlid prefix injection in `ir.model.data` query | Tampering | Odoo's `search_read` uses parameterized domain values (not string interpolation); no injection risk |
| `--id` accepting non-positive integers | Tampering | Validate `record_id > 0` before `search_read`; Typer `int` type catches non-integers |
| `search_read` without limit — inadvertent full-table scan | Denial of service | Always use `fields=` projection; managed-set query should have no limit (intentional full scan of managed set); DataSource query uses `limit=2` |

**Credential handling pattern (critical):**
```python
# NEVER: hardcode credentials in CLI defaults
# NEVER: log OdooClientConfig values
# DO: read from env vars in the plan/import command:
url = os.environ.get("GODOO_URL") or typer.Option(...)
```

---

## Sources

### Primary (HIGH confidence — source-verified this session)
- `C:\dev\godoo-dev\godoo-stateman\src\godoo_stateman\identity.py` — `find_by_xmlid`, `write_xmlid`, `XmlIdRecord` exact signatures
- `C:\dev\godoo-dev\godoo-stateman\src\godoo_stateman\dsl\types\desired.py` — `DesiredState.module` (rename target for D-05)
- `C:\dev\godoo-dev\godoo-stateman\src\godoo_stateman\dsl\types\nodes.py` — `ResourceNode`, `DataSourceNode`, `ChildrenWrapper`
- `C:\dev\godoo-dev\godoo-stateman\src\godoo_stateman\dsl\types\deferred.py` — `Deferred.fn: Any`, `Deferred.deps: frozenset[str]`
- `C:\dev\godoo-dev\godoo-stateman\src\godoo_stateman\dsl\graph.py` — `build_graph()` DAG, topological order
- `C:\dev\godoo-dev\godoo-stateman\src\godoo_stateman\dsl\normalize.py` — `_normalize_value()`, boolean carve-out (A1 decision)
- `C:\dev\godoo-dev\godoo-stateman\src\godoo_stateman\dsl\eval.py` — `eval_config()`, `module` extraction, exec split
- `C:\dev\godoo-dev\godoo-stateman\src\godoo_stateman\errors.py` — `StatemanError`, `MissingModuleError`, `CycleError`
- `C:\dev\godoo-dev\godoo-stateman\src\godoo_stateman\schema\registry.py` — `SchemaRegistry.get()` signature, archivable derivation
- `C:\dev\godoo-dev\godoo-stateman\src\godoo_stateman\types\schema.py` — `VersionedFieldSchema`, `VersionedModelSchema`
- `C:\dev\godoo-dev\godoo-stateman\src\godoo_stateman\cli\commands\plan.py` — current stub (exit code 1 to replace)
- `C:\dev\godoo-dev\godoo-stateman\src\godoo_stateman\cli\commands\import_.py` — current stub (exit code 1 to replace)
- `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\client.py` — `OdooClient` full API: `search_read`, `read`, `create`, `write`, `unlink`, `ref`, `__aenter__`, `__aexit__`, error hierarchy
- `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\types.py` — `FieldSchema`, `ModelSchema` exact field names and defaults
- `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\introspector.py` — `Introspector.get_schema`, `get_schemas` batch RPC strategy
- `C:\dev\godoo-dev\godoo-py\packages\godoo-testcontainers\src\godoo\testcontainers\harness.py` — `TestHarness` async context manager pattern
- `C:\dev\godoo-dev\godoo-stateman\tests\conftest.py` — session-scoped `odoo` fixture
- `C:\dev\godoo-dev\godoo-stateman\tests\acceptance\test_snapshot.py` — integration test patterns, `_make_minimal_snapshot` idiom
- `.planning/phases/03-diff-plan-import-cli/03-CONTEXT.md` — all locked decisions D-01..D-12
- `.planning/REQUIREMENTS.md` — requirement definitions for all Phase 3 IDs
- `.planning/ROADMAP.md` — Phase 3 SC-1..SC-5
- `.planning/config.json` — `nyquist_validation: true`, `security_enforcement: true`

### Secondary (MEDIUM confidence)
- `pyproject.toml` — confirmed all runtime deps, no new installs needed

### Tertiary (LOW confidence / ASSUMED)
- A1: `nx.topological_generations` availability in NetworkX 3.6.1 — assumed from NetworkX changelog knowledge; verify before using

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — source-verified; no new deps
- Architecture: HIGH — derived from source-verified signatures and locked decisions
- Pitfalls: HIGH — derived from actual source code (normalize.py, identity.py, eval.py) plus Go v1 lessons in PROJECT.md
- Validation architecture: HIGH — test patterns source-verified from existing test files

**Research date:** 2026-05-27
**Valid until:** 2026-06-26 (stable stack; godoo-py locked at 0.2.0 via uv.sources)
