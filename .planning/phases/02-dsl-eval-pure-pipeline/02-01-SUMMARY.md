---
phase: 02-dsl-eval-pure-pipeline
plan: "01"
subsystem: dsl
tags: [pydantic, networkx, dataclasses, frozen, deferred, dependency-dag]

# Dependency graph
requires:
  - phase: 01-bootstrap-schema-registry
    provides: errors.py hierarchy, frozen Pydantic pattern, frozen dataclass pattern, pyproject.toml with uv workspace

provides:
  - networkx>=3.6.1 promoted to runtime dependency in [project.dependencies]
  - DslEvalError, MissingModuleError, CycleError error subclasses in errors.py
  - Deferred frozen dataclass and resolve() factory with slug/node_key dual extraction
  - ResourceNode, DataSourceNode, ChildrenWrapper frozen dataclasses
  - DesiredState frozen Pydantic model with arbitrary_types_allowed=True
  - 7-test suite for resolve() contract (RSRC-06 / D-04/D-05)

affects:
  - 02-02-dsl-eval (imports ResourceNode, DataSourceNode, DesiredState, Deferred, resolve)
  - 02-03-normalize (imports DesiredState, ResourceNode)
  - 02-04-graph (imports DesiredState, ResourceNode, DataSourceNode, Deferred, CycleError)

# Tech tracking
tech-stack:
  added:
    - networkx>=3.6.1 (runtime — DAG construction in graph.py)
  patterns:
    - "Frozen Pydantic BaseModel with arbitrary_types_allowed=True for pipeline tokens holding callable-bearing dataclasses"
    - "@dataclass(frozen=True) for pure value objects that do not need JSON serialization"
    - "resolve() slug-first / node_key-fallback pattern for DAG edge extraction from heterogeneous refs"
    - "fn: Any (not Callable[..., Any]) on Deferred to avoid PydanticSchemaGenerationError in nested field storage"

key-files:
  created:
    - src/godoo_stateman/dsl/__init__.py
    - src/godoo_stateman/dsl/types/__init__.py
    - src/godoo_stateman/dsl/types/deferred.py
    - src/godoo_stateman/dsl/types/nodes.py
    - src/godoo_stateman/dsl/types/desired.py
    - tests/unit/dsl/__init__.py
    - tests/unit/dsl/test_deferred.py
  modified:
    - pyproject.toml
    - src/godoo_stateman/errors.py
    - uv.lock

key-decisions:
  - "networkx is a runtime dependency (not dev-only) — must be in [project.dependencies] for end-user pip installs"
  - "fn field on Deferred is typed Any not Callable[..., Any] — Callable annotation triggers PydanticSchemaGenerationError when Deferred is stored in ResourceNode.fields inside a frozen Pydantic model"
  - "resolve() extracts .slug first (ResourceNode) then .node_key (DataSourceNode) — single-slug-only variant would silently drop DataSourceNode refs from the DAG"
  - "DesiredState uses tuple[...] not list[...] for collection fields — frozen=True only freezes attribute rebinding, tuples prevent accidental append"
  - "arbitrary_types_allowed=True on DesiredState is mandatory — ResourceNode.fields may hold Deferred whose fn carries a callable"

patterns-established:
  - "Pattern: Frozen Pydantic + arbitrary_types_allowed=True for pipeline tokens that hold heterogeneous field values"
  - "Pattern: @dataclass(frozen=True) for value objects, Pydantic BaseModel for serializable pipeline tokens"
  - "Pattern: resolve() dual-attribute extraction (slug then node_key) — DataSourceNode refs must not be dropped"

requirements-completed:
  - CORE-01
  - RSRC-06
  - RSRC-07
  - REL-01

# Metrics
duration: 8min
completed: 2026-05-26
---

# Phase 02 Plan 01: Foundation Types Summary

**Frozen DSL type vocabulary (DesiredState, ResourceNode, DataSourceNode, Deferred + resolve()) with networkx runtime dep and 7-test RSRC-06 contract suite**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-26T00:00:00Z
- **Completed:** 2026-05-26T00:00:00Z
- **Tasks:** 2
- **Files modified:** 10 (9 created, 1 modified + uv.lock)

## Accomplishments

- Promoted networkx>=3.6.1 to [project.dependencies] so end-user pip installs can use graph.py
- Extended errors.py with DslEvalError, MissingModuleError (subclasses DslEvalError), CycleError (subclasses StatemanError)
- Created the full dsl/types/ package: Deferred + resolve(), ResourceNode/DataSourceNode/ChildrenWrapper, DesiredState
- All 7 test_deferred.py tests pass; ruff and mypy clean on new code

## Task Commits

1. **Task 1: Add networkx runtime dep + extend errors.py** - `cbc6ab5` (feat)
2. **Task 2: Create dsl/types/ package + unit tests** - `0dddd06` (feat)

## Files Created/Modified

- `pyproject.toml` - Moved networkx>=3.6.1 from dev group to [project.dependencies]; removed from dev group
- `uv.lock` - Updated by uv sync after pyproject.toml change
- `src/godoo_stateman/errors.py` - Appended DslEvalError, MissingModuleError, CycleError
- `src/godoo_stateman/dsl/__init__.py` - Package marker with module docstring
- `src/godoo_stateman/dsl/types/__init__.py` - Package marker with module docstring
- `src/godoo_stateman/dsl/types/deferred.py` - Deferred frozen dataclass + resolve() with dual slug/node_key extraction
- `src/godoo_stateman/dsl/types/nodes.py` - ResourceNode, DataSourceNode, ChildrenWrapper frozen dataclasses
- `src/godoo_stateman/dsl/types/desired.py` - DesiredState frozen Pydantic model with arbitrary_types_allowed=True
- `tests/unit/dsl/__init__.py` - Empty package marker
- `tests/unit/dsl/test_deferred.py` - 7 tests covering resolve() contract (RSRC-06 / D-04/D-05)

## Decisions Made

- `fn: Any` (not `Callable[..., Any]`) on `Deferred` — `Callable` annotation causes `PydanticSchemaGenerationError` at schema-build time when `Deferred` is stored in `ResourceNode.fields` inside a frozen Pydantic model.
- `resolve()` uses slug-first / node_key-fallback — a single-slug-only variant silently drops `DataSourceNode` refs from the DAG, causing `test_deferred_data_source_edge` (02-04) to fail.
- `arbitrary_types_allowed=True` is mandatory on `DesiredState` — without it, Pydantic cannot build the schema for a model holding `ResourceNode` whose `fields` dict may carry `Deferred`.
- `tuple[...]` not `list[...]` for DesiredState collection fields — prevents accidental mutation since `frozen=True` only freezes attribute rebinding.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All foundation types are importable and tested; 02-02 (DSL eval: context.py + eval.py) can proceed immediately
- Wave 1 complete; Wave 2 (02-02 and 02-03) unblocked

---
*Phase: 02-dsl-eval-pure-pipeline*
*Completed: 2026-05-26*

## Self-Check: PASSED

- `src/godoo_stateman/dsl/types/deferred.py` — FOUND
- `src/godoo_stateman/dsl/types/nodes.py` — FOUND
- `src/godoo_stateman/dsl/types/desired.py` — FOUND
- `src/godoo_stateman/errors.py` — FOUND (extended)
- `tests/unit/dsl/test_deferred.py` — FOUND
- Task 1 commit cbc6ab5 — FOUND
- Task 2 commit 0dddd06 — FOUND
