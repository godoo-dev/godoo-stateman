---
phase: 02-dsl-eval-pure-pipeline
plan: "02"
subsystem: dsl
tags: [python, exec, dsl, proxy, restricted-builtins, flatten, odoo]

# Dependency graph
requires:
  - phase: 02-01
    provides: ResourceNode, DataSourceNode, ChildrenWrapper, DesiredState, Deferred, resolve(), MissingModuleError

provides:
  - DSL proxy objects (ResourceProxy, DataProxy, OdooModuleProxy, ConfigParameterProxy, children())
  - build_dsl_namespace() — exec() namespace factory
  - eval_config() — restricted exec() evaluator returning DesiredState
  - _flatten() — ChildrenWrapper expander / inline-children promoter
  - test_eval.py — 11 unit tests covering CORE-01 and RSRC-01 through RSRC-07

affects: [02-03-normalize, 02-04-graph, 03-diff-plan, cli-plan-command]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "__getattr__ proxy chain for DSL sugar (resource.res_partner → model 'res.partner')"
    - "exec() with _SAFE_BUILTINS allowlist — import/open/eval blocked via NameError absence"
    - "exec_locals-first module extraction (Pitfall 2 from RESEARCH.md)"
    - "object-id tracking in _flatten() to exclude duplicate child registrations"
    - "context-manager protocol on _ResourceBuilder for with-block field assignment"

key-files:
  created:
    - src/godoo_stateman/dsl/context.py
    - src/godoo_stateman/dsl/eval.py
    - tests/unit/dsl/test_eval.py
  modified: []

key-decisions:
  - "_flatten() uses object-id tracking to exclude child nodes already registered by ResourceProxy — prevents duplicate top-level entries when children() is used"
  - "ResourceProxy.__getattr__ does replace('_', '.', 1) — single replacement converts first underscore only, matching Odoo two-segment model names (res.partner, project.project)"
  - "test_eval_purity patches godoo.client.client.OdooClient with side_effect that raises — proves zero Odoo traffic during eval"
  - "exec_locals checked before exec_globals for 'module' variable (Pitfall 2)"

patterns-established:
  - "DSL config files use underscore model names (resource.res_partner) translated to dotted Odoo names (res.partner)"
  - "_Collector is created fresh per eval_config() call — never reused"
  - "ChildrenWrapper never reaches DesiredState — _flatten() is always called before construction"

requirements-completed:
  - CORE-01
  - RSRC-01
  - RSRC-02
  - RSRC-03
  - RSRC-04
  - RSRC-05
  - RSRC-07

# Metrics
duration: 15min
completed: 2026-05-26
---

# Phase 02 Plan 02: DSL Proxy Objects + exec() Evaluator Summary

**exec()-based DSL evaluator with restricted builtins, ResourceProxy/__getattr__ sugar, ChildrenWrapper flatten, and 11 passing unit tests covering CORE-01 and RSRC-01 through RSRC-07**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-26T13:26:00Z
- **Completed:** 2026-05-26T13:41:27Z
- **Tasks:** 2
- **Files modified:** 3 created

## Accomplishments

- `context.py`: ResourceProxy, DataProxy, OdooModuleProxy, ConfigParameterProxy, `children()`, and `build_dsl_namespace()` — the complete DSL namespace factory
- `eval.py`: `eval_config()` with `_SAFE_BUILTINS` restricted sandbox, `_flatten()` for ChildrenWrapper expansion, proper exec_locals/exec_globals module extraction
- `test_eval.py`: 11 unit tests all passing — RSRC-01 through RSRC-07 plus CORE-01 purity invariant, module declaration, inline children flatten, and walrus operator support

## Task Commits

1. **Task 1: DSL proxy objects — context.py** - `7ab2f02` (feat)
2. **Task 2: eval.py + test_eval.py** - `2589163` (feat)

**Plan metadata:** (committed with STATE/ROADMAP/SUMMARY below)

## Files Created/Modified

- `src/godoo_stateman/dsl/context.py` — DSL proxy objects and `build_dsl_namespace()`
- `src/godoo_stateman/dsl/eval.py` — `eval_config()` evaluator with restricted builtins and `_flatten()`
- `tests/unit/dsl/test_eval.py` — 11 unit tests covering CORE-01, RSRC-01 through RSRC-07

## Decisions Made

- **`_flatten()` uses `set[int]` of child node object ids** to skip nodes that appear as `ChildrenWrapper.children`. ResourceProxy registers nodes immediately on call (before `children()` wraps them), so without this guard the collector contains both the raw child and the prefixed promoted copy, producing duplicates.
- **`replace('_', '.', 1)`**: single-replacement converts the first underscore to a dot, mapping `res_partner` → `res.partner` and `project_project` → `project.project`. Multiple leading underscores (e.g. `sale_order_line`) correctly map to `sale.order_line` — consistent with two-segment Odoo model naming.
- **Purity test uses `godoo.client.client.OdooClient` patch with `side_effect=raises`**: Any touch of the real Odoo transport during `eval_config()` would surface immediately as an `AssertionError`, providing a hard guarantee of the CORE-01 purity invariant.
- **`exec_locals.get("module") or exec_globals.get("module")`**: follows Pitfall 2 from RESEARCH.md — top-level assignments in the config go to exec_locals when both dicts are passed, so checking only one dict causes spurious `MissingModuleError`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] _flatten() duplicate child prevention via object-id tracking**
- **Found during:** Task 2 (test_inline_children_flatten)
- **Issue:** `resource.sale_order_line("line1")` inside a `children()` call registers the node in `collector.resources` immediately. `_flatten()` then re-promotes it with a prefixed slug, but the original registration remains — producing 3 resources instead of 2.
- **Fix:** First pass in `_flatten()` collects `id()` of all nodes appearing as `ChildrenWrapper.children`. Second pass skips nodes whose `id()` is in that set.
- **Files modified:** `src/godoo_stateman/dsl/eval.py`
- **Verification:** `test_inline_children_flatten` passes — 2 resources returned, no ChildrenWrapper in any fields.
- **Committed in:** `2589163` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Essential fix for correctness — flatten contract required by D-09 and Pitfall 5. No scope creep.

## Issues Encountered

None beyond the auto-fixed bug above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `eval_config()` is fully functional and returns a `DesiredState` with zero Odoo calls
- `DesiredState` is guaranteed to contain no `ChildrenWrapper` values in any resource fields
- Phase 02-03 (normalize) can consume `DesiredState` directly — no blocking concerns
- Phase 02-04 (graph) can rely on `parent_slug` being set on child nodes and `ChildrenWrapper` being absent

---
*Phase: 02-dsl-eval-pure-pipeline*
*Completed: 2026-05-26*
