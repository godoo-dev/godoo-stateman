# Requirements: godoo-stateman

**Defined:** 2026-05-23
**Core Value:** Deterministic, idempotent Odoo state reconciliation from a version-controlled Python config file — without an agent, an addon, or a sidecar state file.

---

## v1 Requirements

Requirements for the initial public release. Every requirement must be satisfied before the project is declared complete and the Go v1 prototype is formally superseded. Acceptance gate: VAL-01 and VAL-02 pass against real Odoo 17 CE via testcontainers.

---

### CORE — Reconciliation Pipeline

The seven-stage reconciliation pipeline: config → normalize → graph → diff → plan → apply → verify.

- [x] **CORE-01**: The engine evaluates a Python `.py` config file and produces a desired-state resource tree with zero Odoo calls during evaluation.
- [x] **CORE-02**: The normalize stage canonicalizes all Odoo field values into a stable internal representation before any comparison — including `False`-to-`None` conversion for scalars and `False`-to-`[]` for relation fields — so that two runs against an unchanged Odoo produce identical normalized state.
- [ ] **CORE-03**: The diff stage computes a per-resource plan action (`Create | Update | NoOp | Delete | Archive | Reject`) for each resource in the desired-state tree.
- [ ] **CORE-04**: The plan stage resolves data-source reads against live Odoo (the "read seam") and serializes an ordered, reviewable set of plan steps without mutating Odoo.
- [ ] **CORE-05**: The apply stage executes plan steps sequentially in dependency order over jsonrpc, stops on the first failure, and reports per-step status (`ok | error | skipped`) with a `[N/total]` progress counter.
- [ ] **CORE-06**: A second apply of an unchanged config against an unchanged Odoo instance produces an all-NoOp plan (idempotency invariant).
- [ ] **CORE-07**: The verify stage re-runs the plan on touched resources after apply and reports any remaining delta between applied state and desired state.
- [x] **CORE-08**: The engine normalizes Many2one fields to their integer ID for comparison (discarding the display-name tuple returned by Odoo), and treats Many2many field order as irrelevant during diff.
- [ ] **CORE-09**: Translation field changes (non-default-language values) are detected in the diff stage and written as separate per-language apply passes after the primary create/update.

---

### SCHEM — Schema Snapshot

The schema registry that describes Odoo model and field metadata, version-keyed, persisted to disk.

- [x] **SCHEM-01**: The schema registry stores per-model metadata — model name, archivability (`active` field presence and writability), and naming metadata — keyed by an explicit Odoo-version dimension from the first snapshot.
- [x] **SCHEM-02**: The schema registry stores per-field metadata — field name, field type, `store` flag, writability, compute expression presence, and relation target model — for every field of every tracked model.
- [x] **SCHEM-03**: The `store` flag is captured in every schema snapshot. Computed fields with `store=False` and no inverse are excluded from write plans regardless of DSL declaration. (BUG-07-B: this must be correct from day one; retrofitting is not an option.)
- [x] **SCHEM-04**: The schema snapshot is serialized to a versioned JSON file on disk; the file format includes an Odoo-version field and a schema-format version field so that stale snapshots from a different Odoo version are detected and rejected.
- [x] **SCHEM-05**: Before any Phase 1 schema code ships, the implementation verifies whether `godoo-py` `Introspector.get_schema()` populates the `store` flag from its `fields_get` call; if not, the stateman schema layer issues its own `fields_get` with the required attributes to supplement.

---

### IDENT — Identity Model

The xmlid-based identity mechanism that replaces sidecar state files.

- [ ] **IDENT-01**: Every managed resource is identified by an xmlid stored in Odoo's `ir.model.data`; the engine has no local state file, no local database, and no external state backend.
- [ ] **IDENT-02**: Two separate machines applying the same config file against the same Odoo instance converge to identical managed state without any shared file or coordination channel.
- [ ] **IDENT-03**: The engine provides `write_xmlid(model, res_id, module, name)` and `find_by_xmlid(module, name)` helpers that operate against `ir.model.data` via jsonrpc; these are not delegated to godoo-py (which does not provide them).
- [ ] **IDENT-04**: The `import` CLI command adopts an existing Odoo record into managed state by writing an xmlid to `ir.model.data` for a specified model and record ID or domain; adoption is always an explicit operator action.
- [ ] **IDENT-05**: After `import` writes an xmlid, subsequent `plan` and `apply` runs treat the record as managed — no further adoption action is needed.

---

### RSRC — Resource DSL

The Python authoring surface for expressing desired Odoo state.

- [x] **RSRC-01**: The DSL provides `resource.<model_name>(slug, **fields)` as the constructor for managed resources; the positional `slug` is the stable identity key scoped to the config module.
- [x] **RSRC-02**: The DSL provides `data.<model_name>(**selector)` for read-only references to existing Odoo records; data-source records are never created or modified by plan/apply.
- [x] **RSRC-03**: The DSL supports `with` blocks for resource scoping; field values are set via attribute assignment inside `with` blocks.
- [x] **RSRC-04**: The DSL provides `mail.config["key"] = "val"` sugar (via an `odoo_module` helper) for declarative `ir.config_parameter` writes without requiring a full `resource()` declaration.
- [x] **RSRC-05**: The DSL supports the walrus-operator (`:=`) convention for capturing intermediate resource references without naming collisions.
- [x] **RSRC-06**: The DSL provides a `resolve()` escape hatch for configs where the desired structure depends on a value that can only be known after a live Odoo read; `resolve()` defers the computation to the read seam at plan stage rather than DSL eval.
- [x] **RSRC-07**: The DSL evaluator uses `exec()` with restricted builtins; it does not use RestrictedPython (which breaks walrus operators).
- [ ] **RSRC-08**: Module install/upgrade is expressed as a first-class resource in the DSL and is placed at the highest-risk tier in the dependency DAG (level 0, before any record operations); module operations thread cancellation through every long-running call.

---

### REL — Relations and Dependency Graph

The dependency DAG, cycle detection, and cross-resource relation resolution.

- [x] **REL-01**: The engine builds a directed acyclic dependency graph (DAG) across all managed resources, inline child resources, and data sources before producing a plan.
- [ ] **REL-02**: The engine detects cycles in the dependency graph across mixed node types (managed resources, inline children, data sources) and reports the cycle path before any Odoo mutation.
- [ ] **REL-03**: Data-source records resolve at the plan stage (read seam), not at DSL eval; their remote IDs are available to the diff and apply stages via `GlobalLiveState`.
- [ ] **REL-04**: Many2many fields may reference data-source records; m2m-to-data-source relations must resolve correctly — this was structurally blocked in Go v1 and must be fixed from the start.
- [ ] **REL-05**: After each `Create` step in apply, the new record's remote integer ID is registered in `GlobalLiveState` before the next step executes, so that later steps referencing it via m2m or m2o resolve to the correct ID.
- [ ] **REL-06**: Many2many writes use the `(6, 0, [ids])` tuple-command protocol required by Odoo's `write()` API; the apply layer never passes a flat ID list directly.
- [ ] **REL-07**: Inline One2many children are declared under their parent resource and their identity is scoped to the parent context; they participate in cycle detection alongside top-level resources.
- [ ] **REL-08**: Within a dependency level, the apply executor orders operations as: Creates before Updates before Deletes/Archives.

---

### SAFE — Safety Behaviors

Delete, archive, and reject behaviors, and the no-silent-adoption guarantee.

- [ ] **SAFE-01**: Each managed resource declares a `delete_behavior` property with one of three values: `delete` (hard delete via `unlink`), `archive` (set `active=False`), or `reject` (refuse to apply if removal is needed; halt with an actionable error).
- [ ] **SAFE-02**: When `delete_behavior` is `archive`, the engine verifies the model's archivability from the schema snapshot before attempting to archive; if the model has no writable `active` field, the engine reports an error and halts.
- [ ] **SAFE-03**: `plan` and `apply` never silently adopt an unmanaged Odoo record — if a resource in the DSL matches an existing Odoo record that has no managed xmlid, the plan action is `Reject` (adoption conflict), not `Create` or `Update`, until the operator runs `import` explicitly.
- [ ] **SAFE-04**: The `apply` command shows the full plan and prompts "Apply these changes? [y/N]" before any Odoo mutation; the `--auto-approve` flag skips the prompt for CI use.
- [ ] **SAFE-05**: Apply stops on the first failed step and reports which prior steps committed and which steps were skipped, so the operator has a clear recovery surface without needing to re-inspect Odoo manually.

---

### UX — User Experience and CLI

The command-line interface, plan output format, exit codes, and progress reporting.

- [ ] **UX-01**: The CLI exposes exactly five top-level commands: `plan`, `apply`, `verify`, `import`, `snapshot`.
- [ ] **UX-02**: `plan` exits with code `0` when there are no pending changes, `2` when changes are pending, and `1` on error; this matches IaC CLI convention (Terraform precedent).
- [ ] **UX-03**: `plan` output shows each resource's slug, Odoo model, pending action (`Create | Update | NoOp | Delete | Archive | Reject`), and — for `Update` — each changed field with old and new values.
- [ ] **UX-04**: `apply` output shows a `[N/total]` progress counter and per-step status (`ok | error | skipped`) as steps execute; partial progress is reported even when apply halts on failure.
- [ ] **UX-05**: All plan, apply, and verify output is rendered via Rich (tables, unified diffs, progress bars); plain-text fallback is available when stdout is not a TTY.
- [x] **UX-06**: The CLI is implemented with Typer; every async command function bridges via `asyncio.run()` (Typer 0.25.1 does not natively run async).

---

### VAL — Acceptance Validation

End-to-end acceptance tests against real Odoo 17 CE via testcontainers.

- [ ] **VAL-01**: The projects-and-stages lifecycle scenario passes: all four fixture files are ported (`01-initial.py`, `02-mid-lifecycle.py`, plus the corresponding apply sequences), all 5 subtests pass (initial apply, idempotent re-apply, mid-lifecycle update, delete/archive/reject paths, verify post-apply), against real Odoo 17 CE + PostgreSQL 16 via testcontainers. Target: ~95s wall clock.
- [ ] **VAL-02**: The module-install, namespaced-config, and server-action scenario passes: all four fixture files are ported, 3 subtests pass and 1 is correctly-SKIP (module already installed branch), against real Odoo 17 CE + PostgreSQL 16 via testcontainers. Target: ~58s wall clock.
- [ ] **VAL-03**: The test suite meets or exceeds the TS `odoo-state-manager` benchmark of 29 test files / 4,564 LOC across unit, integration, and acceptance tests combined.

---

### META — Metadata and Introspection Commands

Engine introspection and managed-state query surface.

- [ ] **META-01**: The engine exposes a way to list all resources currently under management for a given config file (equivalent to `terraform state list`); implemented as output of `plan` showing all resources and their current action.
- [ ] **META-02**: The schema registry provides a CLI subcommand or flag to dump the cached schema snapshot for a model, showing all field metadata including the `store` flag, for debugging and verification.
- [ ] **META-03**: The `verify` command, when run standalone (not post-apply), checks all managed resources for out-of-band drift against the config and reports resources that differ from desired state.

---

### EXEC — Execution Behaviors

Apply execution contract beyond the core pipeline.

- [ ] **EXEC-01**: The apply executor supports cancellation (SIGINT/KeyboardInterrupt) at any step boundary; in-flight module install/upgrade operations are the primary target for cancellation threading via godoo-py `ModuleManager`.
- [ ] **EXEC-03**: The `snapshot` command exports all records managed by the config to a versioned JSON artifact (version field, export timestamp, model-keyed record data with transitive Many2one dependencies resolved); the restore sub-command imports the artifact into a target Odoo instance with configurable conflict handling (`skip | error`).

*(EXEC-02 — whole-plan DB transaction — is out of scope; see v2/Deferred.)*

---

### PKG — Packaging and Release

PyPI publication, licensing, and public release readiness.

- [ ] **PKG-01**: The package is published to PyPI under the name `godoo-stateman`; the `pyproject.toml` declares `requires-python = ">=3.14"`, the LGPL-3.0 license, and all runtime dependencies with pinned minimum versions.
- [ ] **PKG-02**: Every Python source file carries an LGPL-3.0 license header comment.
- [ ] **PKG-03**: The public `README.md` positions the tool as "Terraform for Odoo" and includes a minimal quickstart (install, write a config, run `plan`, run `apply`).
- [x] **PKG-04**: The `pyproject.toml` uses the hatchling build backend, matching the godoo-py packaging convention used across the godoo-dev umbrella.
- [x] **PKG-05**: The GitHub repository is public (`godoo-dev/godoo-stateman`), and the `CLAUDE.md` `@`-imports `../godoo-hq/UMBRELLA_CLAUDE.md` so the repo is umbrella-aware from first clone.

---

## v2 / Deferred

Acknowledged but not in the v1 roadmap. Moving any item from here to v1 requires a roadmap update.

### Build and Lockfile Artifact

- **RSRC-v2-01**: A `build` command evaluates the DSL and serializes a portable, reviewable, committable lockfile artifact (JSON) representing the ordered plan steps without resolved remote IDs (machine- and state-dependent values must not be embedded). `apply --from-lockfile` consumes the artifact instead of raw DSL — enabling plan-in-CI / apply-in-CD separation.
- **RSRC-v2-02**: The lockfile format is documented and versioned; stale lockfiles (produced against a different schema snapshot) are detected and rejected before apply.

### Broader Standalone Drift Scan

- **CORE-v2-01**: `verify --all-managed` scans every resource under management (not just touched resources) for out-of-band drift; produces a full drift report without performing any apply.

### Multi-Odoo-Version Schema Registry

- **SCHEM-v2-01**: The schema registry supports multiple concurrent Odoo versions (e.g., Odoo 16, 17 CE, 17 EE, 18); the `OdooVersion` seam introduced in v1 SCHEM-01/SCHEM-04 accommodates this without a breaking schema format change.
- **SCHEM-v2-02**: The registry detects the `/jsonrpc` deprecation path (deprecated Odoo 19, removal ~Odoo 22) and documents the migration seam so a future transport substitution (JSON-2 API) can be introduced without a full rewrite.

### EXEC-02 Research

- **EXEC-v2-02**: Research whether a future Odoo transport mechanism (e.g., JSON-2 RPC API or an official batch endpoint) could support a cross-step transaction boundary; if viable, EXEC-02 (whole-plan DB transaction) is re-evaluated. Do not re-litigate under the current jsonrpc transport — the constraint is a protocol fact, not a missing feature.

---

## Out of Scope

Explicitly excluded to prevent scope creep. Each item has been deliberately rejected as a load-bearing decision.

| Feature | Reason |
|---------|--------|
| OpenTofu / Terraform provider (PROV-01..03) | Rejected as a load-bearing architectural decision. Provider model couples stateman to HCL DSL, OpenTofu release cadence, and provider SDK. Do not re-litigate. |
| HCL config surface | Replaced by the Pythonic DSL. Less expressive for programmatic config generation; Python gives walrus operator, functions, imports, and `resolve()` naturally. |
| TypeScript DSL (`odoo-state-manager` DSL) | TypeScript-specific; replaced by this project. Conceptual salvage only — no code port. |
| All Go source code from the v1 prototype | Design salvaged; running code discarded. No Go files are ported or executed. |
| EXEC-02 — whole-plan DB transaction | Not achievable over jsonrpc: each `execute_kw` call is its own committed SQL transaction. There is no cross-call transaction boundary. Future research only (see v2/Deferred). |
| Automatic rollback on apply failure | Impossible over jsonrpc for the same reason as EXEC-02. Stop-on-first-failure + partial progress report + `verify` recovery is the correct strategy. |
| Silent adoption of unmanaged records | Violates SAFE-03. Silent adoption masks data ownership ambiguity. Use `import` explicitly. |
| `--target slug` (targeted partial apply) | Semantically ambiguous under a dependency graph. Terraform calls this an emergency-only escape hatch and warns against normalization of it. Risk of partial state drift outweighs convenience. |
| In-process Odoo execution / Odoo addon | Requires server-side deployment; eliminates zero-footprint property; couples to Odoo internal API. jsonrpc-only boundary is locked. |
| Sidecar state file / local state DB | Breaks two-machine convergence. `ir.model.data` IS the state. Local caching must never be load-bearing for identity. |
| Watch / continuous reconciliation mode | Turns a deliberate mutation tool into a daemon; reduces auditability; Odoo is not designed for continuous external reconciliation loops. |
| GUI / web UI | Out of scope for a CLI tool. Build a wrapper UI as a separate project if needed. |

---

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 2 | Complete |
| CORE-02 | Phase 2 | Complete |
| CORE-03 | Phase 3 | Pending |
| CORE-04 | Phase 3 | Pending |
| CORE-05 | Phase 4 | Pending |
| CORE-06 | Phase 4 | Pending |
| CORE-07 | Phase 5 | Pending |
| CORE-08 | Phase 2 | Complete |
| CORE-09 | Phase 5 | Pending |
| SCHEM-01 | Phase 1 | Complete |
| SCHEM-02 | Phase 1 | Complete |
| SCHEM-03 | Phase 1 | Complete |
| SCHEM-04 | Phase 1 | Complete |
| SCHEM-05 | Phase 1 | Complete |
| IDENT-01 | Phase 3 | Pending |
| IDENT-02 | Phase 3 | Pending |
| IDENT-03 | Phase 3 | Pending |
| IDENT-04 | Phase 3 | Pending |
| IDENT-05 | Phase 3 | Pending |
| RSRC-01 | Phase 2 | Complete |
| RSRC-02 | Phase 2 | Complete |
| RSRC-03 | Phase 2 | Complete |
| RSRC-04 | Phase 2 | Complete |
| RSRC-05 | Phase 2 | Complete |
| RSRC-06 | Phase 2 | Complete |
| RSRC-07 | Phase 2 | Complete |
| RSRC-08 | Phase 5 | Pending |
| REL-01 | Phase 2 | Complete |
| REL-02 | Phase 2 | Pending |
| REL-03 | Phase 3 | Pending |
| REL-04 | Phase 3 | Pending |
| REL-05 | Phase 4 | Pending |
| REL-06 | Phase 4 | Pending |
| REL-07 | Phase 2 | Pending |
| REL-08 | Phase 4 | Pending |
| SAFE-01 | Phase 4 | Pending |
| SAFE-02 | Phase 4 | Pending |
| SAFE-03 | Phase 3 | Pending |
| SAFE-04 | Phase 4 | Pending |
| SAFE-05 | Phase 4 | Pending |
| UX-01 | Phase 3 | Pending |
| UX-02 | Phase 3 | Pending |
| UX-03 | Phase 3 | Pending |
| UX-04 | Phase 4 | Pending |
| UX-05 | Phase 3 | Pending |
| UX-06 | Phase 1 | Complete (01-01) |
| VAL-01 | Phase 4 | Pending |
| VAL-02 | Phase 5 | Pending |
| VAL-03 | Phase 5 | Pending |
| META-01 | Phase 3 | Pending |
| META-02 | Phase 5 | Pending |
| META-03 | Phase 5 | Pending |
| EXEC-01 | Phase 5 | Pending |
| EXEC-03 | Phase 5 | Pending |
| PKG-01 | Phase 6 | Pending |
| PKG-02 | Phase 6 | Pending |
| PKG-03 | Phase 6 | Pending |
| PKG-04 | Phase 1 | Complete (01-01) |
| PKG-05 | Phase 1 | Complete (01-01) |

**Coverage:**
- v1 requirements: 59 total (note: original count of 57 was a miscalculation; the actual count is 59 as enumerated above)
- Mapped to phases: 59
- Unmapped: 0 ✓

---

*Requirements defined: 2026-05-23*
*Last updated: 2026-05-23 — traceability table filled by roadmapper; all 59 v1 requirements assigned to phases 1-6*
