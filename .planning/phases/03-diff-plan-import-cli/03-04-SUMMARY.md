---
phase: 03-diff-plan-import-cli
plan: "04"
subsystem: plan-render-cli
tags: [render, cli, plan-command, rich, tdd, determinism]
dependency_graph:
  requires: [03-03]
  provides: [plan-command-wired, render-plan]
  affects: [cli/commands/plan.py, plan/render.py]
tech_stack:
  added: []
  patterns:
    - rich.text.Text for literal bracket output in non-TTY Rich console
    - TYPE_CHECKING guard for Console (annotation-only, TC002 compliance)
    - asyncio.run(_plan_impl) Typer wrapper pattern
key_files:
  created:
    - src/godoo_stateman/plan/render.py
    - tests/unit/test_plan_render.py
    - tests/unit/test_plan_command.py
  modified:
    - src/godoo_stateman/cli/commands/plan.py
    - tests/unit/test_cli_help.py
decisions:
  - "Used rich.text.Text instead of f-string markup for model name to avoid Rich stripping [model.name] as markup in non-TTY mode"
  - "Console moved to TYPE_CHECKING in render.py (TC002 compliance) — only used in annotation"
  - "test_cli_help.py stub tests updated to reflect real plan command behavior (exits 1 for missing env vars)"
metrics:
  duration: "~9 minutes"
  completed: "2026-05-27"
  tasks_completed: 2
  files_changed: 5
---

# Phase 03 Plan 04: Plan Render + Wired Plan Command Summary

**One-liner:** Rich Terraform-style plan renderer with non-TTY fallback wired into full end-to-end plan command replacing stub.

## Objective

Wire the complete plan pipeline (eval → normalize → build_graph → LiveState.fetch → resolve_data_sources → resolve_deferred → diff → render_plan) into the `plan` CLI command. Implement the Rich-based plan renderer satisfying D-06/D-07/D-08/D-09.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | render_plan tests | eb17e82 | tests/unit/test_plan_render.py |
| 1 (GREEN) | render_plan implementation | 8484e62, b54003f | src/godoo_stateman/plan/render.py |
| 2 (RED) | plan command tests | 1dc843e | tests/unit/test_plan_command.py |
| 2 (GREEN) | wired plan command | 118f4c4, b23e669 | src/godoo_stateman/cli/commands/plan.py, tests/unit/test_cli_help.py |

## What Was Built

### `src/godoo_stateman/plan/render.py`

`render_plan(plan_steps, graph, console, *, verbose=False)` implementing:
- **D-06**: Terraform-style annotated list; action symbols +/~/- /x/a/= ; UPDATE shows plain `field_name: 'old' → 'new'` lines (not `rich.syntax.Syntax`)
- **D-07**: NOOP suppressed by default; `N resource(s) unchanged` trailing summary always present when N > 0; shown inline with `verbose=True`
- **D-08**: Deterministic order via `nx.topological_generations(graph)` + `sorted()` slug tie-breaking within each generation (SC-2 byte-identical output)
- **D-09**: Caller passes `Console(force_terminal=False)`; Rich Text objects used for literal `[model]` brackets to prevent markup stripping in non-TTY mode

### `src/godoo_stateman/cli/commands/plan.py`

Full plan command replacing stub with `async def _plan_impl(config, verbose) -> int`:

1. `eval_config(config)` — catches `DslEvalError` → exit 1
2. Credentials from `GODOO_URL/GODOO_DB/GODOO_USER/GODOO_PASSWORD` env vars — missing → exit 1 with helpful message
3. `SchemaRegistry(client, OdooVersion(17, 0))`
4. `snapshot = await registry.build_snapshot(distinct_models)` — concrete call, no None fallback (CORE-03)
5. `normalize(state, snapshot)` — schema-driven normalization required for correct diffs
6. `build_graph(state)` — for topological render ordering (D-08)
7. `LiveState.fetch(client, xmlid_prefix, desired_fields_by_model)` — READ-ONLY
8. Snapshot extended with managed-set models for Delete/Archive classification
9. `resolve_data_sources(client, state.data_sources)` — REL-03
10. `resolve_deferred(r, seam_result)` for each resource — REL-04
11. `diff(state, live_state, snapshot)` — synchronous, pure
12. `render_plan(plan_steps, graph, console, verbose=verbose)` — D-06/D-07/D-08/D-09
13. Return 0 (all-NoOp) or 2 (changes pending) — UX-02/D-18

Synchronous Typer wrapper: `asyncio.run(_plan_impl(...))` + `raise typer.Exit(code=exit_code)`

### Tests

- **test_plan_render.py** (16 tests): non-TTY ANSI check, NoOp suppression, verbose path, UPDATE field diff format, action symbols, deterministic order (2 calls = identical output), slug sort within generation, all-NOOP summary
- **test_plan_command.py** (8 tests): exit codes 0/2/1, _plan_impl called with correct args, --verbose flag, --help lists 5 commands, missing config file handling

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Rich markup stripping `[model.name]` in non-TTY output**
- **Found during:** Task 1 (GREEN phase, `test_model_name_in_output` failing)
- **Issue:** `console.print(f"... [{step.model}]")` — Rich interprets `[res.partner]` as a markup tag and strips it when `force_terminal=False`
- **Fix:** Used `rich.text.Text` object to build the header line, appending the model portion as literal text (not markup). `Text.append(f"[{step.model}]")` is never parsed as markup
- **Files modified:** `src/godoo_stateman/plan/render.py`
- **Commit:** 8484e62

**2. [Rule 2 - Missing] Updated stub tests in test_cli_help.py**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** Two tests (`test_plan_stub_exits_0`, `test_plan_stub_shows_eval_summary`) in `test_cli_help.py` asserted stub-specific behavior ("Phase 3" in output, "resources=0"). Both now fail after the real plan command replaced the stub
- **Fix:** Replaced with `test_plan_exits_1_when_env_missing` (exits 1 with GODOO env message) and `test_plan_accepts_verbose_flag` (--verbose in help), reflecting the real command's behavior
- **Files modified:** `tests/unit/test_cli_help.py`
- **Commit:** 118f4c4

**3. [Rule 1 - Lint] ruff TC002 for Console import in render.py**
- **Found during:** Post-implementation ruff check
- **Issue:** `rich.console.Console` used only in type annotation → TC002 requires TYPE_CHECKING guard
- **Fix:** Moved Console import to `if TYPE_CHECKING:` block
- **Commit:** b54003f

**4. [Rule 1 - Lint] Unused imports + E741 in test files**
- **Found during:** Post-implementation ruff check
- **Issue:** `AsyncMock`, `patch` unused in test_plan_command.py; `pytest` TC002; ambiguous `l` var in test_plan_render.py
- **Fix:** Removed unused imports, moved `pytest` to TYPE_CHECKING, renamed `l` → `line`
- **Commit:** b23e669

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| Task 1 RED | eb17e82 | `test(03-04): add failing tests for render_plan()` |
| Task 1 GREEN | 8484e62 | `feat(03-04): implement render_plan()` |
| Task 2 RED | 1dc843e | `test(03-04): add failing tests for wired plan command` |
| Task 2 GREEN | 118f4c4 | `feat(03-04): wire full plan command replacing stub` |

Both RED/GREEN gates satisfied.

## Success Criteria Verification

- [x] `uv run pytest tests/unit/test_plan_render.py tests/unit/test_plan_command.py -v -q` — 24 passed
- [x] `uv run pytest -m "not integration" -q` — 144 passed, 6 deselected
- [x] `uv run mypy src/godoo_stateman/ --ignore-missing-imports` — 33 files, no issues
- [x] `uv run ruff check src/godoo_stateman/cli/commands/plan.py src/godoo_stateman/plan/render.py tests/unit/test_plan_render.py tests/unit/test_plan_command.py` — all passed
- [x] No stub text in plan.py (`grep "Full plan output"` → 0 matches)
- [x] `build_snapshot` called concretely (2 matches — initial + extended for managed models)
- [x] No `get_snapshot` / `snapshot=None` in code (comment only)
- [x] `render_plan` uses `nx.topological_generations`
- [x] `Console(force_terminal=False)` in plan command
- [x] Exit codes 0/2/1 verified by test_plan_command.py
- [x] Determinism test: two identical `render_plan()` calls produce byte-identical output (SC-2)
- [x] GODOO_URL/GODOO_DB/GODOO_USER/GODOO_PASSWORD as credentials source (never hardcoded)

## Known Stubs

None. The plan command is fully wired. (The `apply` and `verify` commands remain as stubs per Phase 4/5 scope.)

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced beyond the plan's defined threat model (T-03-09/10/11/12 all mitigated as planned).

## Self-Check: PASSED
