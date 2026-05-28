# Phase 4: Apply (core actions) — VAL-01 gate — Specification

**Created:** 2026-05-28
**Ambiguity score:** 0.1605 (gate: ≤ 0.20) ✅
**Requirements:** 14 locked

## Goal

The `godoo-stateman apply` command executes a plan against a live Odoo instance: sequentially, in dependency order, threading newly-created remote IDs through `GlobalLiveState` so later steps in the same run resolve m2m/m2o references correctly, enforcing per-resource `delete_behavior`, prompting for confirmation (or honouring `--auto-approve`), and reporting per-step progress and partial failure clearly enough that VAL-01's five subtests pass against Odoo 17.0, 18.0, and 19.0 CE in CI under 120s each.

## Background

**Where Phase 3 left off:** `plan`, `import`, and `snapshot` are wired end-to-end. The full pipeline (`eval → normalize → graph → LiveState → seam → diff → render`) produces a deterministic, reviewable `list[PlanStep]` rendered with Rich. Phase 03.1 made the integration matrix green on Odoo 17/18/19.

**What does not yet exist** (verified by codebase scout):
- `src/godoo_stateman/cli/commands/apply.py` is a stub that prints "not yet implemented" and exits 1.
- No `apply/` subpackage; no `executor.py`; no `GlobalLiveState` class anywhere in the source.
- `ResourceNode` (`dsl/types/nodes.py`) has `model`, `slug`, `fields`, `xmlid_module`, `parent_slug` — but **no `delete_behavior`** and no `_options` slot.
- No `delete_behavior` carrier on `PlanStep` (`plan/types.py`).
- No field-serialization layer (m2m `(6, 0, [ids])` tuple conversion).
- No VAL-01 fixture files (`01-initial.py`, `02-mid-lifecycle.py`); no `tests/acceptance/test_apply.py`.
- The vanilla `odoo:17.0` / `18.0` / `19.0` CE containers do **not** install the `project` module by default — VAL-01 needs it.

**Why now:** Phase 3 delivered the first live Odoo reads + `import`. Phase 4 is the project's first live Odoo *mutation* path and the first acceptance gate (VAL-01) that proves the end-to-end value claim ("Terraform for Odoo"). Phase 5 (module ops + verify + snapshot) and Phase 6 (PyPI release) both depend on it.

## Requirements

### R1 — `apply` command exists and runs the plan pipeline

- **Current:** `apply.py` stub exits 1; no real implementation.
- **Target:** `godoo-stateman apply <config.py> [--auto-approve] [--verbose]` runs the existing `eval → normalize → graph → LiveState → seam → diff` pipeline, renders the plan, and (subject to R10) executes plan steps against Odoo via jsonrpc.
- **Acceptance:** `godoo-stateman apply --help` lists `--auto-approve` and `--verbose`; running it against a real Odoo container with a minimal config performs at least one `client.create` call and exits 0 on success.

### R2 — Sequential, dependency-ordered execution (CORE-05, REL-08)

- **Current:** No executor. `render_plan` uses `nx.topological_generations()` for display ordering only.
- **Target:** The executor consumes the same DAG produced by `build_graph()`. Within each topological generation, steps are sorted **Creates → Updates → Deletes/Archives**, then by slug for determinism. Steps are dispatched one at a time (no per-step concurrency).
- **Acceptance:** A unit test wires a 3-resource desired state (A→B, A→C, both at the same level) where A is Create, B is Update, C is Archive, and asserts execution order `A, B, C`. A second test confirms slug-sorted tiebreak within action-class.

### R3 — `GlobalLiveState` threads new IDs through the run (REL-05)

- **Current:** No `GlobalLiveState` exists; `LiveState` is read-only pre-apply.
- **Target:** A mutable `GlobalLiveState` (`dict[str, int]` keyed by `ResourceNode.slug`) is created at apply start, pre-populated with all slug→res_id entries from the initial `LiveState`, and updated after each successful `Create` step with the new remote integer ID **before** the next step executes.
- **Acceptance:** A unit/integration test creates two resources A (Create) and B (Create, m2m to A) at the same dependency level. After apply, B's m2m field on Odoo contains A's freshly-assigned res_id (asserted via `client.search_read`).

### R4 — M2M writes use the `(6, 0, [ids])` tuple protocol (REL-06)

- **Current:** No write path; no serialization layer.
- **Target:** A dedicated field-serialization layer (`apply/serialize.py` or equivalent) converts normalized field dicts into Odoo-shaped write payloads. M2M values `[id1, id2, …]` become `[(6, 0, [id1, id2, …])]` exactly once, at the seam between executor and `client.create` / `client.write`. The executor itself never inlines the tuple protocol.
- **Acceptance:** A unit test imports the serialization function in isolation and asserts the m2m tuple shape for a representative `partner_ids` field. The integration test in R3 confirms the write reaches Odoo correctly.

### R5 — `delete_behavior` is a typed per-resource option (SAFE-01)

- **Current:** `ResourceNode` has no `delete_behavior` field; DSL has no surface for it.
- **Target:** A typed `ResourceOptions` Pydantic model carries `delete_behavior: Literal["delete", "archive", "reject"]` (default `"reject"`). Authors set it via a reserved `_options=ResourceOptions(...)` constructor kwarg consumed by the DSL context proxy and stripped before fields are stored. `ResourceNode` gains an `options: ResourceOptions` field (default factory). Per-resource-type subclasses (e.g. `ProjectResourceOptions`) are not required for v1 but the design must not preclude them — the field is typed as the base class.
- **Acceptance:** A unit test evaluates a DSL config `resource.res_partner("p", _options=ResourceOptions(delete_behavior="archive"), name="X")` and asserts the resulting `ResourceNode.options.delete_behavior == "archive"` with `"X"` still present in `fields`. A second test asserts the default is `"reject"` when `_options` is omitted.

### R6 — `delete_behavior` enforcement at apply time (SAFE-01, SAFE-02)

- **Current:** No enforcement path.
- **Target:** Plan steps whose action is Delete or Archive carry the originating resource's `delete_behavior` (via PlanStep extension or executor-side lookup from `DesiredState` by slug — either acceptable, decided in plan-phase). At apply time:
  - `delete` → `client.unlink(model, [res_id])`.
  - `archive` → preflight schema check confirms the model has a writable `active` field via `SchemaRegistry` (SAFE-02); on success, `client.write(model, [res_id], {"active": False})`; on failure, halt with `ArchiveNotSupportedError` **before** any Odoo mutation for that step.
  - `reject` → halt with `DeleteRejectedError` referencing the slug; no Odoo mutation for that step.
- **Acceptance:** Three unit tests cover the three branches against a mocked client; one integration test in VAL-01 mid-lifecycle exercises all three paths against real Odoo.

### R7 — Idempotency: all-NoOp on re-apply (CORE-06)

- **Current:** Phase 3 plan diff is deterministic but no apply exists to test idempotency end-to-end.
- **Target:** A second `apply` of an unchanged config against an unchanged Odoo produces a plan whose every step has action `NoOp`, and the executor exits 0 without issuing any `create`, `write`, or `unlink` call.
- **Acceptance:** VAL-01 subtest 2 (idempotent re-apply) passes. A finer-grained integration test asserts zero mutation calls reach the client during a re-apply (e.g. by wrapping the `OdooClient` and counting WRITE-class calls).

### R8 — Confirmation prompt and `--auto-approve` (SAFE-04)

- **Current:** No prompt; no flag.
- **Target:** `apply` prints the rendered plan, then prompts `"Apply these changes? [y/N]"` on stdin. Answering anything other than `y`/`yes` aborts with no Odoo mutation. `--auto-approve` skips the prompt entirely. If the plan contains only `NoOp` steps, the prompt is skipped and apply exits 0 immediately.
- **Acceptance:** A CLI unit test pipes `n\n` and asserts no mutation occurs and exit code signals abort. A second test runs with `--auto-approve` and asserts the prompt is bypassed. A third confirms all-NoOp short-circuits without prompting.

### R9 — Stop-on-first-failure + partial progress (CORE-05, SAFE-05, UX-04)

- **Current:** No executor.
- **Target:** When a step raises (any exception from `client.create`/`write`/`unlink` or a `delete_behavior` halt), the executor:
  1. stops immediately;
  2. marks the failing step `error`;
  3. marks every remaining step `skipped` (in the original execution order);
  4. emits a summary listing every prior committed step (with its remote ID where applicable), the failed step (with the exception summary), and the skipped steps;
  5. exits with a non-zero code (defined in R12).
- **Acceptance:** A unit test injects a failure on step 3 of 5 and asserts steps 1–2 are reported as committed, step 3 as error, steps 4–5 as skipped. The integration test in VAL-01 mid-lifecycle confirms partial-progress reporting against real Odoo.

### R10 — `[N/total]` progress + per-step status (UX-04)

- **Current:** No progress output.
- **Target:** Each step prints `[N/total] <action> <model> <slug> … <status>` where `status ∈ {ok, error, skipped}`. Output uses Rich; falls back gracefully on non-tty. No spinner is required; a one-line-per-step transcript is acceptable.
- **Acceptance:** A CLI test captures stdout from an apply with 3 steps and asserts the `[1/3]`, `[2/3]`, `[3/3]` prefixes plus correct status tokens.

### R11 — VAL-01 acceptance suite, all 5 subtests, all 3 Odoo versions

- **Current:** No `test_apply.py`; no fixture configs; no Phase-4-specific test prefix.
- **Target:** `tests/acceptance/test_apply.py` ports the Go v1 VAL-01 scenario:
  - Fixtures `01-initial.py` and `02-mid-lifecycle.py` are added under `tests/acceptance/fixtures/val01/` and model `project.project` + `project.task.type`.
  - A session-scoped pytest fixture installs the `project` Odoo module via `godoo-client`'s `ModuleManager` **before** any VAL-01 test runs. This is **test-harness-only plumbing** — Phase 4 does NOT expose module ops to authors (that remains Phase 5 / CORE-07 / META-02).
  - Five `@pytest.mark.integration` subtests cover: (1) initial apply, (2) idempotent re-apply, (3) mid-lifecycle update, (4) delete/archive/reject paths, (5) verify post-apply.
  - Subtest 5 is implemented by **re-running the existing `plan` pipeline** after apply and asserting all steps are `NoOp`. **No new `verify` command is shipped in Phase 4** — that remains Phase 5 (CORE-07).
  - All subtests run in the existing CI matrix (`ODOO_VERSION ∈ {17.0, 18.0, 19.0}`) per Phase 03.1 plumbing; **all three matrix entries must pass green** to gate Phase 4.
- **Acceptance:** GitHub Actions `integration` job shows VAL-01 tests green on all three matrix entries on a PR branch; per-version wall-clock for VAL-01 ≤ 120s.

### R12 — Apply exit-code contract (UX-04 corollary)

- **Current:** Phase 3 codified plan exit codes (`0` no changes, `2` changes pending, `1` error). Apply has no contract.
- **Target:** Apply exit codes are:
  - `0` — all steps committed `ok` (including the all-NoOp short-circuit case).
  - `1` — internal/CLI error (config not found, env-var missing, eval error, cycle, etc.).
  - `3` — partial failure: at least one step committed `ok` then a later step errored; remaining `skipped`.
  - `4` — first step (or sole step) errored; no commits.
  - User aborted at SAFE-04 prompt → exit `5`.
- **Acceptance:** A CLI test matrix asserts each exit code against a contrived scenario. README/help text or an `EXIT_CODES.md` note in the phase artifacts will document them (left to discuss/plan to decide where).

### R13 — Schema-registry preflight for archivability (SAFE-02)

- **Current:** `SchemaRegistry` populates `store` per field (Phase 1). No use site yet for archivability.
- **Target:** Before attempting any `archive` action, the executor calls `SchemaRegistry.get(model)` and checks for a writable `active` field (existence + `store=True`). If absent, halt with `ArchiveNotSupportedError(model=…, slug=…)` before any Odoo mutation for that step. If the schema snapshot is stale (model unknown), refresh on-demand per existing Phase 1 contract.
- **Acceptance:** A unit test with a mocked schema where `model = "res.currency.rate"` lacks `active` confirms the executor halts on that step before any client call. R6's integration coverage exercises the positive path.

### R14 — Errors live in `errors.py`, follow existing hierarchy

- **Current:** `errors.py` carries `StatemanError`, `VersionMismatchError`, `DslEvalError`, `CycleError`, `XmlidCollisionError`, `LiveStateFetchError`.
- **Target:** Add `ApplyError(StatemanError)` base, plus `ArchiveNotSupportedError(ApplyError)`, `DeleteRejectedError(ApplyError)`, and `ApplyStepError(ApplyError)` (carries `slug`, `action`, `cause`). No new error file; extend `errors.py` in place.
- **Acceptance:** `mypy --strict` clean; unit tests assert the inheritance chain and that the executor raises the right subclass per scenario.

## Boundaries

### In scope

1. `apply` command implementation (executor module, CLI wiring, exit codes, prompts).
2. `GlobalLiveState` design and integration with the executor.
3. Field-serialization layer for write payloads (m2m `(6, 0, [ids])` tuple at minimum).
4. `ResourceOptions` Pydantic model + DSL `_options` plumbing.
5. `delete_behavior` enforcement at apply time (all three values).
6. Stop-on-first-failure with partial-progress reporting.
7. SAFE-04 confirmation prompt + `--auto-approve` flag.
8. Schema-based archivability preflight.
9. VAL-01 fixture files (`01-initial.py`, `02-mid-lifecycle.py`).
10. Acceptance test suite (`test_apply.py`) with 5 subtests, running on Odoo 17.0 / 18.0 / 19.0.
11. Test-harness session fixture that installs the `project` module via `godoo-client.ModuleManager` for VAL-01 only.
12. Error-hierarchy extensions (`ApplyError` + subclasses) in `errors.py`.

### Out of scope

1. **Standalone `verify` command** — Phase 5 / CORE-07. VAL-01 subtest 5 is satisfied by re-running `plan` and asserting all-NoOp.
2. **Author-facing module install/upgrade** — Phase 5 / CORE-07 / META-02 / EXEC-01. The Phase 4 test-harness fixture installs `project` directly via `ModuleManager`; **no DSL surface, no plan action class, no executor branch** for module ops in Phase 4.
3. **Translation diff / apply** — Phase 5 / META-03.
4. **Snapshot export / restore** — Phase 5 / META-01 extension.
5. **Verify-as-drift-scan** — Phase 5 / CORE-09. Subtest 5 here is a narrow idempotency check, not a drift scan.
6. **Concurrent step execution** — sequential only. No async-parallel apply, no per-level fan-out.
7. **Automatic rollback on partial failure** — structurally impossible over jsonrpc (each `execute_kw` commits its own SQL transaction). Recovery surface is the `verify` command in Phase 5; for now, the operator inspects the partial-progress report.
8. **`o2m` write protocol `(0, 0, {values})` / `(1, id, {values})`** — out of scope unless required to land a VAL-01 subtest. Phase 4 prioritizes m2m. If VAL-01 fixtures force o2m writes, that's a discuss-phase scope decision.
9. **CI changes beyond reusing the Phase 03.1 matrix** — no new workflows, no matrix expansion, no separate apply-only job.
10. **PyPI publish / LGPL headers / README quickstart** — Phase 6.

## Constraints

1. **Performance:** VAL-01 wall-clock ≤ 120s per matrix entry (3 entries on Odoo 17/18/19). The Go v1 baseline is ~95s on Odoo 17 — used as a soft target.
2. **Odoo-version compatibility:** All five subtests pass on `odoo:17.0`, `odoo:18.0`, `odoo:19.0` CE images via testcontainers. Per Phase 03.1 fixtures, `odoo_version` is a session-scoped pytest parameter and `ODOO_VERSION` env var drives container choice.
3. **Sequential execution only:** no async-parallel within or across dependency levels.
4. **No DSL surface for modules:** Phase 4 must not introduce a `with mail.config(...)` -style module-management author surface. The `project` module install is test-only, called directly via `ModuleManager` from the pytest fixture.
5. **Transport:** all Odoo mutations go through `godoo-client` (`create`, `write`, `unlink`); no XML-RPC, no direct ORM access, no subprocess shells to `odoo-bin`.
6. **Determinism:** plan output must remain byte-identical across runs (Phase 3 invariant). Apply order must be deterministic for the same DAG (Creates→Updates→Deletes within level, slug-sorted within action class).
7. **Strict typing:** `mypy --strict` clean; no `# type: ignore` without comment; matches existing project conventions.

## Acceptance Criteria

- [ ] `godoo-stateman apply --help` shows `--auto-approve` and `--verbose` flags.
- [ ] `apply` against a fresh Odoo container with a single `resource.res_partner("p", name="X")` config issues exactly one `client.create` call and exits `0`.
- [ ] Same config re-applied to the same Odoo container issues zero mutation calls and exits `0`.
- [ ] A 2-resource fixture (A then B with B.m2m=[A]) at the same dependency level results in B's m2m field on Odoo containing A's new res_id (verified via `search_read`).
- [ ] M2M payload reaching `client.write` is shaped `[(6, 0, [ids])]` — asserted by a unit test on the serialization layer in isolation.
- [ ] DSL config with `_options=ResourceOptions(delete_behavior="archive")` produces a `ResourceNode` whose `options.delete_behavior == "archive"`; default is `"reject"` when `_options` omitted.
- [ ] Archive against a non-archivable model (mocked schema, no `active` field) halts with `ArchiveNotSupportedError` before any Odoo call.
- [ ] Delete via `delete_behavior="delete"` calls `client.unlink`; reject via `delete_behavior="reject"` calls neither `unlink` nor `write`.
- [ ] Apply with a forced failure on step 3 of 5 reports steps 1–2 committed, step 3 errored, steps 4–5 skipped; exit code `3`.
- [ ] Apply with a failure on step 1 of N exits `4`.
- [ ] User declining the SAFE-04 prompt exits `5` with no mutation.
- [ ] `--auto-approve` bypasses the prompt; all-NoOp plan exits `0` without prompting.
- [ ] Output transcript prefixes each step with `[N/total]` and includes the `ok | error | skipped` status token.
- [ ] `tests/acceptance/test_apply.py` exists with five `@pytest.mark.integration` subtests covering initial apply, idempotent re-apply, mid-lifecycle update, delete/archive/reject paths, and verify-post-apply.
- [ ] VAL-01 fixtures `01-initial.py` and `02-mid-lifecycle.py` live under `tests/acceptance/fixtures/val01/`.
- [ ] CI integration job is green on Odoo 17.0, 18.0, and 19.0 for the VAL-01 subtests on a sample PR; per-version VAL-01 wall-clock ≤ 120s.
- [ ] `mypy --strict` and `ruff check` clean across the new modules.
- [ ] `ApplyError`, `ArchiveNotSupportedError`, `DeleteRejectedError`, `ApplyStepError` exist in `errors.py` and inherit from `StatemanError`.

## Ambiguity Report

| Dimension | Score | Min | Status | Notes |
|---|---|---|---|---|
| Goal Clarity | 0.90 | 0.75 | ✅ | GlobalLiveState shape locked (slug-keyed), `_options` DSL surface chosen, serialize layer location set |
| Boundary Clarity | 0.85 | 0.70 | ✅ | Verify and module-ops boundaries explicit; test-harness module install scoped narrow |
| Constraint Clarity | 0.78 | 0.65 | ✅ | Matrix scope locked to 17/18/19; perf budget 120s/entry; sequential only |
| Acceptance Criteria | 0.78 | 0.70 | ✅ | 17 pass/fail checkboxes; VAL-01 subtests enumerated |
| **Ambiguity** | **0.16** | ≤ 0.20 | ✅ | Gate passed |

## Interview Log

| Round | Perspective | Question summary | Decision locked |
|---|---|---|---|
| 1 | Researcher | VAL-01 subtest 5 vs Phase 5 verify boundary | Re-run `plan`, assert all-NoOp; no new verify code in Phase 4 |
| 1 | Researcher | VAL-01 matrix scope (17 only vs 17/18/19) | All three Odoo versions in CI |
| 1 | Researcher | `delete_behavior` DSL surface | Typed `_options=ResourceOptions(...)` Pydantic model; default `"reject"` |
| 2 | Simplifier | `project` module install for VAL-01 fixtures | Session-scoped pytest fixture invokes `godoo-client.ModuleManager`; not part of author surface |
| 2 | Simplifier | `GlobalLiveState` key shape | `dict[str, int]` keyed by `ResourceNode.slug` |
| 2 | Simplifier | M2M `(6, 0, [ids])` tuple placement | Dedicated `apply/serialize.py` field-serialization layer |

---
*Phase: 04-apply-core-actions-val01-gate*
*Spec created: 2026-05-28*
*Next step: /gsd-discuss-phase 4*
