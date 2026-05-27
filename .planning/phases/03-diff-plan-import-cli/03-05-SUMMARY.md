---
phase: 03-diff-plan-import-cli
plan: 05
subsystem: cli
tags: [odoo, jsonrpc, ir.model.data, import, xmlid, testcontainers, typer, asyncio]

# Dependency graph
requires:
  - phase: 03-04
    provides: "fully wired read-only plan command (livestate, seam, diff, render)"
  - phase: 03-01
    provides: "DesiredState.xmlid_prefix (D-05 rename); XmlidCollisionError/LiveStateFetchError"
  - phase: 01-03
    provides: "find_by_xmlid / write_xmlid identity helpers against ir.model.data"
provides:
  - "Full import command (replaces stub) — the only command that writes to Odoo"
  - "D-11 validate-before-write flow: search_read existence check -> find_by_xmlid collision check -> write_xmlid"
  - "Idempotent re-import (IDENT-05) and --force collision guard (SAFE-03)"
  - "Live-Odoo acceptance suite covering SC-1..SC-5 + META-01 against vanilla Odoo 17 CE"
affects: [phase-04-apply, phase-05-verify]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "import command opens its OWN OdooClient from GODOO_* env vars (mirrors plan.py credential pattern)"
    - "acceptance tests mirror TestHarness url/db/admin into GODOO_* via monkeypatch so the CLI command targets the same container"
    - "autouse-style cleanup fixture unlinks all test-prefix ir.model.data rows after each test"

key-files:
  created:
    - tests/acceptance/test_plan_import.py
    - .planning/phases/03-diff-plan-import-cli/deferred-items.md
  modified:
    - src/godoo_stateman/cli/commands/import_.py
    - tests/unit/test_import_command.py
    - tests/unit/test_cli_help.py

key-decisions:
  - "import command reads credentials only from GODOO_* env vars (T-03-16), never CLI args"
  - "id_ > 0 validated in the Typer wrapper before any Odoo call (T-03-14)"
  - "acceptance import tests derive GODOO_* from TestHarness.url/_database + admin/admin so _import_impl's own client hits the same container"
  - "5 pre-existing ruff issues in prior-wave files logged to deferred-items.md, not fixed (SCOPE BOUNDARY)"

patterns-established:
  - "validate-before-write (D-11): confirm record exists, then check binding, then write — no blind upsert"
  - "no silent clobber (SAFE-03): different-res_id collision prints an actionable message before exit 1"

requirements-completed: [IDENT-01, IDENT-02, IDENT-03, IDENT-04, IDENT-05, REL-03, REL-04, SAFE-03, UX-01]

# Metrics
duration: ~25min active (excl. checkpoint wait)
completed: 2026-05-27
---

# Phase 3 Plan 05: Import Command + Live-Odoo Acceptance Suite Summary

**Full `import` command implementing the D-11 validate-before-write flow (search_read existence check → find_by_xmlid collision check → write_xmlid), plus a 12-test live-Odoo acceptance suite proving the plan+import round-trip against vanilla Odoo 17 CE.**

## Performance

- **Duration:** ~25 min active work (a human-verify checkpoint paused the plan between Task 1 and Task 3)
- **Started:** 2026-05-27T19:19:11Z
- **Completed:** 2026-05-27T~20:52Z
- **Tasks:** 2 executable tasks (Task 1 import command; Task 3 acceptance tests) + 1 checkpoint (Task 2)
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- Replaced the `import` stub with a full async `_import_impl` implementing the D-10/D-11 flow:
  - Step 1 — `search_read(model, [("id","=",id)], fields=["id"], limit=1)` confirms the record exists before any write (catches typos, confirms correct model — T-03-15)
  - Step 2 — `find_by_xmlid` collision check: same `res_id` → idempotent no-op exit 0 (IDENT-05); different `res_id` + no `--force` → actionable error + exit 1 (SAFE-03, no silent clobber); different `res_id` + `--force` → overwrite
  - Step 3 — `write_xmlid(client, model, id, module, name)` + success message + exit 0
- Added 11 unit tests (AsyncMock-driven, offline) covering every D-11 branch including the printed-error-before-exit assertion for SAFE-03
- Added 12 `@pytest.mark.integration` acceptance tests against real Odoo 17 CE (testcontainers), using base-addon models only (`res.partner`, `res.country`):
  - SC-1 (Create / NoOp / Update classification), SC-2 (byte-identical re-render), SC-3 (xmlid-collision Reject), SC-4 (DataSourceNode + Deferred m2o read-seam resolution), SC-5 (import writes xmlid; round-trip plan shows managed; idempotent; --force guard), META-01 (plan lists all managed resources)
- Full suite green: **173 tests pass** (155 unit + 18 integration); `mypy src/godoo_stateman` clean; ruff clean on all 03-05 files

## Task Commits

1. **Task 1: Implement full import command replacing stub (D-10, D-11)** — `76fbdbb` (feat)
   - TDD: tests written first (RED, `_import_impl` import error), then implementation (GREEN, 11/11 pass)
2. **Task 2: checkpoint:human-verify** — approved by orchestrator (manual smoke / Docker-available path)
3. **Task 3: Write acceptance tests (SC-1..SC-5) against real Odoo 17 CE** — `6426a66` (test)

**Plan metadata:** _this commit_ (docs: complete plan)

## Files Created/Modified

- `src/godoo_stateman/cli/commands/import_.py` — full import command (`_import_impl` async + `import_` Typer wrapper); replaces the Phase-3 stub; env-var credentials; positive-id guard
- `tests/unit/test_import_command.py` — 11 offline unit tests for the D-11 flow (record-not-found, idempotent no-op, collision guard, --force, new-xmlid, search_read shape)
- `tests/unit/test_cli_help.py` — replaced `test_import_stub_exits_1` with `test_import_requires_options` (stub no longer exists)
- `tests/acceptance/test_plan_import.py` — 12 live-Odoo acceptance tests + cleanup fixture + harness-env helper
- `.planning/phases/03-diff-plan-import-cli/deferred-items.md` — logged 5 pre-existing out-of-scope ruff issues

## Decisions Made

- **Credentials from env only** (T-03-16): `_import_impl` reads `GODOO_URL/DB/USER/PASSWORD`; never accepts secrets as CLI args (process-list disclosure risk).
- **Positive-id guard in the wrapper** (T-03-14): `id_ <= 0` is rejected before `asyncio.run`, so no Odoo round-trip happens for invalid IDs.
- **Acceptance import tests reuse the container**: `_set_env_from_harness` mirrors `TestHarness.url` / `_database` and `admin`/`admin` into the environment via `monkeypatch`, so the import command's own `OdooClient` connects to the exact container the `odoo` fixture started (source-verified that the harness logs in as `admin`/`admin` against db `test_odoo`).
- **`_run_pipeline` test helper skips re-normalize**: tests construct already-canonical desired field values directly, so the helper mirrors `plan.py` minus the `normalize()` call; the snapshot is still built so `diff()` can apply its schema-driven store/readonly field skip.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stub-behavior test broke after import command was implemented**
- **Found during:** Task 1 (import command implementation)
- **Issue:** `tests/unit/test_cli_help.py::test_import_stub_exits_1` asserted the stub printed "Phase 3" and exited 1. The stub no longer exists, so the test failed (the real command now requires options and Typer exits 2 on missing required options).
- **Fix:** Replaced it with `test_import_requires_options`, which asserts a non-zero exit when required options are missing — the correct behavior for the implemented command.
- **Files modified:** tests/unit/test_cli_help.py
- **Verification:** Full unit suite green (155 passed).
- **Committed in:** `76fbdbb` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — obsolete stub test).
**Impact on plan:** Necessary correctness fix (the test described behavior that no longer exists). No scope creep.

## Issues Encountered

- **5 pre-existing ruff failures in prior-wave files** (`live/livestate.py` I001, `live/seam.py` I001, `plan/types.py` UP042, `tests/unit/test_seam.py` F401/F841). These are in files NOT modified by 03-05 (zero diff vs HEAD) and were introduced in waves 03-02/03-03/03-04. Per the SCOPE BOUNDARY rule they were logged to `deferred-items.md` rather than fixed inline. The 03-05 files themselves are ruff- and mypy-clean. `ruff format --check .` is likewise already non-clean across many prior-wave files (not a current passing gate), so only the 03-05 in-scope files were formatted.
- **mypy on a single test file** reports `import-untyped` for `godoo_stateman.*` — this is an artifact of single-file invocation (the existing `test_snapshot.py` shows the same). CI runs `mypy src/godoo_stateman` only, which passes; no real type errors exist in the test file.

## User Setup Required

Acceptance tests (Task 3) require **Docker** running — `godoo-testcontainers` pulls `odoo:17.0` + `postgres:15-alpine`. The session-scoped `odoo` fixture sets up the container and exposes the connection; the import tests derive `GODOO_*` from it automatically. No manual env configuration is needed for the test run. For manual CLI use against a live instance, set `GODOO_URL/GODOO_DB/GODOO_USER/GODOO_PASSWORD`.

## Next Phase Readiness

- Phase 3 is functionally complete: `plan` (read-only, exit 0/2/1) and `import` (the sole writer) are both wired and verified end-to-end against real Odoo 17 CE.
- SC-1..SC-5 and META-01 are validated by the acceptance suite — ready for `/gsd:verify-work`.
- **Follow-up before/at verification:** clear the 5 deferred ruff issues so `ruff check .` is green in CI (see `deferred-items.md`). Also note the standing documentation correction (SC-3 / SAFE-03 wording per D-01/D-02/D-03) tracked in 03-CONTEXT.md.
- Phase 4 (apply) builds directly on this: it consumes the same `find_by_xmlid`/`write_xmlid` identity layer and the `PlanStep` action model, and will introduce the first mutating executor beyond `import`.

## Self-Check: PASSED

All claimed created/modified files exist on disk; both task commits (`76fbdbb`, `6426a66`) are present in git history.

---
*Phase: 03-diff-plan-import-cli*
*Completed: 2026-05-27*
