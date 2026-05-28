# Roadmap: godoo-stateman

## Overview

godoo-stateman is built as six vertical MVP slices, each delivering a
runnable, end-to-end-demonstrable capability. Phases 1-2 produce zero
Odoo traffic (pure Python iteration). Phase 3 introduces the first live
Odoo calls and testcontainers. Phase 4 delivers the first working apply
with VAL-01 as the acceptance gate. Phase 5 closes the highest-risk
capability class (module ops) and gates on VAL-02. Phase 6 packages
everything for public PyPI release.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Bootstrap + Schema Registry** - Project scaffold, uv workspace, pyproject.toml, Pydantic types, versioned schema registry with `store` flag, write_xmlid/find_by_xmlid helpers (completed 2026-05-23)
- [x] **Phase 2: DSL Eval + Pure Pipeline** - Python DSL surface (resource/data/with/mail.config/resolve()), normalize stage, dependency DAG — no Odoo calls (completed 2026-05-26)
- [x] **Phase 3: Diff + Plan + Import CLI** - First live Odoo calls: LiveState fetch, diff, plan (read seam), `plan` and `import` CLI commands, SAFE-03 no-silent-adoption (completed 2026-05-27)
- [ ] **Phase 4: Apply (core actions) — VAL-01 gate** - Sequential apply executor with GlobalLiveState, m2m tuple protocol, delete_behavior, stop-on-first-failure, VAL-01 acceptance tests pass
- [ ] **Phase 5: Module Ops + Verify + Snapshot — VAL-02 gate** - Module install/upgrade (cancellation-threaded), verify stage, translation diff/apply, snapshot export/restore, VAL-02 acceptance tests pass
- [ ] **Phase 6: Release Packaging** - PyPI publish, LGPL-3.0 headers, public README quickstart

## Phase Details

### Phase 1: Bootstrap + Schema Registry

**Goal**: A runnable Python project exists with the full type vocabulary, a versioned schema registry that correctly captures the `store` flag, and the xmlid write helpers — everything downstream stages depend on.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: SCHEM-01, SCHEM-02, SCHEM-03, SCHEM-04, SCHEM-05, UX-06, PKG-04, PKG-05
**Success Criteria** (what must be TRUE):

  1. `uv run godoo-stateman --help` exits 0 with the five command names listed (plan, apply, verify, import, snapshot).
  2. `SchemaRegistry.get("project.project")` returns a `VersionedModelSchema` with `store` populated for every field when called against a real Odoo 17 instance.
  3. A schema snapshot serialized to JSON includes `odoo_version`, `schema_format_version`, and `store` at the field level; loading a snapshot whose version mismatches raises a `VersionMismatchError`.
  4. `write_xmlid(model, res_id, module, name)` and `find_by_xmlid(module, name)` round-trip correctly against `ir.model.data` via jsonrpc.
  5. The `store`-flag conflict between godoo-py `Introspector` and `field_cache.py` is resolved in code (SCHEM-05): implementation either uses the existing populated value or issues a supplemental `fields_get` call — verified by a test that reads a known computed non-stored field and confirms `store=False`.

**Plans:** 3/3 plans complete
Plans:

- [x] 01-01-PLAN.md — Project scaffold: pyproject.toml, error hierarchy, Typer CLI skeleton with 5 commands (4 stubs + snapshot shell)
- [x] 01-02-PLAN.md — Schema registry: VersionedFieldSchema/ModelSchema, SchemaRegistry, VersionedSnapshot, snapshot command wired end-to-end with acceptance tests
- [x] 01-03-PLAN.md — xmlid helpers: XmlIdRecord, write_xmlid, find_by_xmlid, unit tests, acceptance round-trip against real ir.model.data

### Phase 2: DSL Eval + Pure Pipeline

**Goal**: The full Python DSL authoring surface is evaluable in isolation (no Odoo calls), the normalize stage produces stable canonical values, and the dependency DAG detects cycles — all fully unit-tested without Docker.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: CORE-01, CORE-02, CORE-08, RSRC-01, RSRC-02, RSRC-03, RSRC-04, RSRC-05, RSRC-06, RSRC-07, REL-01, REL-02, REL-07
**Success Criteria** (what must be TRUE):

  1. A `.py` config file using `resource.<type>(slug)`, `data.<type>()`, `with` blocks, `mail.config["key"]`, `:=` walrus refs, and `resolve()` evaluates into a `DesiredState` tree with zero Odoo calls and zero network I/O.
  2. The normalize stage converts `False` → `None` for scalar fields and `False` → `[]` for relation fields; a unit test confirms a round-trip against unchanged input produces identical normalized output on two runs.
  3. Inline One2many children declared under a parent resource appear as nodes in the dependency graph and participate in cycle detection.
  4. Introducing a circular dependency between two managed resources causes `build_graph()` to raise a `CycleError` with the cycle path in the error message before any Odoo call is attempted.
  5. The `resolve()` design spike is finalized: semantics (deferred computation firing at the read seam), interaction with the dependency DAG, and the `exec()` restricted-builtins approach are documented and passing unit tests.

**Plans:** 4/4 plans complete
Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Foundation types: pyproject.toml networkx dep, errors.py extensions, dsl/types/ package (DesiredState, ResourceNode, DataSourceNode, Deferred), test_deferred.py

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — DSL eval: context.py proxy objects + eval.py exec() evaluator with flatten + test_eval.py covering RSRC-01..07
- [x] 02-03-PLAN.md — Normalize stage: normalize.py schema-driven canonicalization (CORE-02, CORE-08) + test_normalize.py

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-04-PLAN.md — Graph + wire: graph.py build_graph() with CycleError + test_graph.py (REL-01/02/07) + plan stub wired to eval_config()

### Phase 3: Diff + Plan + Import CLI

**Goal**: The `plan` command works end-to-end against real Odoo — fetching live state, diffing desired vs. live, resolving data-source read seam, and producing a human-readable reviewable plan — and `import` adopts existing records without silent adoption ever occurring.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: CORE-03, CORE-04, IDENT-01, IDENT-02, IDENT-03, IDENT-04, IDENT-05, REL-03, REL-04, SAFE-03, UX-01, UX-02, UX-03, UX-05, META-01
**Success Criteria** (what must be TRUE):

  1. `godoo-stateman plan config.py` prints each resource's slug, model, and pending action (`Create | Update | NoOp | Delete | Archive | Reject`); Update actions include a per-field diff with old and new values; exit code is 0 (no changes) or 2 (changes pending).
  2. Running `plan` twice against an unchanged Odoo produces identical output both times (plan is deterministic across runs).
  3. A resource in the DSL whose `xmlid_prefix.slug` xmlid already exists in `ir.model.data` pointing to a record of a **different model** surfaces as `Reject` (xmlid-namespace collision) in the plan output — decided from `ir.model.data` alone. An unmanaged look-alike record with no managed xmlid results in `Create`. (Redefined per D-01/D-02.)
  4. A `data.<type>(**selector)` reference resolves its remote ID at plan time (read seam) and is available to dependent plan steps; a Many2many field pointing to a data-source record renders the correct resolved ID in the plan diff.
  5. `godoo-stateman import --model res.partner --id 42 --module stateman --name my_partner` writes an xmlid to `ir.model.data`; subsequent `plan` treats that record as managed.

**Plans:** 5/5 plans complete
Plans:

**Wave 0**

- [x] 03-01-PLAN.md — DSL rename module→xmlid_prefix (D-05) + errors.py additions + ROADMAP/REQUIREMENTS doc correction (D-03)

**Wave 1** *(blocked on Wave 0 completion)*

- [x] 03-02-PLAN.md — Plan types (PlanStep/PlanAction/FieldDiff) + LiveState fetch + read-seam resolution (live/ subpackage)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-03-PLAN.md — Diff engine (diff.py) + offline unit tests for diff and seam

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-04-PLAN.md — Plan render (plan/render.py) + full plan command wired end-to-end

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 03-05-PLAN.md — Import command + SC-1/SC-2/SC-4/SC-5 acceptance tests against real Odoo 17 CE

### Phase 03.1: Multi-Odoo-version CI test matrix (INSERTED)

**Goal**: The existing acceptance suite runs and passes against **Odoo 17.0, 18.0, and 19.0** in CI, mirroring `godoo-py`'s convention — making good on the project's "Odoo 17+" claim before v1.0 releases.
**Depends on**: Phase 3
**Requirements**: VAL-03 (multi-version validation)
**Success Criteria** (what must be TRUE):

  1. `.github/workflows/test.yml` defines an `integration` job whose `strategy.matrix.odoo_version` is exactly `["17.0", "18.0", "19.0"]` with `fail-fast: false`, injects `ODOO_VERSION` as an env var, and runs the integration suite (`uv run --no-sources pytest tests/acceptance -v -s -m integration --log-cli-level=ERROR`) in each matrix entry.
  2. All three matrix entries pass green on a sample PR — all `@pytest.mark.integration` tests succeed against vanilla Odoo 17.0, 18.0, and 19.0 CE images (`odoo:17.0`, `odoo:18.0`, `odoo:19.0`) via testcontainers, with no per-test `skipif`/`xfail` introduced.
  3. The same workflow runs a separate fast unit-test job (`uv run pytest -m "not integration" -q`) and the lint+typecheck job (`uv run ruff check . && uv run mypy src/godoo_stateman`) — single source of CI truth for the repo.
  4. `PROJECT.md` and `CLAUDE.md` are updated to state the project is tested against Odoo 17.0, 18.0, and 19.0 (replacing the unverified "Odoo 17+" wording).

**Reference**: godoo-py's matrix at `../godoo-py/.github/workflows/test.yml` (`strategy.matrix.odoo-version: ["17.0", "18.0", "19.0"]`) — `TestHarness`/`OdooTestContainer` already read `ODOO_VERSION` from env (default `17.0`), so our fixtures need no changes; this phase is mostly CI plumbing + fixing whatever shakes out on 18/19.

**Plans:** 4/6 plans executed
Plans:

**Wave 1 — Pre-flight**

- [x] 03.1-01-PLAN.md — Pre-flight: verify odoo:19.0 Docker image exists + 19.0 testcontainer startup smoke against postgres:15-alpine

**Wave 2 — Version propagation** *(blocked on Wave 1 completion)*

- [x] 03.1-02-PLAN.md — Version propagation: add odoo_version session fixture in conftest.py (D-01) + fix plan.py:90 hardcode (D-04)

**Wave 3 — Test rewrites + doc updates** *(blocked on Wave 2 completion — parallel pair)*

- [x] 03.1-03-PLAN.md — Test rewrites: _run_pipeline() + 7 callers in test_plan_import.py (D-02) + 3 hardcodes + assertions in test_snapshot.py (D-03)
- [x] 03.1-04-PLAN.md — Doc/requirements: ROADMAP SC-1/SC-2 (D-05/D-06) + REQUIREMENTS VAL-03 rewrite + VAL-04 add (D-07) + PROJECT.md + CLAUDE.md wording (D-11)

**Wave 4 — Shake-out** *(blocked on Wave 3 completion)*

- [ ] 03.1-05-PLAN.md — Shake-out: run matrix locally on 17.0/18.0/19.0, fix any genuine test failures (no skipif/xfail per D-08); halt + upstream PR if godoo-py bug hit (D-09)

**Wave 5 — Sample-PR verification** *(blocked on Wave 4 completion)*

- [ ] 03.1-06-PLAN.md — Sample-PR verification: push branch, open draft PR, confirm all 3 matrix entries green on GitHub Actions with non-zero test counts

### Phase 4: Apply (core actions) — VAL-01 gate

**Goal**: The `apply` command executes the plan sequentially in dependency order, resolves cross-apply m2m IDs via `GlobalLiveState`, enforces delete_behavior, stops on first failure with partial progress, and passes all 5 VAL-01 subtests against real Odoo 17.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: CORE-05, CORE-06, REL-05, REL-06, REL-08, SAFE-01, SAFE-02, SAFE-04, SAFE-05, UX-04, VAL-01
**Success Criteria** (what must be TRUE):

  1. VAL-01 passes: all 5 subtests (initial apply, idempotent re-apply, mid-lifecycle update, delete/archive/reject paths, verify post-apply) pass against real Odoo 17 CE + PostgreSQL 16 via testcontainers in under 120 seconds.
  2. A second apply of an unchanged config against an unchanged Odoo produces an all-NoOp plan (idempotency invariant); `plan` exits with code 0.
  3. When resource B's Many2many field references resource A created in the same apply run, B's m2m write uses A's new remote integer ID (registered in `GlobalLiveState` after A's create step); the m2m write command uses `(6, 0, [ids])` tuple protocol.
  4. Apply shows `[N/total]` progress and per-step status (`ok | error | skipped`) as steps execute; when a step fails, previously-committed steps are listed and subsequent steps are listed as `skipped`.
  5. A resource with `delete_behavior="archive"` on a model with no writable `active` field causes apply to halt with a schema-based error before any Odoo mutation for that step.

**Plans**: TBD

### Phase 5: Module Ops + Verify + Snapshot — VAL-02 gate

**Goal**: Module install/upgrade runs as the highest-risk step class with cancellation threading, the verify stage re-fetches live state from Odoo (never cached), snapshot exports/restores managed state, translation diffs apply, and VAL-02 passes with 3 PASS + 1 correctly-SKIP.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: CORE-07, CORE-09, RSRC-08, EXEC-01, EXEC-03, META-02, META-03, VAL-02, VAL-04
**Success Criteria** (what must be TRUE):

  1. VAL-02 passes: 3 subtests PASS (module install, namespaced config write, server action create) and 1 is correctly-SKIP (module-already-installed branch) against real Odoo 17 CE + PostgreSQL 16 via testcontainers in under 80 seconds.
  2. `godoo-stateman verify config.py` run standalone (not post-apply) re-fetches live state from Odoo, diffs all managed resources against desired state, and reports any out-of-band drift — without performing any Odoo mutation.
  3. A SIGINT (Ctrl-C) during a module install step causes apply to report partial progress (committed steps listed, current step marked interrupted) without leaving the CLI in an ambiguous state.
  4. `godoo-stateman snapshot export config.py --out state.json` produces a versioned JSON artifact with a version field, export timestamp, and model-keyed record data; `snapshot restore state.json` imports the artifact with configurable conflict handling (`skip | error`).
  5. The test suite reaches or exceeds 29 test files and 4,564 LOC across unit, integration, and acceptance tests combined (VAL-04 benchmark).

**Plans**: TBD

### Phase 6: Release Packaging

**Goal**: godoo-stateman is published to PyPI under the name `godoo-stateman`, every source file carries an LGPL-3.0 header, and the public README positions the tool with a working quickstart.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: PKG-01, PKG-02, PKG-03
**Success Criteria** (what must be TRUE):

  1. `pip install godoo-stateman` succeeds from PyPI and `godoo-stateman --help` shows the five commands.
  2. Every Python source file in `src/godoo_stateman/` begins with an LGPL-3.0 license header comment.
  3. The public README on `github.com/godoo-dev/godoo-stateman` includes a quickstart: install via pip, write a minimal config, run `plan`, run `apply`.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Bootstrap + Schema Registry | 3/3 | Complete   | 2026-05-23 |
| 2. DSL Eval + Pure Pipeline | 4/4 | Complete    | 2026-05-26 |
| 3. Diff + Plan + Import CLI | 5/5 | Complete   | 2026-05-27 |
| 03.1. Multi-Odoo-version CI test matrix | 4/6 | In Progress|  |
| 4. Apply (core actions) — VAL-01 gate | 0/TBD | Not started | - |
| 5. Module Ops + Verify + Snapshot — VAL-02 gate | 0/TBD | Not started | - |
| 6. Release Packaging | 0/TBD | Not started | - |
