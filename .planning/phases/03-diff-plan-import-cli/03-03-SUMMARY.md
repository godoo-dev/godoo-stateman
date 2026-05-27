---
phase: 03-diff-plan-import-cli
plan: "03"
subsystem: diff-engine
tags:
  - diff
  - pure-function
  - tdd
  - pydantic
  - normalization
dependency_graph:
  requires:
    - 03-01  # DSL rename D-05; DesiredState.xmlid_prefix
    - 03-02  # plan/types.py (PlanStep/PlanAction/FieldDiff); live/livestate.py (LiveState)
  provides:
    - diff-engine  # diff() pure function → list[PlanStep]
  affects:
    - 03-04  # plan render + CLI commands consume diff() output
    - 03-05  # import command; acceptance tests consume plan pipeline
tech_stack:
  added: []
  patterns:
    - "Pure synchronous function (no async, no I/O)"
    - "VersionedSnapshot sync dict access for field schema lookup"
    - "_normalize_value() applied to live field values before comparison"
    - "TDD: RED commit then GREEN commit"
key_files:
  created:
    - tests/unit/test_diff.py
    - src/godoo_stateman/diff.py
  modified: []
decisions:
  - "diff() is a pure synchronous function with no client parameter — I/O is structurally impossible (D-01 hard constraint)"
  - "Live field values normalized via _normalize_value() from dsl/normalize.py before comparison to avoid false-positive diffs on m2o/m2m fields (Pitfall 1)"
  - "Non-stored (store=False) and readonly fields excluded from comparison to prevent spurious diffs on computed fields (Pitfall 2)"
  - "effective_prefix = resource.xmlid_module or state.xmlid_prefix for per-resource xmlid override support (Pitfall 3)"
  - "Delete/Archive candidates sorted by slug for deterministic output (SC-2)"
  - "ternary for ARCHIVE/DELETE action selection (ruff SIM108 compliance)"
metrics:
  duration: "246s"
  completed_date: "2026-05-27"
  tasks: 2
  files: 2
---

# Phase 3 Plan 3: Diff Engine Summary

**One-liner:** Pure synchronous diff() function classifying Create/Update/NoOp/Delete/Archive/Reject using _normalize_value() on live values against VersionedSnapshot schema.

## What Was Built

### Task 1: test_diff.py — TDD spec (RED)

`tests/unit/test_diff.py` — 13 test functions covering all 6 PlanActions and all three Pitfalls. Written before `diff.py` existed (confirmed RED: `ModuleNotFoundError` on collection). Tests are synchronous (diff() is sync), offline (no Docker), and verify the purity invariant via `inspect.signature(diff)`.

**Test coverage:**
- `test_create_on_no_xmlid` — CREATE when slug absent from managed (D-01)
- `test_reject_on_xmlid_collision` — REJECT when xmlid maps to different model (D-02/SAFE-03)
- `test_noop_on_identical_fields` — NOOP when desired == live
- `test_update_on_changed_field` — UPDATE with correct FieldDiff when field differs
- `test_m2o_no_false_positive` — live [1,"Belgium"] vs desired 1 → NOOP (Pitfall 1/REL-03)
- `test_m2m_datasource_resolved` — live [3,1,2] vs desired [1,2,3] → NOOP (REL-04)
- `test_non_store_field_excluded` — store=False field never in FieldDiff (Pitfall 2)
- `test_xmlid_collision_produces_reject` — collision never becomes CREATE (SAFE-03)
- `test_managed_set_absent_archivable` — absent managed + archivable model → ARCHIVE
- `test_managed_set_absent_non_archivable` — absent managed + non-archivable → DELETE
- `test_per_resource_xmlid_prefix_override` — resource.xmlid_module override respected (Pitfall 3)
- `test_diff_is_pure_no_client_calls` — asserts diff() signature has no 'client' param
- `test_multiple_resources_mixed_actions` — all 4 action types in one call

### Task 2: diff.py — implementation (GREEN)

`src/godoo_stateman/diff.py` — pure synchronous `diff()` function.

**Algorithm:**
1. Build `desired_slugs` set.
2. For each `ResourceNode` in `state.resources`:
   - Compute `effective_prefix = resource.xmlid_module or state.xmlid_prefix` (Pitfall 3)
   - Look up `live_state.managed.get(resource.slug)` — None → CREATE (D-01)
   - `record.model != resource.model` → REJECT (D-02)
   - Else: compare each desired field against live value; skip non-stored/readonly (Pitfall 2); normalize both sides with `_normalize_value()` (Pitfall 1); collect `FieldDiff`s → UPDATE or NOOP
3. For slugs in managed but absent from desired (sorted): archivable → ARCHIVE, else → DELETE

## Verification Results

```
uv run pytest tests/unit/test_diff.py -x -q
.............  13 passed
uv run pytest -m "not integration" -q
120 passed
uv run mypy src/godoo_stateman/diff.py --ignore-missing-imports
Success: no issues found in 1 source file
uv run ruff check src/godoo_stateman/diff.py tests/unit/test_diff.py
All checks passed!
```

No runtime `client`/`search_read`/`registry` references in diff.py code (docstrings only — verified via AST analysis).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Unused imports in test_diff.py**
- **Found during:** Ruff check after GREEN commit
- **Issue:** `pytest` and `FieldDiff` were imported but unused in test_diff.py
- **Fix:** Removed unused imports; `pytest` not needed (sync tests, no marks used); `FieldDiff` referenced in docstring only
- **Files modified:** tests/unit/test_diff.py
- **Commit:** f73b411 (included in GREEN commit)

**2. [Rule 1 - Style] Ternary for ARCHIVE/DELETE (SIM108)**
- **Found during:** Ruff check after initial diff.py write
- **Issue:** `if/else` block flagged by ruff SIM108
- **Fix:** Converted to ternary operator `action = PlanAction.ARCHIVE if ... else PlanAction.DELETE`
- **Files modified:** src/godoo_stateman/diff.py
- **Commit:** f73b411 (included in GREEN commit)

## Known Stubs

None — diff() is fully implemented. No hardcoded empty values, no placeholder text, no TODO markers.

## Threat Flags

No new threat surface introduced. diff() is a pure function with no network endpoints, no file access, and no auth paths. The `_normalize_value()` boundary (live Odoo field values → diff engine) was already in the threat model as T-03-08; mitigation is implemented (non-stored/readonly fields excluded).

## Self-Check

Checking created files exist:
- tests/unit/test_diff.py: FOUND
- src/godoo_stateman/diff.py: FOUND

Checking commits exist:
- 0a0c3e7 (test RED): FOUND
- f73b411 (feat GREEN): FOUND
