---
phase: 02-dsl-eval-pure-pipeline
plan: "03"
subsystem: dsl
tags: [pydantic, dataclasses, normalize, schema-driven, many2one, many2many, boolean]

# Dependency graph
requires:
  - phase: 02-dsl-eval-pure-pipeline
    plan: "01"
    provides: "DesiredState, ResourceNode, DataSourceNode types"
  - phase: 01-bootstrap-schema-registry
    provides: "VersionedSnapshot, VersionedFieldSchema with ttype field"
provides:
  - normalize() function in godoo_stateman.dsl.normalize
  - _normalize_value() helper — schema-driven field value canonicalization
  - 17 unit tests covering CORE-02, CORE-08, SC-2, and A1 boolean carve-out
affects: [02-04, 03-diff]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ttype-branched normalization: m2x→sorted-list, m2o→int, boolean→preserve, scalar→None"
    - "dataclasses.replace() for producing new frozen nodes without mutation"
    - "_make_snapshot_with_field() fixture helper for schema-driven unit tests"

key-files:
  created:
    - src/godoo_stateman/dsl/normalize.py
    - tests/unit/dsl/test_normalize.py
  modified: []

key-decisions:
  - "A1 (RESOLVED): boolean ttype is exempted from False→None scalar rule; active=False preserved as False for archive intent detection in diff stage"
  - "value: Any parameter on _normalize_value (not object) to avoid mypy call-overload error on sorted(list(value)) — Any is correct here since field values are inherently untyped"
  - "snapshot=None returns state unchanged as documented skip path — schema-dependent rules cannot run without ttype metadata"

patterns-established:
  - "Normalize helper _make_snapshot_with_field(model, field_name, ttype) for lightweight schema fixtures in test_normalize.py"
  - "_normalize_value() branches ttype BEFORE boolean carve-out before scalar fallback — order is critical"

requirements-completed:
  - CORE-02
  - CORE-08

# Metrics
duration: 3min
completed: "2026-05-26"
---

# Phase 02 Plan 03: Normalize Stage Summary

**Schema-driven field value canonicalization: False→None for scalars, False→[] for relations, (id,name) tuple→int for many2one, sorted list for many2many — with boolean False preserved as archive intent marker**

## Performance

- **Duration:** 2m 37s
- **Started:** 2026-05-26T14:04:40Z
- **Completed:** 2026-05-26T14:07:17Z
- **Tasks:** 1 (TDD: RED commit + GREEN commit)
- **Files modified:** 2

## Accomplishments

- `normalize(state, snapshot)` correctly applies CORE-02 (False→canonical) and CORE-08 (m2o tuple→int, m2m sorted) using `VersionedFieldSchema.ttype`
- A1 boolean carve-out: `active=False` survives normalization unchanged, enabling the diff stage to detect archive intent
- All 17 unit tests pass; both `ruff check` and `mypy` pass clean with no suppressed errors

## Task Commits

TDD task had two commits:

1. **RED: add failing tests** - `bfdc1e7` (test)
2. **GREEN: implement normalize stage** - `5d39bb1` (feat)

## Files Created/Modified

- `src/godoo_stateman/dsl/normalize.py` — public `normalize()` and private `_normalize_value()` with schema-driven branching
- `tests/unit/dsl/test_normalize.py` — 17 unit tests (CORE-02, CORE-08, SC-2, A1 decision)

## Decisions Made

- **value: Any on `_normalize_value`** — `object` caused mypy `call-overload` errors on `sorted(list(value))` after the `is False or is None` guard; `Any` is correct since field values are dict[str, Any] throughout the pipeline.
- **_M2X_TYPES module-level constant** — `frozenset({"many2many", "one2many"})` extracted as named constant for readability and to avoid repeated inline set construction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ruff SIM108: if/else block replaced with ternary**
- **Found during:** Task 1 static analysis
- **Issue:** `field_schema = model_schema.fields.get(...) if ... else None` written as if/else block
- **Fix:** Collapsed to inline ternary per ruff SIM108 recommendation
- **Files modified:** `src/godoo_stateman/dsl/normalize.py`
- **Verification:** `ruff check` passes
- **Committed in:** `5d39bb1` (part of GREEN commit)

**2. [Rule 1 - Bug] mypy: value parameter typed Any instead of object**
- **Found during:** Task 1 static analysis
- **Issue:** `value: object` caused `call-overload` and `unused-ignore` mypy errors on `sorted(list(value))` and `int(value[0])` — mypy cannot narrow `object` through `is False`/`isinstance` guards to Iterable/Sequence
- **Fix:** Changed `_normalize_value(value: object, ...)` to `_normalize_value(value: Any, ...)` and removed stale `type: ignore` comments
- **Files modified:** `src/godoo_stateman/dsl/normalize.py`
- **Verification:** `mypy src/godoo_stateman/` reports "Success: no issues found in 25 source files"
- **Committed in:** `5d39bb1` (part of GREEN commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs found during static analysis)
**Impact on plan:** Both auto-fixes necessary for clean ruff and mypy gates. No scope change.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `normalize()` is ready for wiring into the pipeline after `eval_config()` and before `build_graph()`
- Plan 02-04 (`build_graph` + `CycleError` + NetworkX DAG) can proceed immediately — normalize is independent of graph construction
- Phase 3 (diff stage) can use normalized `DesiredState` directly; canonical form matches what live Odoo `read()` returns after normalization

---
*Phase: 02-dsl-eval-pure-pipeline*
*Completed: 2026-05-26*
