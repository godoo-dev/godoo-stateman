---
phase: 02-dsl-eval-pure-pipeline
verified: 2026-05-26T00:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 2: DSL Eval Pure Pipeline — Verification Report

**Phase Goal:** The full Python DSL authoring surface is evaluable in isolation (no Odoo calls), the normalize stage produces stable canonical values, and the dependency DAG detects cycles — all fully unit-tested without Docker.
**Verified:** 2026-05-26
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | A `.py` config using `resource.<type>(slug)`, `data.<type>()`, `with` blocks, `mail.config["key"]`, `:=` walrus refs, and `resolve()` evaluates into a `DesiredState` tree with zero Odoo calls and zero network I/O | VERIFIED | `eval.py` exec()s with restricted `_SAFE_BUILTINS`; `test_eval_purity_no_odoo_calls` patches OdooClient and confirms no call is made; 11 tests in `test_eval.py` cover all DSL surface forms |
| 2 | normalize converts `False`→`None` for scalar fields and `False`→`[]` for relation fields; round-trip against unchanged input produces identical normalized output on two runs | VERIFIED | `normalize.py` `_normalize_value()` branches on ttype before applying rules; `test_normalize_idempotent` applies normalize twice and asserts identity; 17 tests in `test_normalize.py` cover all ttype branches |
| 3 | Inline One2many children declared under a parent appear as nodes in the dependency graph and participate in cycle detection | VERIFIED | `_flatten()` in `eval.py` sets `parent_slug` on promoted child nodes; `build_graph()` adds parent→child edges from `parent_slug`; `test_children_participate_in_cycle` and `test_parent_child_edge` verify REL-07 |
| 4 | A circular dependency between two managed resources causes `build_graph()` to raise `CycleError` with the cycle path in the message before any Odoo call | VERIFIED | `graph.py` wraps `nx.find_cycle()` in `try/except nx.NetworkXNoCycle`; raises `CycleError(f"Dependency cycle detected: {cycle_str}")`; confirmed by behavioral spot-check (`b -> a -> b` in message); `test_cycle_detection` and `test_cycle_error_contains_path` cover REL-02 |
| 5 | The `resolve()` design spike is finalized: semantics (deferred computation firing at the read seam), interaction with the DAG, and the `exec()` restricted-builtins approach are documented and passing unit tests | VERIFIED | `deferred.py` implements `Deferred` (frozen dataclass) and `resolve()` (never calls fn, extracts `.slug`/`.node_key` into `frozenset[str]` deps); `graph.py` reads `Deferred.deps` to produce DAG edges; `test_deferred.py` (7 tests) covers all contracts; `exec()` security documented in `eval.py` module docstring and covered by `test_restricted_builtins_*` tests |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/godoo_stateman/dsl/types/desired.py` | Frozen Pydantic `DesiredState` model | VERIFIED | `class DesiredState(BaseModel)` with `ConfigDict(frozen=True, arbitrary_types_allowed=True)`; fields: `module`, `resources`, `data_sources`, `config_parameters` all present |
| `src/godoo_stateman/dsl/types/nodes.py` | `ResourceNode`, `DataSourceNode`, `ChildrenWrapper` frozen dataclasses | VERIFIED | All three `@dataclass(frozen=True)` classes present with correct fields; `ResourceNode.parent_slug` populated by `_flatten()` |
| `src/godoo_stateman/dsl/types/deferred.py` | `Deferred` frozen dataclass and `resolve()` function | VERIFIED | `Deferred(fn: Any, deps: frozenset[str])` frozen; `resolve()` uses dual `.slug`/`.node_key` extraction; never calls fn |
| `src/godoo_stateman/errors.py` | `CycleError`, `DslEvalError`, `MissingModuleError` | VERIFIED | All three present with correct inheritance: `MissingModuleError(DslEvalError)`, `DslEvalError(StatemanError)`, `CycleError(StatemanError)` |
| `src/godoo_stateman/dsl/context.py` | DSL proxy objects + `build_dsl_namespace()` | VERIFIED | `ResourceProxy`, `DataProxy`, `OdooModuleProxy`, `ConfigParameterProxy`, `children()`, `_Collector`, `build_dsl_namespace()` all implemented; no Odoo imports |
| `src/godoo_stateman/dsl/eval.py` | `eval_config()` — exec wrapper, flatten, `DesiredState` construction | VERIFIED | `_SAFE_BUILTINS` excludes `__import__`, `open`, `eval`, `exec`; `_flatten()` strips `ChildrenWrapper` and promotes children; `eval_config()` raises `MissingModuleError` when `module` absent; checks `exec_locals` before `exec_globals` (Pitfall 2) |
| `src/godoo_stateman/dsl/normalize.py` | `normalize(state, snapshot)` stage | VERIFIED | `_normalize_value()` branches on ttype; `normalize()` returns state unchanged when `snapshot=None`; uses `dataclasses.replace()` to produce new `ResourceNode` instances |
| `src/godoo_stateman/dsl/graph.py` | `build_graph(state) -> nx.DiGraph`; raises `CycleError` on cycle | VERIFIED | Three edge sources (parent→child, Deferred.deps, direct `.slug` refs); `nx.find_cycle()` wrapped in `try/except nx.NetworkXNoCycle`; cycle path reconstructed as `" -> ".join(...)` |
| `src/godoo_stateman/cli/commands/plan.py` | Updated plan stub wired to `eval_config()` | VERIFIED | Accepts `config: Path` arg; calls `eval_config(config)`; prints module/resource summary; handles `DslEvalError`; exits code 1 (stub, Phase 3 not yet implemented) |
| `tests/unit/dsl/test_deferred.py` | 7 unit tests for `resolve()` contract | VERIFIED | 7 tests present and passing: `test_resolve_returns_deferred`, `test_resolve_never_calls_fn`, `test_resolve_deps_from_resource_slug`, `test_resolve_deps_from_data_source_node_key`, `test_resolve_empty_refs`, `test_deferred_is_frozen`, `test_deferred_deps_type` |
| `tests/unit/dsl/test_eval.py` | 11 unit tests covering CORE-01, RSRC-01 through RSRC-07 | VERIFIED | 11 tests present and passing; covers `resource`, `data`, `with` block, `mail.config`, walrus `:=`, restricted builtins (import blocked, open blocked), `MissingModuleError`, module extraction, children flatten, purity |
| `tests/unit/dsl/test_normalize.py` | 17 unit tests for CORE-02, CORE-08, SC-2 | VERIFIED | 17 tests present and passing; covers all ttype branches, boolean preservation, m2m sorting, m2o tuple extraction, passthrough cases, `snapshot=None`, idempotency |
| `tests/unit/dsl/test_graph.py` | 11 unit tests for REL-01, REL-02, REL-07, SC-4 | VERIFIED | 11 tests present and passing; covers node creation, edge sources (direct ref, Deferred.deps, data source), parent→child, cycle detection, cycle path in message, empty graph |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `dsl/types/nodes.py` | `dsl/types/desired.py` | `DesiredState.resources: tuple[ResourceNode, ...]` | VERIFIED | `desired.py` imports `ResourceNode, DataSourceNode` from `nodes.py`; `resources: tuple[ResourceNode, ...]` field present |
| `dsl/types/deferred.py` | `dsl/types/nodes.py` | `ResourceNode.fields: dict[str, Any]` may hold `Deferred` values | VERIFIED | `Deferred` stored in resource fields dict; `build_graph()` checks `isinstance(field_val, Deferred)` |
| `dsl/context.py` | `dsl/types/nodes.py` | `ResourceProxy.__getattr__` returns `ResourceNode`; `DataProxy` returns `DataSourceNode` | VERIFIED | `context.py` imports `ResourceNode`, `DataSourceNode`, `ChildrenWrapper` from `nodes.py`; proxy callables instantiate these types |
| `dsl/eval.py` | `dsl/context.py` | `build_dsl_namespace(collector)` fills exec_globals | VERIFIED | `eval.py` imports and calls `build_dsl_namespace`; pattern confirmed |
| `dsl/eval.py` | `dsl/types/desired.py` | `eval_config` returns `DesiredState` | VERIFIED | `eval.py` imports `DesiredState`; `eval_config()` returns `DesiredState(...)` |
| `dsl/normalize.py` | `schema/snapshot.py` | `normalize` accepts `VersionedSnapshot`; reads `snapshot.models[model].fields[name].ttype` | VERIFIED | `normalize.py` imports `VersionedSnapshot`; uses `snapshot.models.get(resource.model)` and `model_schema.fields.get(field_name)` |
| `dsl/normalize.py` | `dsl/types/nodes.py` | Returns new `DesiredState` with rebuilt `ResourceNode` via `dataclasses.replace` | VERIFIED | `normalize.py` uses `dataclasses.replace(resource, fields=normalized_fields)` |
| `dsl/graph.py` | `dsl/types/nodes.py` | Iterates `state.resources`, reads `ResourceNode.slug`, `DataSourceNode.node_key`, `ResourceNode.parent_slug` | VERIFIED | `graph.py` references `resource.slug`, `data_source.node_key`, `resource.parent_slug` |
| `dsl/graph.py` | `errors.py` | Raises `CycleError` with cycle path string | VERIFIED | `graph.py` imports `CycleError`; raises it with `f"Dependency cycle detected: {cycle_str}"` |
| `cli/commands/plan.py` | `dsl/eval.py` | Plan stub calls `eval_config(config_path)` | VERIFIED | `plan.py` imports and calls `eval_config(config)` |

---

### Data-Flow Trace (Level 4)

Phase 2 contains no rendering components — all outputs are in-memory Python objects passed between pipeline stages. Data flow is verified via behavioral spot-checks below. Not applicable for static value-object modules.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CycleError raised with path on circular dependency | `build_graph(cyclic_state)` | `CycleError: Dependency cycle detected: b -> a -> b`; both slugs in message | PASS |
| normalize boolean False preserved | `_normalize_value(False, 'boolean')` | `False` (not `None`) | PASS |
| normalize char False→None | `_normalize_value(False, 'char')` | `None` | PASS |
| normalize m2m False→[] | `_normalize_value(False, 'many2many')` | `[]` | PASS |
| normalize m2m sorting | `_normalize_value([3,1,2], 'many2many')` | `[1, 2, 3]` | PASS |
| Full pipeline importable | `from godoo_stateman.dsl.eval import eval_config; from godoo_stateman.dsl.normalize import normalize; from godoo_stateman.dsl.graph import build_graph` | Imports succeed | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| CORE-01 | 02-02, 02-04 | Zero Odoo calls during DSL eval | SATISFIED | `test_eval_purity_no_odoo_calls` patches OdooClient; `eval.py` has no godoo.client import |
| CORE-02 | 02-03, 02-04 | Normalize canonicalizes False values for scalars and relation fields | SATISFIED | `_normalize_value()` covers all ttype branches; 17 normalize tests passing |
| CORE-08 | 02-03, 02-04 | Many2one → integer ID; many2many order-irrelevant | SATISFIED | `test_m2o_tuple_to_int`, `test_m2o_list_to_int`, `test_m2m_order_irrelevant` all passing |
| RSRC-01 | 02-02 | `resource.<model>(slug, **fields)` constructor | SATISFIED | `ResourceProxy` + `_ModelResourceCallable` in `context.py`; `test_resource_constructor` passing |
| RSRC-02 | 02-02 | `data.<model>(**selector)` for read-only refs | SATISFIED | `DataProxy` in `context.py`; `test_data_source` passing |
| RSRC-03 | 02-02 | `with` block + attribute assignment | SATISFIED | `_ResourceBuilder.__enter__/__setattr__` in `context.py`; `test_with_block` passing |
| RSRC-04 | 02-02 | `mail.config["key"] = "val"` sugar | SATISFIED | `OdooModuleProxy` + `ConfigParameterProxy` in `context.py`; `test_mail_config` passing |
| RSRC-05 | 02-02 | Walrus operator `:=` support | SATISFIED | Standard exec() supports walrus; `test_walrus_operator` passing |
| RSRC-06 | 02-01 | `resolve()` defers computation to read seam | SATISFIED | `Deferred` frozen dataclass + `resolve()` in `deferred.py`; 7 tests in `test_deferred.py` passing |
| RSRC-07 | 02-02 | `exec()` with restricted builtins; `__import__`, `open`, `eval` absent | SATISFIED | `_SAFE_BUILTINS` dict excludes dangerous callables; `test_restricted_builtins_blocks_import` and `test_restricted_builtins_blocks_open` passing |
| REL-01 | 02-04 | DAG built across all managed resources, inline children, data sources | SATISFIED | `build_graph()` adds nodes for all resources and data_sources; edges from three sources; 11 graph tests passing |
| REL-02 | 02-04 | Cycle detection with path before Odoo mutation | SATISFIED | `nx.find_cycle()` → `CycleError` with path string; tested by `test_cycle_detection` + `test_cycle_error_contains_path` |
| REL-07 | 02-04 | Inline One2many children participate in cycle detection | SATISFIED | `_flatten()` sets `parent_slug`; `build_graph()` adds parent→child edges; `test_parent_child_edge` + `test_children_participate_in_cycle` passing |

---

### Anti-Patterns Found

No debt markers (TBD, FIXME, XXX) found in Phase 2 source files. No stub implementations — all proxy objects, normalizers, graph builder, and evaluator contain real logic. No hardcoded empty returns in production code paths.

Notable observation: `_ResourceBuilder._node` is accessed directly in `children()` (`item._node`) — this is an intentional internal coupling documented in context.py's design notes, not a stub.

---

### Human Verification Required

None. All Phase 2 behaviors are fully verifiable programmatically:

- DSL evaluation is pure in-process Python (no UI, no real-time behavior, no external service).
- Normalize correctness is fully covered by field-type branching tests.
- Cycle detection raises a deterministic exception with a deterministic message.

---

### Probe Execution

No probes declared in any Phase 2 plan file. No `scripts/*/tests/probe-*.sh` files found matching Phase 2. Skipped.

---

## Summary

Phase 2 goal is fully achieved. All 5 success criteria pass against the actual codebase:

1. **DSL eval purity (SC-1)**: `eval_config()` evaluates `.py` configs with all required DSL surface forms into a `DesiredState` tree; zero Odoo calls proven by `test_eval_purity_no_odoo_calls` with OdooClient patched to raise on any instantiation.

2. **Normalize idempotency (SC-2)**: `normalize()` converts `False`→`None` for scalars, `False`→`[]` for relation fields, preserves `False` for boolean ttype (A1 decision), extracts integer from m2o tuples, and sorts m2m lists. Two-pass application produces identical output.

3. **Inline children in DAG (SC-3/REL-07)**: `_flatten()` sets `parent_slug` on promoted child nodes; `build_graph()` adds parent→child edges; children participate in cycle detection (`test_children_participate_in_cycle` closes a cycle through parent→child and child→parent via Deferred.deps).

4. **Cycle detection (SC-4/REL-02)**: `build_graph()` raises `CycleError` with the full cycle path (e.g., `"Dependency cycle detected: b -> a -> b"`) before any Odoo call.

5. **resolve() design (SC-5/RSRC-06)**: `Deferred` is a frozen dataclass; `resolve()` never calls fn; deps drive DAG edges; documented in module docstring; 7 unit tests confirm all contracts.

**Test suite:** 88 total unit tests passing (46 DSL-specific: 7 deferred + 11 eval + 11 graph + 17 normalize). Ruff and mypy --strict clean on all 26 source files.

---

_Verified: 2026-05-26T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
