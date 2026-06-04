# Phase 4: Apply (core actions) — VAL-01 gate - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

The `apply` command executes the plan sequentially in dependency order, resolves cross-apply Many2many IDs via `GlobalLiveState`, enforces `delete_behavior`, stops on first failure with partial-progress reporting, and passes all 5 VAL-01 subtests against real Odoo 17/18/19 CE via testcontainers. This phase delivers the first live Odoo *mutations* (create/write/unlink) — everything before it was read-only/pure.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**14 requirements are locked.** See `04-SPEC.md` for full requirements, boundaries, and acceptance criteria (ambiguity score 0.16, gate passed). Requirement IDs: CORE-05, CORE-06, REL-05, REL-06, REL-08, SAFE-01, SAFE-02, SAFE-04, SAFE-05, UX-04, VAL-01.

Downstream agents MUST read `04-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):** sequential dependency-order execution of create/update/delete/archive; `GlobalLiveState` forward-reference resolution; m2m `(6, 0, [ids])` serialization; `delete_behavior` enforcement (default `reject`, plus `archive`/`delete`); SAFE-02 archivability gate via `SchemaRegistry.get(model).archivable` *before* any Odoo mutation for the step; confirmation prompt + `--auto-approve`; `[N/total]` progress with per-step status (`ok | error | skipped`); stop-on-first-failure with committed-vs-skipped reporting; apply exit-code contract (0/1/3/4/5); VAL-01 acceptance (5 subtests) across Odoo 17/18/19.

**Out of scope (from SPEC.md):** automatic rollback (structurally impossible over jsonrpc — each `execute_kw` is its own SQL transaction); async-parallel execution (sequential only); o2m `(0, 0, {})` / `(1, id, {})` writes (confirmed staying out — see D-01); a new `verify` command (VAL-01 subtest 5 re-runs `plan` and asserts all-NoOp).

</spec_lock>

<decisions>
## Implementation Decisions

### VAL-01 fixtures
- **D-01:** Model `project.project` and `project.task.type` as **separate resources**, linked via the task-type→project **m2m** field (`project_ids`), serialized with `(6, 0, [ids])`. This deliberately exercises the cross-apply `GlobalLiveState` m2m resolution path (REL-05) while keeping o2m **out of Phase 4 scope**. Fixtures use only cross-version-stable scalar fields (`name` + known-safe scalars); avoid version-divergent fields (e.g. `member_ids` vs `favorite_user_ids` on `project.project`). **VERIFY during planning:** exact m2m field name (`project_ids`) and the safe scalar-field subset against live introspection for Odoo 17/18/19 CE.

### GlobalLiveState seeding
- **D-02:** `GlobalLiveState` is pre-populated from **both** the initial `LiveState` managed slugs (`slug→res_id`) **and** data-source/seam-resolved record IDs, then each create's new `res_id` is registered as steps execute. One uniform lookup surface for all m2m resolution, regardless of whether the target is pre-existing-managed, data-sourced, or freshly created this run. Key shape: `dict[str, int]` keyed by `ResourceNode.slug` (SPEC R3).

### delete_behavior carrier
- **D-03:** `delete_behavior` (and/or the originating `options`) is **carried on the frozen `PlanStep` model** — not looked up executor-side from `DesiredState`. The executor needs no `DesiredState` back-reference, plan render can display the behavior, and it matches the existing frozen-Pydantic step pattern. (SPEC R6 accepted either path; this locks the PlanStep-extension path.)

### Shared client/env helper
- **D-04:** Extract a shared `GODOO_*` env-read + `OdooClient`-construction helper as part of Phase 4 (rule of three reached: `plan`, `import`, `apply`). Refactor `plan` and `import` to consume it. Single connection/credential surface.

### Claude's Discretion (planner decides — technical mechanics, not user-facing)
- `ResourceOptions` ↔ frozen `ResourceNode` integration: make `ResourceOptions` hashable (frozen Pydantic) vs adjust how options attach to the frozen `ResourceNode` dataclass.
- `_options=` kwarg consumption/stripping in `dsl/context.py` (mirror the existing `_module=` handling pattern).
- `apply/serialize.py` field-type → Odoo-write-format contract beyond m2m (m2o int pass-through, bool, char/text). Define explicitly during planning.
- How CREATE steps obtain the full desired-fields dict (`PlanStep` currently carries only `field_diff`): executor lookup from `DesiredState` by slug, or a `PlanStep` extension. Planner's call — coordinate with D-03's PlanStep extension.
- Whether to house the executor in a new `apply/` subpackage and its module layout.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked requirements (read first)
- `.planning/phases/04-apply-core-actions-val01-gate/04-SPEC.md` — Locked requirements, boundaries, acceptance criteria. MUST read before planning.

### Project / roadmap context
- `.planning/ROADMAP.md` — Phase 4 entry (goal, 5 success criteria, requirement IDs).
- `.planning/REQUIREMENTS.md` — CORE/REL/SAFE/UX/VAL requirement definitions; "Out of scope" (no automatic rollback).
- `.planning/PROJECT.md` — Odoo-reality lessons (e.g. project.project field drift across versions).
- `.planning/STATE.md` — carry-forward conventions (async _impl + sync Typer wrapper; frozen Pydantic; exit-code reservations; GODOO_* env-only credentials).
- `.planning/phases/03-diff-plan-import-cli/03-CONTEXT.md` — Phase 3 decisions (D-04 managed universe = ir.model.data rows where module == xmlid_prefix; D-08 topological + slug-sorted determinism; LiveState is a frozen dataclass).

### Code the executor builds on
- `src/godoo_stateman/cli/commands/plan.py` — wired pipeline template (eval→normalize→graph→LiveState.fetch→resolve_data_sources→resolve_deferred→diff→render); apply's pre-execution phase mirrors it.
- `src/godoo_stateman/cli/commands/apply.py` — current stub to replace.
- `src/godoo_stateman/diff.py` — pure sync `diff()` → `list[PlanStep]`; apply re-uses pre-built steps, must NOT call diff().
- `src/godoo_stateman/plan/types.py` — `PlanAction`, `FieldDiff`, frozen `PlanStep` (extend for D-03).
- `src/godoo_stateman/plan/render.py` — `render_plan(...)` via `nx.topological_generations()`.
- `src/godoo_stateman/dsl/graph.py` — `build_graph()` → `nx.DiGraph`.
- `src/godoo_stateman/dsl/types/nodes.py` — `ResourceNode` (add `options`).
- `src/godoo_stateman/dsl/context.py` — DSL proxy (`_options=` handling; `_module=` is the pattern reference).
- `src/godoo_stateman/live/livestate.py` — frozen `LiveState` + async `LiveState.fetch()`; foundation for `GlobalLiveState`.
- `src/godoo_stateman/schema/registry.py` — `SchemaRegistry.get(model).archivable` = SAFE-02 gate.
- `src/godoo_stateman/errors.py` — error hierarchy; add `ApplyError`, `ArchiveNotSupportedError`, `DeleteRejectedError`, `ApplyStepError`.

### Transport (godoo-py — source of truth, verify before use)
- `C:/dev/godoo-dev/godoo-py/packages/godoo/src/godoo/client/client.py` — `create`/`write`/`unlink`/`search_read`; `OdooClient` async context manager.
- `C:/dev/godoo-dev/godoo-py/packages/godoo/src/godoo/client/` — **VERIFY `ModuleManager` API** for the session-scoped `project`-module install fixture (SPEC R11).
- `C:/dev/godoo-dev/godoo-py/packages/godoo-testcontainers/` — testcontainers harness for VAL-01.

### Tests
- `tests/conftest.py` — `odoo` (session-scoped `TestHarness`) + `odoo_version` fixtures.
- `tests/acceptance/test_plan_import.py` — `@pytest.mark.integration` pattern + `_run_pipeline()` helper; template for `tests/acceptance/test_apply.py`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `plan.py` pipeline: apply reconstructs the same eval→…→diff chain to obtain `list[PlanStep]`, then executes it. No duplication of diff logic.
- `LiveState` (frozen dataclass, async `fetch()`): read-only foundation `GlobalLiveState` extends with mutable forward-ref registration.
- `SchemaRegistry.get(model).archivable`: ready-made SAFE-02 archivability check before archive mutations.
- `render_plan()` + `nx.topological_generations()`: execution order is the same generation/slug-sorted order already computed for rendering.

### Established Patterns
- async `_impl` + sync Typer wrapper via `asyncio.run()` (no anyio); `from __future__ import annotations` + `TYPE_CHECKING`.
- Frozen Pydantic (`ConfigDict(frozen=True)`) for serializable pipeline objects; frozen dataclass for internal value objects.
- Determinism: Creates → Updates → Deletes/Archives within a dependency level, slug-sorted within action class (Phase 3 D-08).
- Credentials from `GODOO_*` env vars only — never CLI args. Tests: top-level functions, `asyncio_mode = "auto"`, `@pytest.mark.integration` for live-Odoo.

### Integration Points
- `apply.py` stub → real executor (D-04 shared connection helper consumed here, plan/import refactored to match).
- `PlanStep` gains `delete_behavior`/`options` (D-03); `ResourceNode` gains `options`; `dsl/context.py` consumes `_options=`.
- New `apply/serialize.py` field-serialization layer (m2m `(6,0,[ids])` + scalar mapping).
- New `tests/acceptance/test_apply.py` + `tests/acceptance/fixtures/val01/` (01-initial, 02-mid-lifecycle), using m2m-linked project/task.type resources (D-01).

</code_context>

<specifics>
## Specific Ideas

- VAL-01 cross-apply test must specifically prove a Many2many on resource B referencing resource A (created the same run) writes A's *new* remote int ID via `(6, 0, [ids])` — `project.task.type.project_ids` → `project.project` is the chosen vehicle (D-01), so the fixture doubles as the REL-05 proof.
- `delete_behavior="archive"` against a model with no writable `active` field must halt with a schema-based error *before* any Odoo mutation for that step (SC-5 / SAFE-02), using the `archivable` flag.

</specifics>

<deferred>
## Deferred Ideas

- **o2m serialization** (`(0, 0, {values})` / `(1, id, {values})`): kept out of Phase 4. Revisit only if a future VAL subtest cannot be expressed via m2o/m2m (SPEC out-of-scope item 8).
- **Shared connection-helper scope**: Phase 4 extracts env-read + client construction; broader connection/retry/error-mapping abstractions are not in scope now.

None of the above expand Phase 4 scope — recorded so they aren't lost.

</deferred>

---

*Phase: 04-apply-core-actions-val01-gate*
*Context gathered: 2026-06-04*
