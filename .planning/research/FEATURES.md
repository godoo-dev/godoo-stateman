# Feature Research

**Domain:** Declarative IaC state manager for Odoo ERP (jsonrpc-only, no sidecar state)
**Researched:** 2026-05-23
**Confidence:** HIGH (first-party TS reference code read directly; Terraform/Pulumi UX verified via official docs and web search; Go v1 design authoritative from PROJECT.md + SEED.md)

---

## Source Mapping

Before the feature table, a quick map of the v1 requirement families referenced throughout:

| Family | Scope |
|--------|-------|
| CORE | 7-stage pipeline, idempotency, jsonrpc boundary |
| SCHEM | Schema snapshot, field metadata, store flag, version seam |
| IDENT | xmlid identity model, ir.model.data, two-machine convergence |
| RSRC | resource(), data(), with-blocks, DSL evaluation, slug/stable identity |
| REL | Dependency DAG, m2m/m2o relation resolution, cross-apply resolver |
| SAFE | delete_behavior (delete / archive / reject), SAFE-03 no-silent-adoption |
| UX | Plan output format, exit codes, progress reporting, confirmations |
| VAL | VAL-01 projects+stages lifecycle; VAL-02 module+config+server-action |

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features a user coming from Terraform, Ansible, or Pulumi will expect immediately. Missing any of these = product feels like a prototype, not a tool.

| Feature | Why Expected | Command(s) | Complexity | REQ Family | Notes |
|---------|--------------|------------|------------|------------|-------|
| Human-readable plan/diff preview | Every IaC tool shows what will change before mutating; Terraform's plan output is the UX baseline | `plan` | MEDIUM | CORE, UX | Must show: resource slug, model, action (Create/Update/NoOp/Delete/Archive/Reject), changed fields with old→new values. Exit 0=no changes, exit 2=changes pending (matches TS CLI precedent) |
| Idempotent apply | Running apply twice must produce NoOp on second run; fundamental IaC promise | `apply` | HIGH | CORE, IDENT | Guaranteed by xmlid identity model — same slug + same Odoo = same ir.model.data record. Requires deterministic field normalization (many2one, m2m sort order, etc.) |
| Stop-on-first-failure with partial progress report | Users expect to know exactly which operations succeeded and which failed before the halt | `apply` | LOW | CORE, UX | Already in TS: stopOnError=true, per-operation status (ok/error/skipped), progress counter [N/total] |
| Dependency ordering | Creates must precede dependent creates; modules install before records that use them | `plan`, `apply` | HIGH | REL | Topological sort of DAG; within a level: creates before updates before deletes. Module install = level 0 (highest risk, non-atomic) |
| Delete / archive / reject safety behaviors | Odoo has archivable records; hard delete is destructive and often wrong; users need control | `apply` | MEDIUM | SAFE | Per-resource `delete_behavior: delete \| archive \| reject`. `reject` = refuse to run if a removal would be needed, force manual intervention. Maps to Go v1 + TS SafetyLevel |
| Explicit import for existing records | Adopting a live record must be deliberate; never silently on plan/apply | `import` | MEDIUM | SAFE, IDENT | SAFE-03: `import` CLI writes xmlid to ir.model.data for a specific record by model+ID or domain. plan/apply see it as managed thereafter. No DSL construct for this — always explicit CLI action |
| Drift detection / verify | After apply: confirm touched resources match desired. Standalone: check any managed resource for out-of-band changes | `verify`, `plan` | MEDIUM | CORE | Post-apply re-plan on touched resources = verify. `verify` as standalone = broader managed-drift check. TS already had drift field in ApplyResult |
| Confirmation prompt before destructive apply | Every IaC CLI asks "Do you want to perform these actions?" before mutating | `apply` | LOW | UX | `apply` shows plan, then `Apply these changes? [y/N]`. `--auto-approve` flag skips (for CI). Already in TS CLI |
| Snapshot export / restore | Point-in-time backup of managed record data; restore into fresh instance (testcontainers, staging) | `snapshot` | MEDIUM | — | Maps to TS exportData/importData: domain-driven BFS export with transitive m2o dependency resolution, versioned JSON artifact (version: 1), restore with conflict handling (skip/error) |
| Schema introspection with store-flag capture | Must know which fields are writable, computed, stored, relational — cannot diff what you cannot read | Internal (feeds plan/apply) | HIGH | SCHEM | BUG-07-B lesson: `store` flag is mandatory. Per-field: name, type, store, writable, relation target. Per-model: archivability. Explicit Odoo-version dimension in registry from day one |
| Two-machine convergence without shared state file | State lives in ir.model.data; two machines applying the same config against the same Odoo reach identical state | All | HIGH | IDENT | Core architectural constraint — not a feature to build, but a property to preserve. Any local caching must never become load-bearing for identity resolution |
| Data source references (`data.<type>`) | Read-only lookup of existing Odoo records; required for relating managed resources to unmanaged ones | DSL, `plan` | MEDIUM | RSRC, REL | Read seam: data sources resolve at plan stage (not apply). m2m to data sources must work — was structurally blocked in Go v1, must be fixed from the start |

### Differentiators (Competitive Advantage)

Features that set godoo-stateman apart from generic IaC tools and from a naive "write records via script" approach.

| Feature | Value Proposition | Command(s) | Complexity | REQ Family | Notes |
|---------|-------------------|------------|------------|------------|-------|
| Python DSL with no side effects on eval | Config file is executable Python; no YAML brittleness, no HCL learning curve; eval produces resource tree without touching Odoo | DSL, `plan` | HIGH | RSRC | `resource.<type>(slug, **fields)`, `with` blocks, `data.<type>()`, walrus-operator for intermediate refs. Eval must be pure — no Odoo calls during DSL evaluation |
| `resolve()` escape hatch | When structure depends on a resolved value (e.g., slug computed from a live record's name), `resolve()` lets you break out of the pure-eval constraint in a controlled seam | DSL | HIGH | RSRC | Rare but essential for real-world configs. Without it users hit walls on non-trivial setups |
| `build` command → lockfile artifact | Evaluate DSL to a portable, reviewable, committable artifact (the "lockfile"); apply consumes lockfile not raw DSL; enables plan-in-CI / apply-in-CD separation | `build`, `apply` | MEDIUM | RSRC | Terraform analogue: `terraform plan -out planfile`. The lockfile is the serialized ordered plan steps — reviewable JSON/TOML. Enables audit trail |
| xmlid-native identity (Odoo's own mechanism) | No external state backend to manage; no S3 bucket, no DynamoDB lock table, no `.tfstate` file to corrupt. Odoo IS the state. | All | HIGH | IDENT | Two-machine convergence is automatic. Import/export of records carries their identity. Disaster recovery = the Odoo database itself |
| Odoo-aware normalization | Knows that `many2one` returns `[id, name]` and must be compared as `id`; knows `many2many` order is irrelevant; knows which fields are system fields to skip | Internal, `plan` | HIGH | CORE | Generic IaC tools have no Odoo field semantics. Without this, every update produces false diffs |
| Module install as first-class operation | `ir.module.module` creates run at level 0 before any record operations; non-atomic installs are recognized as highest-risk and threaded with cancellation support | `apply` | HIGH | RSRC | Generic script approaches miss this entirely. Module install failure must halt the plan cleanly |
| `mail.config` sugar via `odoo_module` helper | Declarative namespaced config values (`ir.config_parameter`) with ergonomic syntax instead of raw record writes | DSL | LOW | RSRC | Eliminates a common boilerplate pattern in Odoo setup scripts |
| Translation-aware diff and apply | Field values in non-default languages (e.g., `name` in `fr_FR`) are tracked, diffed, and written as separate translation passes | `plan`, `apply` | MEDIUM | CORE | TS already supports this: TranslationEntry, per-lang read during diff, per-lang write after primary create/update |
| Inline child resource scoping | One2many children declared inline under their parent; identity scoped to parent context; cycle-detection across mixed parent/child nodes | DSL, `plan` | HIGH | REL | Reduces boilerplate vs declaring each child independently; preserves dependency ordering |
| Cross-apply m2m remote-id resolver | When apply creates resource A in level 1 and resource B (referencing A's new ID) in level 2, the address→remote_id resolver uses global LiveState so m2m fields get the right IDs | `apply` | HIGH | REL | Was broken in Go v1 (did not consult global LiveState). Critical for realistic configs with inter-resource m2m relations |
| `reject` as a safe default for removals | When a resource is removed from the DSL and `delete_behavior=reject`, the tool refuses to apply rather than destroying data. Forces conscious choice to delete or archive | `apply` | LOW | SAFE | No generic IaC tool has Odoo-domain knowledge that some records should never be hard-deleted. This is a product-level safety opinion |
| Acceptance-tested against real Odoo via testcontainers | VAL-01 and VAL-02 run against a real Odoo 17 + PostgreSQL 16 container; not mocked | — | HIGH | VAL | The TS package had 29 test files / 4,564 LOC; this benchmark is the test coverage floor |

### Anti-Features (Deliberately NOT Built)

Features that seem reasonable but are explicitly out of scope, with rationale.

| Anti-Feature | Why Requested | Why NOT Built | What to Do Instead | REQ Note |
|--------------|---------------|---------------|-------------------|----------|
| Whole-plan DB transaction (atomic apply) | "If any step fails, rollback everything" — sounds safe | Not achievable over jsonrpc. Each jsonrpc call is its own Odoo transaction. There is no cross-call transaction boundary to exploit | Stop-on-first-failure + partial progress report + manual remediation. `verify` detects what was left inconsistent | EXEC-02 explicitly out of scope |
| Automatic rollback | Complement to atomic transaction | Same reason as above. Even if you could undo each step, dependency order means reversal order is non-trivial and error-prone | Design the DSL so incremental apply is safe. Treat partial failure as a fixable state, not a catastrophe | Downstream of EXEC-02 |
| Silent adoption of unmanaged records | "Automatically manage any record that already exists" | Violates SAFE-03. Silent adoption masks data ownership ambiguity; the tool cannot know whether an existing record was intentionally left unmanaged | Use `import` CLI command explicitly for each record to adopt | SAFE-03 locked |
| OpenTofu/Terraform provider surface | "Reuse Terraform ecosystem, state backends, workspaces" | Load-bearing rejected decision (PROV-01..03 dead). Provider model couples godoo-stateman to HCL DSL, OpenTofu release cadence, and provider SDK complexity | godoo-stateman IS the IaC tool. No intermediate provider layer | PROV-01..03 out of scope |
| HCL config surface | Familiar to Terraform users | Replaced by Pythonic DSL. HCL is less expressive for programmatic config generation; Python gives walrus operator, functions, imports, and `resolve()` naturally | Python `.py` DSL | Out of scope |
| In-process Odoo execution / Odoo addon | Higher performance, access to ORM directly | Requires server-side deployment; eliminates zero-footprint property; couples to specific Odoo version's internal API | jsonrpc-only boundary is locked. godoo-py provides introspection over the same boundary | Locked constraint |
| Sidecar state file / local state DB | Familiar from Terraform (.tfstate) | Two-machine convergence breaks if state is local. Corruption/loss of state file = loss of identity. ir.model.data IS the state | xmlid identity model | Locked constraint |
| Targeted apply (`--target slug`) | Apply changes to only one resource, skip others | Dependency graph makes partial apply semantically ambiguous: if A depends on B and you target A, do you apply B? Targeted apply is Terraform's "escape hatch for emergencies" — normalizing it leads to partial state drift | Run full plan/apply. For phased rollout, structure DSL into separate config files applied independently | Not built; complexity vs value negative |
| Watch/continuous reconciliation mode | "Apply automatically when config changes" | Turns a deliberate mutation tool into a daemon; reduces auditability; Odoo is not designed for continuous external reconciliation loops | Integrate `apply` into CI/CD pipeline explicitly. Use `verify` on schedule for drift alerts | Not built |
| GUI / web UI | Point-and-click state management | Out of scope for a CLI tool; adds enormous surface area | CLI is the surface. Build a wrapper UI as a separate project if needed | Not built |

---

## Feature Dependencies

```
DSL evaluation (resource/data/with/resolve)
    └──requires──> Schema introspection (SCHEM)
                       └──required by──> Normalize / diff (field types for normalization)
                                             └──required by──> Plan (human-readable diff)
                                                                   └──required by──> Apply (execute ordered steps)
                                                                                         └──feeds──> Verify (post-apply re-plan)

Dependency DAG (REL)
    └──required by──> Plan (topo sort determines operation order)
    └──required by──> Cycle detection (graph-level validation before plan)

import CLI action
    └──required by──> Managed-state queries (import writes xmlid → plan/apply see as managed)

snapshot
    ├──requires──> Schema introspection (to know which fields to export)
    └──independent of──> Plan/apply pipeline (snapshot is data, not state management)

build → lockfile artifact
    └──requires──> DSL evaluation
    └──enables──> Plan-in-CI / apply-from-lockfile pattern

Cross-apply m2m resolver (REL)
    └──requires──> Apply level ordering (must know prior-level created IDs)
    └──required by──> m2m fields between resources created in same apply run

Translation support
    └──requires──> Plan (diff detects translation changes)
    └──requires──> Apply (writes translated values in per-lang context)
    └──independent of──> Core resource lifecycle (additive feature)
```

### Dependency Notes

- **Schema introspection requires godoo-py**: The SCHEM layer depends on godoo-py's introspection capabilities. Both must be developed in concert. The schema snapshot/registry must carry an explicit Odoo-version dimension from day one.
- **Data source resolve requires plan-stage Odoo read**: `data.<type>()` calls must happen at plan time (the "read seam"), not at DSL eval. This makes plan non-pure (it reads Odoo), but is unavoidable for dependency resolution.
- **m2m to data sources was broken in Go v1**: The rebuild must wire the data source resolver through the same LiveState map that record resolvers use, so m2m fields can reference data-source IDs correctly.
- **import enables plan/apply to recognize managed records**: Without `import`, any pre-existing record appears as "create conflict" (if slug matches) or is invisible to the tool entirely. import writes the xmlid bridge.
- **build lockfile and apply-from-lockfile are separable from interactive plan/apply**: Interactive workflow (plan then apply) and CI workflow (build → review lockfile → apply lockfile) can share the same engine; only the entry point differs.

---

## MVP Definition

### Launch With (v1) — All Five Commands Functional

The acceptance gate is VAL-01 and VAL-02 passing against real Odoo 17. Everything below is required to pass those tests.

- [ ] `plan` — human-readable diff output, exit 0/2, no Odoo mutation
- [ ] `apply` — sequential execution in dependency order, stop-on-first-failure, progress reporting, confirmation prompt, --auto-approve flag
- [ ] `verify` — post-apply touched-resource re-plan + standalone drift check
- [ ] `import` — adopt existing Odoo record by model+ID, writes xmlid to ir.model.data
- [ ] `snapshot` — export managed records to versioned JSON artifact; restore from artifact
- [ ] Python DSL: `resource.<type>(slug)`, `data.<type>()`, `with` blocks, `mail.config` sugar
- [ ] `resolve()` escape hatch (required by VAL-02 server action config pattern)
- [ ] Dependency DAG with cycle detection
- [ ] delete_behavior: delete / archive / reject per resource
- [ ] Schema snapshot with store flag, archivability, explicit Odoo-version dimension
- [ ] xmlid identity model: plan/apply never silently adopt unmanaged records (SAFE-03)
- [ ] Odoo field normalization: many2one, many2many, system-field exclusion, readonly/computed skip
- [ ] Translation diff and apply (required by VAL-02 module config scenario)

### Add After Validation (v1.x)

Features that improve usability once core correctness is confirmed:

- [ ] `build` → lockfile artifact: evaluate DSL to committable JSON plan file; `apply --from-lockfile` — trigger: first real CI/CD integration request
- [ ] walrus-operator convention documented and validated with examples — trigger: second consumer onboarding
- [ ] Broader managed-drift check in `verify` (currently: touched resources only in post-apply; `verify` as standalone should scan all managed resources) — trigger: first drift-detection in production use

### Future Consideration (v2+)

- [ ] Multi-version schema registry (currently Odoo 17 CE only; v2+ adds 16, 17 Enterprise, 18) — defer until community demand
- [ ] EXEC-02 (whole-plan DB transaction) — genuine future research item; not achievable over jsonrpc today; do not re-litigate until a new transport mechanism is available

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| plan — human-readable diff | HIGH | MEDIUM | P1 |
| apply — dependency-ordered execution | HIGH | HIGH | P1 |
| verify — drift detection | HIGH | LOW (re-uses plan engine) | P1 |
| import — explicit adoption | HIGH | MEDIUM | P1 |
| snapshot — export/restore | MEDIUM | MEDIUM | P1 (required by VAL-02) |
| Python DSL (resource/data/with) | HIGH | HIGH | P1 |
| resolve() escape hatch | MEDIUM | MEDIUM | P1 (required by VAL-02) |
| delete_behavior (delete/archive/reject) | HIGH | LOW | P1 |
| SAFE-03 no-silent-adoption | HIGH | LOW | P1 |
| Schema introspection + store flag | HIGH | HIGH | P1 |
| Dependency DAG + cycle detection | HIGH | HIGH | P1 |
| Field normalization (m2o, m2m, system) | HIGH | MEDIUM | P1 |
| Translation diff + apply | MEDIUM | MEDIUM | P1 (VAL-02) |
| Cross-apply m2m resolver | HIGH | HIGH | P1 (was broken in v1) |
| build → lockfile artifact | MEDIUM | MEDIUM | P2 |
| Broader standalone drift scan | MEDIUM | LOW | P2 |
| Multi-version schema registry | LOW | MEDIUM | P3 |
| Targeted apply (--target) | LOW | HIGH | ANTI-FEATURE |
| Automatic rollback | LOW | VERY HIGH | ANTI-FEATURE |

---

## IaC Convention Comparison

How godoo-stateman maps to established IaC UX conventions:

| Convention | Terraform | Pulumi | godoo-stateman |
|-----------|-----------|--------|----------------|
| Preview before mutate | `terraform plan` | `pulumi preview` | `godoo plan` |
| Apply with confirmation | `terraform apply` | `pulumi up` (interactive) | `godoo apply` (y/N prompt) |
| Skip confirmation (CI) | `--auto-approve` | `--yes` | `--auto-approve` |
| Adopt existing resource | `terraform import` | `pulumi import` | `godoo import` (CLI action, not DSL) |
| Detect drift | `terraform plan` (always) | `pulumi refresh` | `godoo verify` |
| State backend | S3/GCS/remote | Pulumi Cloud | ir.model.data in Odoo itself |
| Plan artifact (lockfile) | `terraform plan -out` | — | `godoo build` → lockfile JSON |
| Exit code: no changes | 0 | 0 | 0 |
| Exit code: changes pending | 2 | — | 2 |
| Destroy protection | `prevent_destroy` lifecycle | `retainOnDelete` | `delete_behavior: reject` |
| Targeted partial apply | `-target` (emergency only) | `--target-urn` | NOT BUILT (anti-feature) |
| Partial failure behavior | Halts, shows what succeeded | Halts, shows what succeeded | Halts, shows ok/error/skipped per op |
| State inspection | `terraform state list` | `pulumi stack` | `godoo plan` (shows all managed resources + actions) |

---

## Sources

- PROJECT.md (`C:\dev\godoo-dev\godoo-stateman\.planning\PROJECT.md`) — authoritative scope, 7-stage pipeline, locked decisions
- SEED.md (`C:\dev\godoo-dev\godoo-stateman\SEED.md`) — salvage inventory, requirement families, Go v1 lessons
- TS odoo-state-manager source read directly: `src/engine/plan.ts`, `src/engine/diff.ts`, `src/engine/apply.ts`, `src/engine/types.ts`, `src/clone/types.ts`, `src/clone/export.ts`, `src/dsl/types.ts`, `src/cli/cli.ts`
- [Terraform plan command reference](https://developer.hashicorp.com/terraform/cli/commands/plan) — MEDIUM confidence (web search verified)
- [Terraform apply command reference](https://developer.hashicorp.com/terraform/cli/commands/apply) — MEDIUM confidence
- [Terraform -target resource targeting](https://developer.hashicorp.com/terraform/tutorials/state/resource-targeting) — MEDIUM confidence
- [Pulumi import existing resources](https://www.pulumi.com/docs/iac/guides/migration/import/) — MEDIUM confidence
- [Pulumi drift detection](https://www.pulumi.com/docs/deployments/deployments/drift/) — MEDIUM confidence
- [Kubernetes operator reconciliation patterns](https://book.kubebuilder.io/reference/good-practices) — LOW confidence (pattern reference only)

---

*Feature research for: godoo-stateman — declarative IaC state manager for Odoo*
*Researched: 2026-05-23*
