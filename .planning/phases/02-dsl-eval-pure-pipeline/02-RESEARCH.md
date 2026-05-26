# Phase 02: DSL Eval + Pure Pipeline - Research

**Researched:** 2026-05-26
**Domain:** Python DSL evaluation, Pydantic v2 frozen models, NetworkX DAG, normalize stage
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** DSL eval returns a frozen Pydantic `DesiredState` model — typed pipeline token.
  Carries `resources`, `data_sources`, and module-config sugar.
  Pure value-objects inside use `@dataclass(frozen=True)`.
- **D-02:** Module identity from top-level `module = "..."` declaration per config file (required —
  raise `MissingModuleError` if absent), plus optional per-resource `_module=` override stored
  as `ResourceNode.xmlid_module`. Two files declaring same `module` collide → surfaced at plan stage.
- **D-03:** `resource.<model>(slug, **fields)` — positional `slug` is identity key;
  `data.<model>(**selector)` for read-only references; `with` blocks for scoping (RSRC-03);
  attribute assignment for fields. Inline-child slugs auto-prefixed with parent slug.
- **D-04:** `resolve()` returns an eager `Deferred` thunk at eval time; fires no computation in
  Phase 2. Signature: `resolve(fn, *refs)`. `*refs` become DAG edges AND are fed to `fn` at
  read seam in Phase 3.
- **D-05:** `Deferred` stores `fn` + serializable `deps: frozenset[str]` of referenced slugs.
  `build_graph()` adds one directed edge per dep slug. Cycle detection is pure graph property —
  `networkx.find_cycle()` over slug-node DiGraph raises `CycleError` with cycle path before any
  Odoo call. `Deferred` stored as `Any`-typed field in frozen model — do NOT serialize callable.
- **D-06:** `resolve()` does not trigger Odoo I/O in Phase 2.
- **D-07:** Inline O2m children use `children(child_model, inverse_field, [...])` wrapper.
- **D-08:** `inverse_field` is mandatory — always the 3-arg form.
- **D-09:** Children flatten to top-level nodes with parent-prefixed xmlids; DAG gets
  `parent → child` edges; children participate in cycle detection. `children()` wrapper stripped
  from parent's field values during flatten.
- **D-10:** `normalize()` accepts optional `VersionedSnapshot`. Reads `snapshot.models[m].fields[f].ttype`
  / `.relation` to drive CORE-02 and CORE-08. `SchemaRegistry` remains sole live gateway.
  When snapshot is None, schema-dependent rules are skipped.

### Claude's Discretion
- Exact module/class layout under `src/godoo_stateman/dsl/` (e.g. `eval.py`, `context.py`,
  `types/desired.py`)
- `ChildBuilder`/flatten internals
- New error subclasses (`CycleError`, `DslEvalError`, `MissingModuleError` under `errors.py`)
- Whether pure stages are sync or `async def` — must remain compatible with `asyncio.run()`
  Typer-bridge pattern

### Deferred Ideas (OUT OF SCOPE)
- 2-arg `children(model, [...])` variant (no inverse field)
- `build` → lockfile artifact (RSRC-v2-01)
- Routine per-resource `_module=` usage as default path
- Inline `resource(...)` as Many2one field value
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORE-01 | Python `.py` config evaluates to desired-state tree with zero Odoo calls | exec() restricted builtins + pure DSL proxy objects verified |
| CORE-02 | Normalize: `False`→`None` scalars, `False`→`[]` relation fields; stable across two runs | ttype-driven logic verified; round-trip idempotency pattern clear |
| CORE-08 | Normalize: Many2one → integer ID; Many2many diff order-irrelevant | tuple (id, name) extraction + sorted() for m2m verified |
| RSRC-01 | `resource.<model>(slug, **fields)` constructor with positional slug | `__getattr__` proxy chain verified via exec() |
| RSRC-02 | `data.<model>(**selector)` read-only reference | DataProxy `__getattr__` chain verified |
| RSRC-03 | `with` blocks for resource scoping; attribute assignment inside | Context manager protocol + `__setattr__` verified |
| RSRC-04 | `mail.config["key"] = "val"` sugar via `odoo_module` helper | `ConfigParameterProxy.__setitem__` pattern verified |
| RSRC-05 | Walrus-operator (`:=`) support in DSL | Verified: walrus works inside list/conditional expression contexts in exec() |
| RSRC-06 | `resolve()` defers computation to read seam | `Deferred` dataclass with `fn` + `frozenset[str]` deps; fires nothing in Phase 2 |
| RSRC-07 | `exec()` with restricted builtins; not RestrictedPython | Verified: import, open, eval blocked; walrus, with blocks, operators all work |
| REL-01 | Build DAG across managed resources, inline children, data sources | NetworkX DiGraph + topological_sort verified |
| REL-02 | Cycle detection across mixed node types; report path before mutation | `nx.find_cycle()` verified: raises `NetworkXNoCycle`, returns edge tuples when cycle found |
| REL-07 | Inline One2many children participate in cycle detection | Parent-child DAG edges + flatten-to-top-level pattern verified |
</phase_requirements>

---

## Summary

Phase 2 builds the pure, Docker-free evaluation pipeline: DSL evaluator → `DesiredState` container → normalize stage → dependency DAG with cycle detection. No Odoo calls occur in this phase; the entire pipeline is testable offline using fixture snapshots injected via `_make_minimal_snapshot()`.

All three stages are well-bounded. The DSL evaluator uses `exec()` with a restricted `__builtins__` dict — verified to block `import`, `open`, and `eval` while allowing walrus operators (`:=`), `with` blocks, f-strings, and all normal Python expressions needed in config files. The `resource.<model>` and `data.<model>` proxy chains use `__getattr__` and are passed into the `exec()` namespace as pre-built objects. The `children()` wrapper is a plain callable in the namespace.

The `Deferred` type — the Phase 2 deliverable for `resolve()` (SC-5) — stores only `fn: Any` and `deps: frozenset[str]`. It fires no computation. The slugs in `deps` become directed edges in the NetworkX DiGraph, enabling `nx.find_cycle()` to detect cycles through `resolve()` chains with the same mechanism as direct resource references. This keeps cycle detection a pure graph property with no special-casing for deferred values.

The normalize stage is schema-driven via `VersionedSnapshot` (the Phase-1 artifact). The `ttype` field on `VersionedFieldSchema` drives all three normalization rules: `False`→`None` for scalars, `False`→`[]` for `many2many`/`one2many`, and tuple-extraction for `many2one`. When no snapshot is passed, schema-dependent rules are skipped — making the normalizer testable with and without a snapshot fixture.

**Primary recommendation:** Build in order: `dsl/types/` (frozen dataclasses/Pydantic models) → `dsl/context.py` (proxy objects) → `dsl/eval.py` (exec wrapper) → `dsl/normalize.py` → `dsl/graph.py`. Each stage is independently unit-testable and the output of each feeds the next as an immutable value object.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DSL file evaluation | Python process (eval layer) | — | `exec()` with proxy namespace; no I/O |
| `DesiredState` container | Python process (types layer) | — | Frozen Pydantic model; pure in-memory |
| Normalize stage | Python process (pipeline layer) | Schema snapshot (offline) | Reads `VersionedSnapshot` fixture; no live Odoo |
| Dependency DAG construction | Python process (graph layer) | NetworkX DiGraph | Pure graph; all edges derivable from in-memory state |
| Cycle detection | Python process (graph layer) | — | `nx.find_cycle()` over DAG; fires before any Odoo call |
| Schema field metadata | `VersionedSnapshot` (injected) | — | Injected as fixture in tests; populated by SchemaRegistry in live use |
| CLI wiring | CLI stub (plan command) | — | Stays stubbed in Phase 2 |

---

## Standard Stack

No new runtime dependencies are added in Phase 2. All required libraries are already in `pyproject.toml`.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Python | 3.14 | Runtime | Hard constraint from godoo-py [VERIFIED: pyproject.toml] |
| Pydantic v2 | >=2.13.4 | `DesiredState`, `ResourceNode` frozen models | Phase-1 pattern; `ConfigDict(frozen=True)` + `arbitrary_types_allowed=True` for `Deferred` [VERIFIED: pyproject.toml] |
| NetworkX | 3.6.1 | DAG construction + cycle detection + topological ordering | `DiGraph`, `find_cycle()`, `topological_sort()`, `topological_generations()` [VERIFIED: uv add networkx confirmed version 3.6.1] |
| dataclasses (stdlib) | 3.14 built-in | `Deferred`, `OdooVersion`, `XmlIdRecord` pure value objects | `@dataclass(frozen=True)` — established Phase-1 pattern [VERIFIED: codebase] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pytest | >=8 | Test runner | All unit tests [VERIFIED: pyproject.toml] |
| pytest-asyncio | >=0.24 | Async test support | If any stage uses `async def`; asyncio_mode = "auto" [VERIFIED: pyproject.toml] |
| Rich | >=15.0.0 | Error rendering in CycleError output | `CycleError.__str__` can use rich markup if desired [VERIFIED: pyproject.toml] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| NetworkX DiGraph | `graphlib.TopologicalSorter` (stdlib) | graphlib lacks `find_cycle()` detail, no edge metadata — NetworkX already in stack |
| `exec()` restricted builtins | RestrictedPython | RestrictedPython breaks walrus `:=` operator (RSRC-05 hard requirement) |
| `@dataclass(frozen=True)` for Deferred | Pydantic BaseModel | Callable field (`fn: Any`) is cleaner in dataclass; no Pydantic serialization needed for Deferred |

**NetworkX is NOT yet in pyproject.toml `[project.dependencies]`** — it is in dev deps only after a test install above. It must be added as a runtime dependency in Wave 1 before any import.

**Installation (one addition needed):**
```bash
uv add networkx
```

---

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| networkx | PyPI | ~18 yrs | >10M/wk | github.com/networkx/networkx | N/A (stdlib-class) | Approved — canonical graph library, NSF-funded project |

*slopcheck was not available in this environment. networkx is a well-established scientific Python library maintained by the NetworkX developers under a BSD-3 license; no legitimacy concern.*

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
.py config file
      |
      v
[DSL Evaluator]  exec(config, restricted_builtins, dsl_namespace)
  - resource proxy  -->  ResourceNode (mutable builder during eval)
  - data proxy      -->  DataSourceNode (mutable builder during eval)  
  - children()      -->  ChildrenWrapper (inline children)
  - resolve()       -->  Deferred(fn, deps=frozenset[slugs])
  - mail.config[]   -->  config parameter entries
  - module = "..."  -->  required module declaration
      |
      v (eval returns)
[DesiredState]  (frozen Pydantic)
  .module: str
  .resources: tuple[ResourceNode, ...]
  .data_sources: tuple[DataSourceNode, ...]
  .config_parameters: tuple[dict, ...]
      |
      v
[Flatten Stage]  (inline children → top-level ResourceNodes with parent-prefixed slugs)
  children() wrappers stripped from parent fields
  parent → child DAG edges recorded
      |
      v
[Normalize Stage]  normalize(desired_state, snapshot: VersionedSnapshot | None)
  VersionedSnapshot (optional, Phase-1 artifact)
      |-- .ttype drives: False→None (scalar), False→[] (m2m/o2m)
      |-- .ttype == 'many2one': tuple(id, name) → int id  
      |-- .ttype == 'many2many': sorted(list(value)) — canonical order, CORE-08
      |
      v (normalized DesiredState)
[Graph Stage]  build_graph(desired_state)
  nx.DiGraph  nodes = all slugs (resources + children + data_sources)
  edges:
    - direct resource ref in field value → dep_slug → slug
    - Deferred.deps → dep_slug → slug
    - parent slug → child slug (from flatten)
      |
      +-- nx.find_cycle(G)  → CycleError(cycle_path) if cycle found
      |
      v (DAG, no cycle)
  topological_sort / topological_generations → execution order
      |
      v  (Phase 3 boundary — read seam, live Odoo calls begin here)
```

### Recommended Project Structure
```
src/godoo_stateman/
├── dsl/
│   ├── __init__.py          # public surface: eval_config, DesiredState, ResourceNode, etc.
│   ├── types/
│   │   ├── __init__.py
│   │   ├── desired.py       # DesiredState (frozen Pydantic)
│   │   ├── nodes.py         # ResourceNode, DataSourceNode, ChildNode (@dataclass frozen)
│   │   └── deferred.py      # Deferred (@dataclass frozen), resolve()
│   ├── context.py           # DSL proxy objects: ResourceProxy, DataProxy, ChildrenWrapper,
│   │                        #   OdooModuleProxy, ConfigParameterProxy
│   ├── eval.py              # eval_config(path, module_override=None) -> DesiredState
│   │                        #   exec() + restricted_builtins + flatten step
│   ├── normalize.py         # normalize(state, snapshot) -> DesiredState
│   └── graph.py             # build_graph(state) -> nx.DiGraph; raises CycleError
├── errors.py                # + CycleError, DslEvalError, MissingModuleError
├── schema/                  # (Phase 1 — untouched)
├── types/                   # (Phase 1 — untouched)
├── identity.py              # (Phase 1 — untouched)
└── cli/                     # (stubs — untouched in Phase 2)

tests/unit/
├── dsl/
│   ├── __init__.py
│   ├── test_eval.py         # CORE-01, RSRC-01..07 — eval purity invariant
│   ├── test_normalize.py    # CORE-02, CORE-08 — False conversion, m2o extraction
│   ├── test_graph.py        # REL-01, REL-02, REL-07 — DAG edges, CycleError
│   └── test_deferred.py     # RSRC-06, D-04/D-05 — resolve() contract
```

### Pattern 1: exec() with Restricted Builtins (RSRC-07)

**What:** Evaluate a `.py` DSL config file using `exec()` with a minimal `__builtins__` dict and pre-built proxy objects injected into the execution namespace.

**When to use:** DSL eval entry point in `eval.py` only.

```python
# Source: verified via exec() experiments in this session
from __future__ import annotations
from pathlib import Path
from godoo_stateman.dsl.types.desired import DesiredState
from godoo_stateman.dsl.context import build_dsl_namespace

_SAFE_BUILTINS: dict[str, object] = {
    "True": True, "False": False, "None": None,
    "int": int, "str": str, "float": float, "bool": bool,
    "list": list, "dict": dict, "tuple": tuple, "set": set,
    "len": len, "range": range, "enumerate": enumerate,
    "sorted": sorted, "reversed": reversed,
    "zip": zip, "map": map, "filter": filter,
    "isinstance": isinstance, "hasattr": hasattr,
    "getattr": getattr, "min": min, "max": max, "sum": sum,
    "abs": abs, "round": round, "repr": repr, "format": format,
    # Allow try/except in DSL files
    "Exception": Exception, "ValueError": ValueError,
    "TypeError": TypeError, "AttributeError": AttributeError,
}

def eval_config(path: Path) -> DesiredState:
    collector = _Collector()
    dsl_ns = build_dsl_namespace(collector)   # returns dict with resource/data/children/resolve/mail
    exec_globals = {"__builtins__": _SAFE_BUILTINS, **dsl_ns}
    exec_locals: dict[str, object] = {}

    code = compile(path.read_text(), str(path), "exec")
    exec(code, exec_globals, exec_locals)

    # Extract required module declaration
    module = exec_locals.get("module") or exec_globals.get("module")
    if not isinstance(module, str) or not module:
        from godoo_stateman.errors import MissingModuleError
        raise MissingModuleError(f"Config file {path} must declare: module = \"<name>\"")

    return _build_desired_state(module, collector)
```

### Pattern 2: Deferred / resolve() (D-04, D-05, RSRC-06)

**What:** `resolve(fn, *refs)` captures a computation thunk that fires only at the read seam (Phase 3). In Phase 2 it only records dependency slugs for DAG edges.

```python
# Source: verified via Python exec experiments in this session
from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Callable

@dataclass(frozen=True)
class Deferred:
    """Eager thunk for a deferred computation — fires at read seam, not eval time."""
    fn: Any             # Callable; typed Any to allow frozen Pydantic field storage
    deps: frozenset[str]  # slug names of all *refs — become DAG edges

def resolve(fn: Any, *refs: Any) -> Deferred:
    """Return a Deferred thunk. Never calls fn in Phase 2.

    NOTE: This snippet is OUTDATED (single-.slug only). The correct implementation
    is in 02-PATTERNS.md deferred.py section: slug-first, then node_key-fallback.
    Using this snippet will silently drop DataSourceNode refs from Deferred.deps.
    """
    # OUTDATED — use PATTERNS.md version (dual slug/node_key extraction)
    dep_slugs: frozenset[str] = frozenset(
        r.slug for r in refs if hasattr(r, "slug") and isinstance(r.slug, str)
    )
    return Deferred(fn=fn, deps=dep_slugs)
```

### Pattern 3: build_graph() and CycleError (REL-01, REL-02, REL-07)

**What:** Build a NetworkX DiGraph from all nodes; collect edges from direct references, Deferred.deps, and parent-child relationships. Raise `CycleError` with path if a cycle is detected.

```python
# Source: networkx 3.6.1 verified via uv run python in this session
from __future__ import annotations
import networkx as nx
from godoo_stateman.errors import CycleError
from godoo_stateman.dsl.types.desired import DesiredState
from godoo_stateman.dsl.types.deferred import Deferred

def build_graph(state: DesiredState) -> nx.DiGraph:
    G: nx.DiGraph = nx.DiGraph()

    # Add all nodes
    for r in state.resources:
        G.add_node(r.slug, node_type="resource")
    for ds in state.data_sources:
        G.add_node(ds.node_key, node_type="data_source")

    # Add edges
    for r in state.resources:
        for field_val in r.fields.values():
            if isinstance(field_val, Deferred):
                for dep_slug in field_val.deps:
                    if G.has_node(dep_slug):
                        G.add_edge(dep_slug, r.slug)  # dep → consumer
            elif hasattr(field_val, "slug") and G.has_node(field_val.slug):
                G.add_edge(field_val.slug, r.slug)

    # Detect cycles
    try:
        cycle_edges = nx.find_cycle(G)
        # nx.find_cycle returns list of (u, v) tuples; reconstruct path string
        path = [e[0] for e in cycle_edges] + [cycle_edges[-1][1]]
        cycle_str = " -> ".join(path)
        raise CycleError(f"Dependency cycle detected: {cycle_str}")
    except nx.NetworkXNoCycle:
        pass

    return G
```

Key API facts [VERIFIED: networkx 3.6.1, uv run python]:
- `nx.find_cycle(G)` raises `nx.NetworkXNoCycle` when there is no cycle (not `None` return)
- `nx.find_cycle(G)` returns a list of `(u, v)` edge tuples when a cycle exists
- `nx.topological_sort(G)` returns nodes in linear order (dependencies first)
- `nx.topological_generations(G)` yields sets of nodes at each dependency level (useful for wave-level planning in Phase 4)

### Pattern 4: Normalize Stage (CORE-02, CORE-08, D-10)

**What:** Convert raw field values to canonical internal representation using `VersionedFieldSchema.ttype` from an injected `VersionedSnapshot`.

```python
# Source: verified via Python experiments in this session
from __future__ import annotations
from godoo_stateman.schema.snapshot import VersionedSnapshot

_M2X_TYPES = frozenset({"many2many", "one2many"})

def _normalize_value(value: object, ttype: str) -> object:
    """Canonical value for a single field given its Odoo field type."""
    if ttype in _M2X_TYPES:
        # CORE-02: False/None → empty list for relation fields
        if value is False or value is None:
            return []
        # CORE-08: m2m order-irrelevant — sort for canonical comparison
        return sorted(list(value))
    elif ttype == "many2one":
        # CORE-02: False/None → None
        if value is False or value is None:
            return None
        # CORE-08: (id, display_name) tuple → integer ID
        if isinstance(value, (list, tuple)) and len(value) == 2:
            return int(value[0])
        return value
    else:
        # Scalar (char, integer, boolean, date, etc.)
        # CORE-02: False → None (unset marker)
        # NOTE: boolean False is a VALID value but Odoo uses False for unset too.
        # The normalize rule is: treat False as None for all scalars.
        # Desired-state configs use explicit False when they MEAN False for boolean.
        if value is False:
            return None
        return value
```

**Boolean edge case (RESOLVED — A1 decision):** `boolean` ttype is EXEMPTED from the
`False`→`None` rule. `_normalize_value` returns `value` as-is when `ttype == "boolean"`,
so `active = False` in a config file stays `False` after normalization. This lets the diff
stage detect archive intent (desired `False` vs live `True`). The original note below
suggesting both become `None` is INCORRECT and superseded by the A1 decision in the plan.

### Pattern 5: children() wrapper and flatten (D-07, D-08, D-09)

**What:** `children(child_model, inverse_field, [...])` wraps inline O2m children during eval; `_flatten_children()` post-processes the collected resources, extracting child nodes as top-level `ResourceNode` entries with parent-prefixed slugs.

```python
# Source: verified via Python experiments in this session
from dataclasses import dataclass

@dataclass(frozen=True)
class ChildrenWrapper:
    child_model: str
    inverse_field: str
    children: tuple  # tuple[ResourceNode, ...]

def children(
    child_model: str, inverse_field: str, children_list: list[Any]
) -> ChildrenWrapper:
    """DSL callable — returns a wrapper, never mutates state."""
    return ChildrenWrapper(
        child_model=child_model,
        inverse_field=inverse_field,
        children=tuple(children_list),
    )

# Flatten: post-eval step, produces flat list of ResourceNodes
def _flatten(resources: list[ResourceNode]) -> list[ResourceNode]:
    flat: list[ResourceNode] = []
    for parent in resources:
        flat_fields: dict[str, Any] = {}
        child_nodes: list[ResourceNode] = []
        for fname, fval in parent.fields.items():
            if isinstance(fval, ChildrenWrapper):
                for child in fval.children:
                    # D-09: auto-prefix slug
                    child_slug = f"{parent.slug}.{child.slug}"
                    # Add inverse_field pointing to parent
                    child_fields = {**child.fields, fval.inverse_field: parent}
                    child_nodes.append(ResourceNode(
                        model=fval.child_model,
                        slug=child_slug,
                        fields=child_fields,
                        parent_slug=parent.slug,
                    ))
                # Strip wrapper — parent field becomes list of child slugs
                flat_fields[fname] = [f"{parent.slug}.{c.slug}" for c in fval.children]
            else:
                flat_fields[fname] = fval
        flat.append(dataclasses.replace(parent, fields=flat_fields))
        flat.extend(child_nodes)
    return flat
```

**DAG edges from children:** After flatten, `build_graph()` detects child nodes (those with `parent_slug`) and adds `parent_slug → child_slug` edge. This makes children participate in cycle detection (REL-07, SC-3).

### Anti-Patterns to Avoid

- **`from __future__ import annotations` in DSL eval module:** The `exec()` call uses `compile()` which does NOT inherit the calling module's `from __future__` imports. DSL config files are compiled independently — no issue. But the `eval.py` module itself should still use `from __future__ import annotations` for its own type hints.
- **Catching `NetworkXUnfeasible` for cycle detection:** `find_cycle()` raises `NetworkXNoCycle` (not `NetworkXUnfeasible`) when no cycle exists. Catching the wrong exception will silently swallow the no-cycle case.
- **Storing callable in Pydantic field without `arbitrary_types_allowed=True`:** Pydantic v2 rejects non-JSON-serializable types by default. `DesiredState` (or any model holding `ResourceNode` with `Deferred` fields) must set `ConfigDict(arbitrary_types_allowed=True)`.
- **Using `dict` for `ResourceNode.fields` and expecting deep-freeze:** Pydantic `frozen=True` freezes the model attribute binding, not the dict contents. `dict` fields remain mutable after construction. This matches Phase-1 precedent (`VersionedModelSchema.fields`) — acceptable, but document it.
- **Injecting `__import__` into restricted builtins:** This would bypass the security constraint. Keep `__import__` absent from `_SAFE_BUILTINS`.
- **Calling `asyncio.run()` around pure sync stages:** DSL eval, normalize, and graph stages are pure sync — no `asyncio.run()` wrapper needed. The Typer bridge is only needed for CLI commands that call async Odoo operations.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cycle detection in dependency graph | Custom DFS cycle finder | `nx.find_cycle(G)` | Handles all edge cases including self-loops, disconnected components; returns the exact cycle path; tested against millions of graphs |
| Topological ordering | Custom iterative topo sort | `nx.topological_sort(G)` or `nx.topological_generations(G)` | `topological_generations()` gives wave-level grouping needed for Phase 4 parallel apply |
| Frozen data containers | Custom immutable classes | `@dataclass(frozen=True)` + Pydantic `ConfigDict(frozen=True)` | Pattern established in Phase 1; `FrozenInstanceError` on mutation; no reinvention |
| DSL safety isolation | Custom AST transformer | `exec()` with `__builtins__` dict | RestrictedPython breaks walrus; AST rewriting is fragile; the builtins-dict approach is well-documented and sufficient for trusted-author configs |

**Key insight:** The pure pipeline's only novel engineering is the DSL proxy objects and the `Deferred` contract. Everything else (graph, frozen models, normalization) uses existing, proven tools exactly as specified.

---

## Common Pitfalls

### Pitfall 1: `nx.find_cycle` exception polarity
**What goes wrong:** Code checks `if nx.find_cycle(G) is None:` — this is WRONG because `find_cycle` raises an exception on no-cycle, never returns `None`.
**Why it happens:** API confusion with `None`-returning search functions.
**How to avoid:** Always wrap in `try/except nx.NetworkXNoCycle`. [VERIFIED: networkx 3.6.1]
**Warning signs:** Tests that should detect cycles pass silently.

### Pitfall 2: Module declaration not found in `exec_locals` vs `exec_globals`
**What goes wrong:** `module = "mymodule"` in the config file ends up in `exec_locals`, not `exec_globals`. If the checker only looks in `exec_globals`, `module` appears absent and raises `MissingModuleError` incorrectly.
**Why it happens:** `exec(code, globals, locals)` puts module-level assignments in `locals`.
**How to avoid:** Check `exec_locals.get("module") or exec_globals.get("module")`. [VERIFIED: exec() experiments]

### Pitfall 3: Walrus operator `:=` only works inside expressions
**What goes wrong:** `r1 := resource.res_partner("slug")` as a standalone statement is a `SyntaxError`. The walrus operator is valid only as an assignment expression inside another expression (list literal, `if`, `while`, comprehension).
**Why it happens:** Python syntax rule — `:=` is not a statement.
**How to avoid:** DSL convention: `[r1 := resource.model("slug"), ...]` in a list context, or assign to a throwaway: `_ = (r1 := resource.model("slug"))`. Document this in the DSL authoring guide. [VERIFIED: exec() SyntaxError confirmed]

### Pitfall 4: `arbitrary_types_allowed=True` missing on Pydantic model holding Deferred
**What goes wrong:** Pydantic raises `PydanticSchemaGenerationError` when a model's field type cannot be represented in JSON schema (e.g., a callable inside `Deferred`).
**Why it happens:** Pydantic v2 strict schema generation rejects arbitrary Python objects by default.
**How to avoid:** `ConfigDict(frozen=True, arbitrary_types_allowed=True)` on any model that will contain `ResourceNode` (which contains `fields: dict[str, Any]` that may hold `Deferred`). [VERIFIED: Pydantic v2 test in this session]

### Pitfall 5: `ChildrenWrapper` left in parent `fields` dict after flatten
**What goes wrong:** `build_graph()` iterates over `fields.values()` looking for `Deferred` and resource refs. An un-flattened `ChildrenWrapper` in the dict will not be recognized as either — its children's dep edges will be silently dropped.
**Why it happens:** Flatten step skipped or called after graph build.
**How to avoid:** Enforce flatten as part of `eval_config()` return path — `DesiredState` must never contain `ChildrenWrapper` values. Add an assertion or validation step. [ASSUMED based on design analysis]

### Pitfall 6: Boolean `False` normalization ambiguity
**What goes wrong:** A resource field `active = False` (meaning "archive this record") normalizes to `None`. If live Odoo also returns `False` for the `active` field, both normalize to `None` → `NoOp` instead of the intended update.
**Why it happens:** CORE-02 says `False`→`None` for scalars — designed for unset/null semantics, not for boolean fields.
**How to avoid:** For `boolean` ttype fields, the normalizer should preserve `False` as `False`, not convert to `None`. The implementation must branch on `ttype == "boolean"` before applying the scalar `False`→`None` rule. [ASSUMED — this edge case was identified in analysis; verify against CORE-02 intent with Marc if needed]

---

## Code Examples

### Minimal working DSL config file
```python
# Source: DSL contract from CONTEXT.md + verified patterns
module = "my_project"

with resource.res_partner("main_partner") as partner:
    partner.name = "Acme Corp"
    partner.email = "info@acme.example"

with resource.project_project("project_alpha") as proj:
    proj.name = "Alpha"
    proj.partner_id = partner  # direct resource reference → DAG edge

_ = (admin := data.res_users(login="admin"))  # walrus in expression

with resource.project_task("task_001") as task:
    task.name = "First Task"
    task.project_id = proj
    task.user_ids = resolve(lambda u: [u.res_id], admin)  # deferred

mail.config["web.base.url"] = "https://odoo.example.com"
```

### `_make_minimal_snapshot()` fixture pattern (from Phase 1)
```python
# Source: tests/unit/test_schema_registry.py (existing codebase)
# Use this pattern for all DSL unit tests needing schema context

def _make_dsl_snapshot(models: dict[str, VersionedModelSchema]) -> VersionedSnapshot:
    return VersionedSnapshot(
        odoo_version="17.0",
        schema_format_version=SCHEMA_FORMAT_VERSION,
        captured_at="2026-01-01T00:00:00+00:00",
        models=models,
    )
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| RestrictedPython for DSL sandboxing | `exec()` with `__builtins__` dict | Decision in CONTEXT.md D-03 | RestrictedPython broke walrus `:=`; builtins-dict is simpler and sufficient |
| graphlib.TopologicalSorter (stdlib) | NetworkX DiGraph | Decision in CLAUDE.md | graphlib has no `find_cycle()` detail; NetworkX adds wave-level grouping via `topological_generations` |
| Pydantic v1 | Pydantic v2 with `model_config = ConfigDict(frozen=True)` | Pre-project decision | v2 is 10-50x faster, `frozen=True` gives true immutability on attribute reassignment |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Boolean `False` should be preserved (not converted to `None`) by normalizer for `boolean` ttype fields | Pitfall 6, Pattern 4 | If wrong: `active=False` (archive) would be indistinguishable from "unset active" after normalize; diff stage would miss intended archive operations |
| A2 | `ChildrenWrapper` assertion/validation in `eval_config()` prevents un-flattened wrappers from reaching `DesiredState` | Pitfall 5 | If omitted: silent DAG edge drops for child nodes with deps |
| A3 | NetworkX is added as a runtime dependency (not just dev dep) | Standard Stack | If left as dev dep only: `import networkx` fails at runtime for end users |
| A4 | `ResourceNode.parent_slug` field tracks parent relationship for DAG edge construction | Pattern 5, graph.py | If not included: `build_graph()` cannot add parent→child edges without walking all parent resource fields again |

**Claim A1 is RESOLVED** — `boolean` ttype is exempted from the `False`→`None` scalar rule (see 02-03 plan, A1 decision). The CONTEXT.md D-10 driven-by-ttype approach supports this. CORE-02's scalar rule has an implicit `boolean` carve-out per the planning context decision.

---

## Open Questions (RESOLVED)

1. **Boolean False normalization (A1)** — **(RESOLVED)**: `boolean` ttype is exempted from the
   `False`→`None` scalar rule. `_normalize_value` branches on `ttype == "boolean"` before
   the scalar `False`→`None` rule and returns `value` as-is. This preserves `active=False` as
   `False` so the diff stage can detect archive intent (see 02-03 `test_boolean_false_preserved`).
   - What we know: CORE-02 says `False`→`None` for scalars; `boolean` is a scalar ttype; `active = False` is a legitimate desired-state value meaning "archive this record"
   - What's unclear: Should `boolean` ttype be exempted from the `False`→`None` rule?
   - Recommendation: Exempt `boolean` ttype — preserve `False` as `False`. The "unset" case for booleans in Odoo is still `False`, but the normalize contract just needs to be consistent (desired config `False` == live Odoo normalized `False` → `NoOp`).

2. **`data.<model>` node key in DAG** — **(RESOLVED)**: `DataSourceNode.node_key` is the
   deterministic string `f"data.{model}[{','.join(f'{k}={v!r}' for k,v in sorted(selector.items()))}]"`,
   constructed in `DataProxy.__getattr__` and stored as a field on `DataSourceNode`. This string
   is used as the graph node identifier in `build_graph()` and as the DAG edge target in
   `Deferred.deps` (see 02-01 nodes.py and 02-02 context.py `DataProxy.__getattr__`).
   - What we know: `DataSourceNode` has no `slug` — it's selector-based
   - What's unclear: How are data source nodes keyed in the DiGraph? (e.g., `"data.res_users[login=admin]"`)
   - Recommendation: Derive a deterministic string key from `(model, frozenset(selector.items()))`. Store as `DataSourceNode.node_key`.

3. **`resolve()` refs that are `DataSourceNode` (not `ResourceNode`)** — **(RESOLVED)**:
   `resolve()` extracts `.slug` first (ResourceNode), then `.node_key` (DataSourceNode), then
   skips refs with neither. Both identifiers land in `Deferred.deps` and become DAG edges.
   The correct implementation is in 02-PATTERNS.md `deferred.py` section (slug-first, node_key-
   fallback). See `test_resolve_deps_from_data_source_node_key` (02-01) and
   `test_deferred_data_source_edge` (02-04) for coverage.
   - What we know: D-04 says `*refs` are "resource references" — but `data.<model>()` returns a `DataSourceNode`
   - What's unclear: Can `resolve(fn, data_source_ref)` reference a data source? If so, does its `node_key` become a DAG edge?
   - Recommendation: Yes — any object with a `.slug` or `.node_key` attribute passed to `resolve()` should become a DAG edge. The `Deferred.deps` should use whatever identifier the ref provides.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 2 is a pure Python code phase with no external service dependencies. NetworkX is added as a runtime package (uv add networkx). No Docker, no databases, no external services required.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest >=8 + pytest-asyncio >=0.24 |
| Config file | `pyproject.toml` `[tool.pytest.ini_options]` |
| Quick run command | `uv run pytest tests/unit/dsl/ -q` |
| Full suite command | `uv run pytest tests/unit/ -q` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORE-01 | eval_config returns DesiredState with zero Odoo calls | unit | `uv run pytest tests/unit/dsl/test_eval.py -x -q` | Wave 0 |
| CORE-02 | normalize: False→None scalar, False→[] relation; round-trip stable | unit | `uv run pytest tests/unit/dsl/test_normalize.py -x -q` | Wave 0 |
| CORE-08 | normalize: m2o tuple→int; m2m order-irrelevant | unit | `uv run pytest tests/unit/dsl/test_normalize.py -x -q` | Wave 0 |
| RSRC-01 | resource.<model>(slug, **fields) constructor works | unit | `uv run pytest tests/unit/dsl/test_eval.py::test_resource_constructor -x -q` | Wave 0 |
| RSRC-02 | data.<model>(**selector) read-only ref works | unit | `uv run pytest tests/unit/dsl/test_eval.py::test_data_source -x -q` | Wave 0 |
| RSRC-03 | with blocks + attribute assignment | unit | `uv run pytest tests/unit/dsl/test_eval.py::test_with_block -x -q` | Wave 0 |
| RSRC-04 | mail.config["key"]="val" produces config_parameter entry | unit | `uv run pytest tests/unit/dsl/test_eval.py::test_mail_config -x -q` | Wave 0 |
| RSRC-05 | Walrus := inside expression context works in exec | unit | `uv run pytest tests/unit/dsl/test_eval.py::test_walrus_operator -x -q` | Wave 0 |
| RSRC-06 | resolve() returns Deferred, does not fire fn | unit | `uv run pytest tests/unit/dsl/test_deferred.py -x -q` | Wave 0 |
| RSRC-07 | exec() blocks import, open, eval; allows required ops | unit | `uv run pytest tests/unit/dsl/test_eval.py::test_restricted_builtins -x -q` | Wave 0 |
| REL-01 | build_graph produces DiGraph with correct nodes/edges | unit | `uv run pytest tests/unit/dsl/test_graph.py -x -q` | Wave 0 |
| REL-02 | CycleError raised with cycle path | unit | `uv run pytest tests/unit/dsl/test_graph.py::test_cycle_detection -x -q` | Wave 0 |
| REL-07 | inline children participate in cycle detection | unit | `uv run pytest tests/unit/dsl/test_graph.py::test_children_cycle -x -q` | Wave 0 |
| SC-5 | resolve() design spike: edge creation + cycle through Deferred | unit | `uv run pytest tests/unit/dsl/test_deferred.py::test_resolve_dag_edges -x -q` | Wave 0 |
| SC-2 | normalize round-trip: two runs → identical output | unit | `uv run pytest tests/unit/dsl/test_normalize.py::test_normalize_idempotent -x -q` | Wave 0 |

### Sampling Rate
- **Per task commit:** `uv run pytest tests/unit/dsl/ -q`
- **Per wave merge:** `uv run pytest tests/unit/ -q`
- **Phase gate:** Full suite green (`uv run pytest tests/unit/ -q`) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/dsl/__init__.py` — package marker
- [ ] `tests/unit/dsl/test_eval.py` — covers CORE-01, RSRC-01..07
- [ ] `tests/unit/dsl/test_normalize.py` — covers CORE-02, CORE-08, SC-2
- [ ] `tests/unit/dsl/test_graph.py` — covers REL-01, REL-02, REL-07
- [ ] `tests/unit/dsl/test_deferred.py` — covers RSRC-06, D-04/D-05, SC-5
- [ ] `src/godoo_stateman/dsl/__init__.py` — package marker

---

## Security Domain

`security_enforcement: true` (from `.planning/config.json`), ASVS level 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Phase 2 makes zero Odoo calls |
| V3 Session Management | No | No sessions in pure pipeline |
| V4 Access Control | No | No access control in eval stage |
| V5 Input Validation | Yes (partial) | DSL config file is author-supplied; restricted builtins dict blocks OS-level escape |
| V6 Cryptography | No | No crypto in this phase |
| V8 Data Protection | No | No PII processed in eval stage |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| DSL config file with `import os; os.system(...)` | Tampering / Elevation | `__builtins__` dict without `__import__` blocks all stdlib imports [VERIFIED] |
| `open()` call in config file to read secrets | Information Disclosure | `open` absent from `_SAFE_BUILTINS` → `NameError` [VERIFIED] |
| `eval()` / `exec()` call inside config file | Elevation | Both absent from `_SAFE_BUILTINS` → `NameError` [VERIFIED] |
| Infinite loop in config file (`while True: pass`) | Denial of Service | No mitigation in Phase 2 — DSL is trusted-author context; CPU timeout is an operator concern |
| Cycle through `resolve()` deps bypassing cycle detection | Logic flaw | `build_graph()` treats `Deferred.deps` the same as direct refs — same cycle detection applies [VERIFIED] |

**Security note:** The restricted-builtins approach is sufficient for trusted-author scenarios (internal teams, versioned config files). It is NOT a sandbox for untrusted user input. This is consistent with the project's design: DSL configs are version-controlled, authored by the operator, and equivalent in trust to any Python script they would run directly.

---

## Sources

### Primary (HIGH confidence)
- `src/godoo_stateman/types/schema.py` — `VersionedFieldSchema.ttype`, `VersionedModelSchema.fields` dict pattern [VERIFIED: codebase]
- `src/godoo_stateman/schema/snapshot.py` — `VersionedSnapshot` construction and load/save [VERIFIED: codebase]
- `src/godoo_stateman/errors.py` — `StatemanError` base class [VERIFIED: codebase]
- `tests/unit/test_schema_registry.py` — `_make_minimal_snapshot()` fixture pattern [VERIFIED: codebase]
- `pyproject.toml` — `asyncio_mode = "auto"`, no `@pytest.mark.asyncio` needed [VERIFIED: codebase]
- NetworkX 3.6.1 API — `find_cycle()`, `topological_sort()`, `topological_generations()` signatures and behavior [VERIFIED: uv run python in this session]
- Python exec() behavior — restricted builtins blocking import/open/eval; walrus operator support [VERIFIED: uv run python in this session]
- Pydantic v2 `ConfigDict(frozen=True, arbitrary_types_allowed=True)` pattern [VERIFIED: uv run python in this session]

### Secondary (MEDIUM confidence)
- `.planning/phases/02-dsl-eval-pure-pipeline/02-CONTEXT.md` — all design decisions D-01 through D-10 [CITED: project planning doc]
- `.planning/REQUIREMENTS.md` — CORE-01/02/08, RSRC-01..07, REL-01/02/07 requirement text [CITED: project planning doc]

### Tertiary (LOW confidence)
- None — all critical claims verified from codebase or live execution

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified via pyproject.toml and live uv run
- Architecture: HIGH — all patterns verified via exec() experiments; all NetworkX APIs confirmed
- Pitfalls: HIGH (Pitfall 1-4) / MEDIUM (Pitfall 5-6) — Pitfalls 5-6 are design-analysis based

**Research date:** 2026-05-26
**Valid until:** 2026-06-26 (all dependencies locked; no fast-moving components)
