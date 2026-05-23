---
phase: 01-bootstrap-schema-registry
plan: "03"
subsystem: identity
tags: [identity, xmlid, ir.model.data, find_by_xmlid, write_xmlid, acceptance-tests]
dependency_graph:
  requires:
    - godoo.client.client.OdooClient (search_read, create, write)
    - godoo.client.errors.OdooValidationError
    - godoo.testcontainers.TestHarness (acceptance tests)
    - godoo_stateman.schema.registry.SchemaRegistry (acceptance tests, existing fixture)
  provides:
    - godoo_stateman.identity.XmlIdRecord
    - godoo_stateman.identity.find_by_xmlid
    - godoo_stateman.identity.write_xmlid
  affects:
    - All downstream phases (import command, apply stage) use identity.py as the sole ir.model.data I/O mechanism
    - Phase 1 success criterion 4 now satisfied (round-trip against real Odoo 17)
tech_stack:
  added: []
  patterns:
    - frozen dataclass for immutable identity records (XmlIdRecord)
    - TYPE_CHECKING guard for OdooClient import (matches registry.py pattern)
    - find_by_xmlid returns None on absence — never raises (contrast with OdooClient.ref())
    - write_xmlid idempotent upsert with model-mismatch guard (T-03-01 mitigation)
    - unittest.mock.AsyncMock for OdooClient in unit tests (no Docker, no respx)
    - int() coercion on res_id from search_read (T-03-02 mitigation)
key_files:
  created:
    - src/godoo_stateman/identity.py
    - tests/unit/test_identity.py
  modified:
    - tests/acceptance/test_snapshot.py (2 integration tests appended)
    - .gitignore (.odoo-testcontainers/ added)
decisions:
  - "find_by_xmlid returns None on absence — never raises OdooMissingError (D-14)"
  - "write_xmlid model-mismatch guard raises OdooValidationError (Open Question Q3 RESOLVED)"
  - "complete_name constructed in Python as f'{module}.{name}' — not fetched from Odoo (Open Question Q1 RESOLVED)"
  - "noupdate=True on create — stateman-owned xmlids survive module upgrades (T-03-03 accepted)"
  - "Second search_read in write_xmlid update path fetches fields=['id'] to get ir.model.data row PK — not res_id"
metrics:
  duration: "4m 19s"
  completed_date: "2026-05-23"
  tasks_completed: 2
  files_created: 2
  files_modified: 2
---

# Phase 01 Plan 03: xmlid Helpers (find_by_xmlid, write_xmlid) Summary

Frozen `XmlIdRecord` dataclass plus `find_by_xmlid` (None-on-absent, never raises) and `write_xmlid` (idempotent upsert with model-mismatch guard) backed by 14 unit tests (mocked) and 2 acceptance tests verified against real Odoo 17 `ir.model.data`.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | xmlid helpers + unit tests | 3395829 | src/godoo_stateman/identity.py, tests/unit/test_identity.py |
| 2 | xmlid acceptance test — round-trip against real ir.model.data | 17db2c6 | tests/acceptance/test_snapshot.py (2 tests appended) |

## Verification Evidence

- `uv run pytest tests/unit/ -x -q` — 41 tests, all pass (0.39s, no Docker); was 27, +14 identity tests
- `uv run pytest tests/unit/test_identity.py -v` — 14 tests, all pass; covers all contract cases
- `uv run pytest tests/acceptance/test_snapshot.py::test_xmlid_round_trip tests/acceptance/test_snapshot.py::test_xmlid_idempotent -v -m integration` — 2 integration tests pass in 14.39s against real Odoo 17
- All 6 acceptance tests collected in `test_snapshot.py` (4 existing + 2 new)
- `uv run pytest -m "not integration" -x -q` — exits 0 with no Docker dependency

## Deviations from Plan

**[Rule 2 - Auto-add missing critical functionality] Added .odoo-testcontainers/ to .gitignore**
- **Found during:** Task 2 (after running integration tests)
- **Issue:** Running integration tests generated a `.odoo-testcontainers/` directory (testcontainers Docker snapshot state) that was left untracked
- **Fix:** Added `.odoo-testcontainers/` to `.gitignore` to prevent accidental commits of runtime container state
- **Files modified:** `.gitignore`

## Known Stubs

Inherited from prior plans (unchanged):

| File | Content | Reason |
|------|---------|--------|
| src/godoo_stateman/cli/commands/plan.py | Prints "plan: not yet implemented (Phase 3)" + Exit(1) | Inherited stub from plan 01 |
| src/godoo_stateman/cli/commands/apply.py | Prints "apply: not yet implemented (Phase 4)" + Exit(1) | Inherited stub from plan 01 |
| src/godoo_stateman/cli/commands/verify.py | Prints "verify: not yet implemented (Phase 5)" + Exit(1) | Inherited stub from plan 01 |
| src/godoo_stateman/cli/commands/import_.py | Prints "import: not yet implemented (Phase 3)" + Exit(1) | Inherited stub from plan 01 |
| src/godoo_stateman/cli/commands/snapshot.py | Hardcoded `_PHASE1_MODELS = ["project.project", "res.partner"]` | Phase 1 spec; real config enumeration comes in Phase 3 |

All stubs are intentional Phase 1 placeholders; none affect plan 03's goals.

## Threat Surface Scan

All threats from the plan's STRIDE register were mitigated as implemented:

| Threat ID | Mitigation | Implemented |
|-----------|-----------|-------------|
| T-03-01 | Model-mismatch guard in write_xmlid | Yes — `if existing.model != model: raise OdooValidationError(...)` |
| T-03-02 | int() coercion on res_id after confirming non-empty results | Yes — `int(r["res_id"])` in find_by_xmlid only when `records` is non-empty |
| T-03-03 | noupdate=True on create | Yes — `{"noupdate": True}` in create payload |
| T-03-SC | No new packages added | Confirmed — identity.py uses only godoo-py and stdlib |

## Self-Check: PASSED

- [x] src/godoo_stateman/identity.py exists — XmlIdRecord, find_by_xmlid, write_xmlid
- [x] tests/unit/test_identity.py exists — 14 passing tests
- [x] tests/acceptance/test_snapshot.py contains test_xmlid_round_trip and test_xmlid_idempotent
- [x] 41 total unit tests pass (0 failures)
- [x] 2 integration tests pass against real Odoo 17 (Docker)
- [x] Commits 3395829 and 17db2c6 exist in git log
- [x] .gitignore updated to exclude .odoo-testcontainers/
- [x] Phase 1 success criterion 4 (xmlid round-trip against real ir.model.data) satisfied
