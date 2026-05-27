---
phase: "03"
plan: "02"
subsystem: live-layer
tags: [plan-types, livestate, read-seam, deferred, tdd, odoo-fetch]
dependency_graph:
  requires: [03-01]
  provides: [plan-types, live-layer, read-seam]
  affects: [03-03, 03-04]
tech_stack:
  added: []
  patterns: [frozen-pydantic-model, frozen-dataclass, tdd-red-green, dataclasses-replace, async-search-read]
key_files:
  created:
    - src/godoo_stateman/plan/__init__.py
    - src/godoo_stateman/plan/types.py
    - src/godoo_stateman/live/__init__.py
    - src/godoo_stateman/live/livestate.py
    - src/godoo_stateman/live/seam.py
    - tests/unit/test_seam.py
  modified: []
decisions:
  - "LiveState uses @dataclass(frozen=True) not Pydantic — internal pipeline object, not serialized artifact"
  - "resolve_deferred sorts deps for deterministic fn argument order (SC-2)"
  - "live_fields keyed by res_id (int) so diff stage can look up by XmlIdRecord.res_id directly"
  - "DataSourceNode domain built with sorted(selector.items()) — equality-only for Phase 3 (A3)"
metrics:
  duration: "7m"
  completed: "2026-05-27"
  tasks: 3
  files: 6
---

# Phase 03 Plan 02: Plan Types + Live Layer Summary

**One-liner:** Frozen `PlanAction`/`FieldDiff`/`PlanStep` contracts plus read-only `LiveState.fetch()` and `resolve_data_sources()`/`resolve_deferred()` seam layer implemented TDD-first.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create plan/types.py — PlanAction, FieldDiff, PlanStep | 211d91c | plan/__init__.py, plan/types.py |
| 2 | Write test_seam.py — TDD spec (RED) for live layer | 88bbf20 | live/__init__.py, tests/unit/test_seam.py |
| 3 | Implement live/livestate.py and live/seam.py (GREEN) | 0f00cb0 | live/livestate.py, live/seam.py |

## What Was Built

### Task 1: plan/types.py

`PlanAction(str, Enum)` with 6 members: `CREATE`, `UPDATE`, `NOOP`, `DELETE`, `ARCHIVE`, `REJECT`. `str` mixin enables JSON-serializable and Rich-printable enum values.

`FieldDiff(BaseModel)` with `ConfigDict(frozen=True)` and three fields: `field_name`, `old_value`, `new_value`.

`PlanStep(BaseModel)` with `ConfigDict(frozen=True)` and six fields: `action`, `slug`, `model`, `xmlid`, `res_id` (`int | None` — None for CREATE), `field_diff` (`tuple[FieldDiff, ...]` — empty for non-UPDATE). Uses `tuple` not `list` for frozen collection consistency with `DesiredState`.

### Task 2: test_seam.py (TDD RED)

10 test functions covering the full live layer contract before any implementation:
- 4 `LiveState.fetch` tests: batch grouping, per-model query separation, slug-keyed managed dict, explicit `fields=`/`order=` on every call
- 3 `resolve_data_sources` tests: happy path, 0-record `LiveStateFetchError`, 2-record `LiveStateFetchError` (Pitfall 5)
- 2 `resolve_deferred` tests: `Deferred.fn` fires with correct args (REL-04), no-mutation guarantee (Pitfall 7)
- 1 non-Deferred passthrough test

### Task 3: live/livestate.py and live/seam.py (TDD GREEN)

`LiveState.fetch()` — two-phase async class method:
1. `search_read("ir.model.data", [("module","=",xmlid_prefix)], fields=["name","model","res_id"], order="name")` → `managed: dict[str, XmlIdRecord]`
2. Group res_ids by model; for each model: `search_read(model, [("id","in",sorted(res_ids))], fields=["id"]+sorted(desired_fields), order="id")` → `live_fields: dict[int, dict[str, Any]]`

`resolve_data_sources()` — async; builds equality domain from `sorted(selector.items())`; uses `limit=2` for ambiguity detection; raises `LiveStateFetchError` when `len(records) != 1`.

`resolve_deferred()` — synchronous; iterates `resource.fields`, fires `Deferred.fn(*[seam_result[dep] for dep in sorted(fval.deps)])` for Deferred values; copies non-Deferred unchanged; returns new `ResourceNode` via `dataclasses.replace` — never mutates original.

## Verification Results

```
uv run pytest tests/unit/test_seam.py -v   → 10 passed
uv run pytest -m "not integration" -q      → 107 passed, 6 deselected
uv run mypy src/godoo_stateman/plan/ src/godoo_stateman/live/ --ignore-missing-imports → Success: no issues
```

All imports verified:
```python
from godoo_stateman.plan.types import PlanAction, PlanStep
from godoo_stateman.live.livestate import LiveState
from godoo_stateman.live.seam import resolve_data_sources, resolve_deferred
# → all imports ok
```

## Deviations from Plan

None — plan executed exactly as written.

TDD gate sequence verified:
1. `test(03-02)` commit (RED) — 88bbf20
2. `feat(03-02)` commit (GREEN) — 0f00cb0

## Known Stubs

None. Both `live/` modules are fully implemented and tested. `plan/types.py` is pure data types — no stub data flows.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what the plan's threat model covers. `LiveState.fetch()` is read-only as specified (T-03-02, T-03-03, T-03-04). Domain injection mitigation applied in `resolve_data_sources` via sorted equality tuples (T-03-05).

## Self-Check: PASSED

Files exist:
- src/godoo_stateman/plan/__init__.py — FOUND
- src/godoo_stateman/plan/types.py — FOUND
- src/godoo_stateman/live/__init__.py — FOUND
- src/godoo_stateman/live/livestate.py — FOUND
- src/godoo_stateman/live/seam.py — FOUND
- tests/unit/test_seam.py — FOUND

Commits exist:
- 211d91c — feat(03-02): add plan/types.py — FOUND
- 88bbf20 — test(03-02): add test_seam.py TDD spec (RED) — FOUND
- 0f00cb0 — feat(03-02): implement live/livestate.py and live/seam.py (GREEN) — FOUND
