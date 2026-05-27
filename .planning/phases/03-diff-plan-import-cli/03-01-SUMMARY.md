---
phase: 03-diff-plan-import-cli
plan: 01
subsystem: dsl
tags: [rename, d-05, error-hierarchy, doc-correction, d-02, d-03]
dependency_graph:
  requires: [02-dsl-eval-pure-pipeline]
  provides: [DesiredState.xmlid_prefix, XmlidCollisionError, LiveStateFetchError, SAFE-03-updated]
  affects: [03-02, 03-03, 03-04, 03-05]
tech_stack:
  added: []
  patterns: [frozen-pydantic-rename, error-subclass-hierarchy]
key_files:
  modified:
    - src/godoo_stateman/dsl/types/desired.py
    - src/godoo_stateman/dsl/eval.py
    - src/godoo_stateman/dsl/normalize.py
    - src/godoo_stateman/cli/commands/plan.py
    - src/godoo_stateman/errors.py
    - tests/unit/dsl/test_eval.py
    - tests/unit/dsl/test_graph.py
    - tests/unit/dsl/test_normalize.py
    - tests/unit/test_cli_help.py
    - .planning/REQUIREMENTS.md
decisions:
  - "D-05: DSL top-level xmlid_prefix = '...' replaces module = '...'; ResourceNode.xmlid_module internal field unchanged"
  - "D-02/D-03: Reject = xmlid-namespace collision (different model in ir.model.data) only; natural-identity probing dropped"
  - "MissingModuleError class name kept; only the error message updated to reference xmlid_prefix"
metrics:
  duration: "4m 47s"
  completed: "2026-05-27"
  tasks: 2
  files_changed: 10
---

# Phase 3 Plan 1: DSL rename module→xmlid_prefix + error additions + doc corrections Summary

**One-liner:** Renamed `DesiredState.module` to `xmlid_prefix` (D-05) across all Phase-2 surfaces, added `XmlidCollisionError`/`LiveStateFetchError` to the error hierarchy, and corrected SAFE-03 wording to the xmlid-collision-only Reject definition (D-02).

## What Was Built

### Task 1: Rename module → xmlid_prefix (D-05)

Applied the D-05 rename across the full Phase-2 surface:

- **`desired.py`**: `module: str` → `xmlid_prefix: str` (with `# renamed from module (D-05)` comment)
- **`eval.py`**: reads `xmlid_prefix` from `exec_locals`/`exec_globals`; `DesiredState(xmlid_prefix=module, ...)` construction; `MissingModuleError` message updated from `module = "<name>"` to `xmlid_prefix = "<name>"`; docstrings updated
- **`normalize.py`**: `module=state.module` → `xmlid_prefix=state.xmlid_prefix` in `DesiredState` constructor
- **`cli/commands/plan.py`**: `state.module` → `state.xmlid_prefix` in stub output
- **Tests updated**: `test_eval.py`, `test_graph.py`, `test_normalize.py`, `test_cli_help.py` — all DSL fixture strings changed from `module = "..."` to `xmlid_prefix = "..."`, all `state.module` assertions updated to `state.xmlid_prefix`, all `DesiredState(module=...)` direct constructions updated to `xmlid_prefix=`

`ResourceNode.xmlid_module` internal field was intentionally NOT renamed (internal Python field, not a DSL keyword). `context.py` had no `_module` keyword lookup to rename (the feature doesn't exist in Phase-2 code).

### Task 2: New error classes + SAFE-03/SC-3 corrections

- **`errors.py`**: appended `XmlidCollisionError(StatemanError)` and `LiveStateFetchError(StatemanError)` after `CycleError`, following the identical `__init__(self, message: str) -> None: super().__init__(message)` pattern with docstrings
- **`REQUIREMENTS.md` SAFE-03**: replaced "natural identity matches an existing unmanaged record" with the D-01/D-02 xmlid-collision definition — Reject only when `xmlid_prefix.slug` in `ir.model.data` already points to a **different model**; unmanaged look-alike records are invisible to stateman and result in `Create`
- **`ROADMAP.md` SC-3**: already contained the correct D-02 wording from the planner (no change needed)

## Verification Results

```
uv run pytest tests/unit/ -q          → 97 passed (0 failures)
uv run ruff check src/                → All checks passed
uv run mypy src/ --ignore-missing-imports → Success: no issues in 26 source files
grep -rn "state\.module" src/ tests/  → 0 matches (complete rename)
grep "xmlid_prefix" desired.py        → 1 match (confirmed field present)
python -c "from godoo_stateman.errors import XmlidCollisionError, LiveStateFetchError; print('ok')" → ok
ROADMAP.md + REQUIREMENTS.md          → both contain "xmlid-namespace collision"
```

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1 | a199e86 | refactor(03-01): rename DSL module keyword to xmlid_prefix (D-05) |
| Task 2 | a18c09b | feat(03-01): add XmlidCollisionError + LiveStateFetchError; update SAFE-03 wording (D-02, D-03) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cascade rename to test_graph.py and test_normalize.py**
- **Found during:** Task 1 post-implementation test run
- **Issue:** `test_graph.py` `_make_desired()` and `test_normalize.py` `_make_desired_state()` both constructed `DesiredState(module=...)` directly — not listed as rename targets in the plan but required for correctness
- **Fix:** Updated both helper functions to `xmlid_prefix=...`
- **Files modified:** `tests/unit/dsl/test_graph.py`, `tests/unit/dsl/test_normalize.py`
- **Commit:** a199e86

**2. [Rule 1 - Bug] Cascade rename to test_cli_help.py**
- **Found during:** Task 1 post-implementation test run
- **Issue:** `test_cli_help.py` writes DSL fixture strings with `module = "..."` that are passed to `eval_config()` — not listed as rename target in plan but broke when evaluator started reading `xmlid_prefix`
- **Fix:** Updated both DSL fixture writes to `xmlid_prefix = "..."`
- **Files modified:** `tests/unit/test_cli_help.py`
- **Commit:** a199e86

**3. [Observation] ROADMAP.md SC-3 already correct**
- The plan said to update ROADMAP.md SC-3 wording, but the planner had already written the correct D-02 definition into ROADMAP.md. No change was needed. Only REQUIREMENTS.md SAFE-03 required the wording correction.

## Self-Check

- [x] `src/godoo_stateman/dsl/types/desired.py` — contains `xmlid_prefix: str`
- [x] `src/godoo_stateman/errors.py` — contains `XmlidCollisionError` and `LiveStateFetchError`
- [x] Commit a199e86 exists
- [x] Commit a18c09b exists
- [x] 97 unit tests pass (no regressions)
- [x] REQUIREMENTS.md SAFE-03 contains "xmlid-namespace collision"
- [x] ROADMAP.md SC-3 contains "xmlid-namespace collision"

## Self-Check: PASSED
