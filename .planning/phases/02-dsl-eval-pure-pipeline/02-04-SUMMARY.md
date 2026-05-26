---
phase: 02-dsl-eval-pure-pipeline
plan: "04"
subsystem: dsl
tags: [networkx, dag, cycle-detection, typer, pydantic]

requires:
  - phase: 02-01
    provides: "Deferred/resolve() types with deps frozenset for DAG edge extraction"
  - phase: 02-02
    provides: "eval_config() returning DesiredState with ResourceNode.parent_slug"
  - phase: 02-03
    provides: "normalize() normalizing DesiredState field values via snapshot"

provides:
  - "build_graph(state) -> nx.DiGraph — full dependency DAG with cycle detection (REL-01, REL-02, REL-07)"
  - "plan CLI stub wired to eval_config() printing module/resource count (CORE-01 vertical slice)"
  - "Full Phase 2 unit suite green — 88 tests pass"

affects:
  - phase-03-diff-plan-output
  - phase-04-apply-engine

tech-stack:
  added:
    - "networkx>=3.6.1 (runtime dep — mypy override added for missing stubs)"
  patterns:
    - "build_graph: add all nodes first, then edges from three sources (parent_slug, Deferred.deps, direct .slug refs), then nx.find_cycle cycle detection"
    - "nx.find_cycle exception polarity: catch NetworkXNoCycle, NOT None-check (Pitfall 1)"
    - "mypy [[tool.mypy.overrides]] for third-party packages without type stubs"
    - "plan stub: sync Typer command calling pure-sync eval_config; no asyncio.run wrapper needed"

key-files:
  created:
    - src/godoo_stateman/dsl/graph.py
    - tests/unit/dsl/test_graph.py
  modified:
    - src/godoo_stateman/cli/commands/plan.py
    - tests/unit/test_cli_help.py
    - pyproject.toml

key-decisions:
  - "[02-04]: build_graph processes three edge sources: parent_slug (REL-07), Deferred.deps frozenset, direct field refs with .slug attribute"
  - "[02-04]: nx.find_cycle raises NetworkXNoCycle on acyclic graph — always wrap in try/except, never check None return (Pitfall 1)"
  - "[02-04]: networkx has no type stubs — added [[tool.mypy.overrides]] with ignore_missing_imports=true; NOT a wildcard glob (networkx.* was unused per mypy warning)"
  - "[02-04]: REL-07 cycle via children: parent Deferred.deps referencing child slug creates back-edge child→parent in combination with parent_slug forward edge; test fixture uses Deferred on parent pointing to child slug (not Deferred on child pointing to parent)"
  - "[02-04]: plan stub remains exit code 1 after printing eval summary — full plan output deferred to Phase 3"

patterns-established:
  - "Pattern: TDD RED confirmed via ImportError (no graph.py), GREEN via 11 passing tests"
  - "Pattern: mypy overrides section for untyped third-party runtime deps"
  - "Pattern: Typer CLI stub wired to pure-sync pipeline stage with DslEvalError handling"

requirements-completed:
  - CORE-01
  - CORE-02
  - CORE-08
  - RSRC-01
  - RSRC-02
  - RSRC-03
  - RSRC-04
  - RSRC-05
  - RSRC-06
  - RSRC-07
  - REL-01
  - REL-02
  - REL-07

duration: 12min
completed: "2026-05-26"
---

# Phase 02 Plan 04: Dependency DAG + CLI Stub Wiring Summary

**NetworkX DiGraph dependency DAG with CycleError cycle detection over resource/child/data-source nodes, wired to `plan` CLI stub calling eval_config() — Phase 2 pure pipeline complete with 88 unit tests green**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-26T14:00:00Z
- **Completed:** 2026-05-26T14:12:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- `build_graph(state)` constructs a `nx.DiGraph` with nodes for all resource slugs and data-source `node_key`s; edges from `Deferred.deps` frozensets, direct `.slug` field references, and `parent_slug` parent→child relationships (REL-01, REL-07)
- `CycleError` raised with full cycle path string on detected cycles, before any Odoo call (REL-02); `nx.find_cycle` exception polarity correctly handled via `try/except NetworkXNoCycle` (Pitfall 1)
- `plan` CLI stub updated to accept a `config: Path` argument, call `eval_config()`, and print module/resource/data_source count — provides a working vertical slice through the Phase 2 pipeline
- Full Phase 2 unit suite: 88 tests pass, ruff clean, mypy strict clean (with networkx untyped-import override)

## Task Commits

Each task was committed atomically:

1. **Task 1: build_graph() with cycle detection + test_graph.py** - `4f001ed` (test+feat combined — RED ImportError confirmed before GREEN implementation)
2. **Task 2: Wire plan stub to eval_config() + full suite green** - `bbf884b` (feat)

**Plan metadata:** see final docs commit below

## Files Created/Modified

- `src/godoo_stateman/dsl/graph.py` — `build_graph(state) -> nx.DiGraph`; raises `CycleError` on cycle; three edge sources; `NetworkXNoCycle` exception handling
- `tests/unit/dsl/test_graph.py` — 11 unit tests covering REL-01/REL-02/REL-07/SC-4; no Docker; all in-process DesiredState construction
- `src/godoo_stateman/cli/commands/plan.py` — wired to `eval_config()`; accepts `config: Path`; prints eval summary; exits 1 with Phase 3 note
- `tests/unit/test_cli_help.py` — updated `test_plan_stub_exits_1` to pass config path; added `test_plan_stub_shows_eval_summary`
- `pyproject.toml` — added `[[tool.mypy.overrides]]` for `networkx` (no type stubs available)

## Decisions Made

- **REL-07 cycle through children**: The test `test_children_participate_in_cycle` requires the cycle to go parent → child (via `parent_slug` edge) AND child → parent. The only way to create the back-edge is to put `Deferred.deps={"child_slug"}` on the PARENT (not `deps={"parent_slug"}` on the child — that creates a same-direction edge, no cycle). Test fixture adjusted accordingly.
- **mypy networkx override**: `module = "networkx"` (single string, not array) — using `["networkx", "networkx.*"]` array form causes a mypy `unused section` warning since networkx's submodules are accessed via the top-level import.
- **Plan stub exit code**: Stub still exits 1 after printing eval output — this preserves the contract that `plan` is not yet usable (Phase 3 will replace with diff/plan output).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] test_children_participate_in_cycle cycle direction**
- **Found during:** Task 1 (test_graph.py RED phase)
- **Issue:** Original test put `Deferred.deps={"order_01"}` on the CHILD, intending a back-edge `child → parent`. But `Deferred.deps` on a resource creates edges `(dep_slug, resource.slug)` — meaning `order_01 → order_01.line_1`, which is the SAME direction as the parent→child `parent_slug` edge. No cycle results.
- **Fix:** Moved `Deferred.deps={"order_01.line_1"}` to the PARENT resource. This creates edge `(order_01.line_1, order_01)` while `parent_slug` creates `(order_01, order_01.line_1)` — forming the cycle.
- **Files modified:** `tests/unit/dsl/test_graph.py`
- **Verification:** `test_children_participate_in_cycle` now raises `CycleError` as expected
- **Committed in:** `4f001ed` (Task 1 commit)

**2. [Rule 1 - Bug] test_plan_stub_exits_1 broken by config arg addition**
- **Found during:** Task 2 (full suite run)
- **Issue:** Existing test invoked `plan` without arguments; adding required `config: Path` arg causes Typer to return exit code 2 ("Missing argument") instead of 1
- **Fix:** Updated test to pass a temp config file path; added `test_plan_stub_shows_eval_summary` to verify eval output appears
- **Files modified:** `tests/unit/test_cli_help.py`
- **Verification:** Both tests pass; full suite 88/88
- **Committed in:** `bbf884b` (Task 2 commit)

**3. [Rule 2 - Missing Critical] mypy networkx untyped-import error**
- **Found during:** Task 1 (ruff/mypy gate check on graph.py)
- **Issue:** `import networkx as nx` triggers `[import-untyped]` in strict mypy — networkx ships no type stubs
- **Fix:** Added `[[tool.mypy.overrides]]` section to `pyproject.toml` with `module = "networkx"` and `ignore_missing_imports = true`
- **Files modified:** `pyproject.toml`
- **Verification:** `uv run mypy src/godoo_stateman/` exits 0
- **Committed in:** `4f001ed` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs, 1 Rule 2 missing critical)
**Impact on plan:** All auto-fixes necessary for correctness. Test direction bug was a logic error in the test fixture design; mypy fix is a standard pattern for untyped third-party runtime deps. No scope creep.

## Issues Encountered

None beyond the three deviations documented above.

## Known Stubs

- `src/godoo_stateman/cli/commands/plan.py`: plan command exits code 1 with "Full plan output: Phase 3" note — intentional stub; Phase 3 will implement diff/plan output. Eval summary IS printed (not a placeholder).

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. `plan` command accepts user-supplied file path but Typer `exists=True` validation was not added (the plan spec does not require it; `eval_config` raises `FileNotFoundError` on missing paths which is acceptable for a stub).

## Next Phase Readiness

- Phase 2 pure pipeline complete: `eval_config → normalize → build_graph` all unit-tested and importable
- Phase 3 (diff/plan output) can consume `build_graph()` output via `nx.topological_generations()` for wave-ordered resource processing
- `plan` CLI stub provides a working entry point for end-to-end testing against real `.py` config files
- No blockers for Phase 3

---
*Phase: 02-dsl-eval-pure-pipeline*
*Completed: 2026-05-26*
