# godoo-stateman

## What This Is

A standalone Python CLI — "Terraform for Odoo" — that reconciles Odoo instance state
remotely over jsonrpc. It evaluates a Python DSL describing desired Odoo state, diffs
it against live Odoo, and executes a plan of creates/updates/deletes/archives in
dependency order. Designed for community use, released under LGPL-3.0, targeting the
Odoo 17.0, 18.0, and 19.0 ecosystem via `godoo-py` for transport and introspection.

## Core Value

Deterministic, idempotent Odoo state reconciliation from a version-controlled Python config
file — without an agent, an addon, or a sidecar state file.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ported v1 spec is the design reference, not yet shipped here)

### Active

<!-- Current scope. Building toward these. -->

**DSL / Config evaluation**
- [ ] Python `.py` config file evaluated into a desired-state resource tree with no side effects against Odoo
- [ ] `resource.<type>(slug, **fields)` constructor; positional slug is the stable identity key
- [ ] `data.<type>(**selector)` for read-only references to existing Odoo records
- [ ] `with` blocks for resource scopes; attribute assignment for fields
- [ ] `mail.config["key"] = "val"` sugar via `odoo_module` helper
- [ ] `resolve()` escape hatch for structure-depends-on-resolved-value patterns
- [ ] Walrus-operator convention for intermediate references
- [ ] `build` command produces a lockfile artifact from the evaluated DSL

**Normalize / Diff**
- [ ] Canonicalize Odoo values and relation shapes for deterministic diffing
- [ ] Propagate explicit identity metadata (xmlid) through the normalize pass
- [ ] Per-resource plan actions: `Create | Update | NoOp | Delete | Archive | Reject`

**Dependency graph**
- [ ] Build a dependency DAG across managed resources, inline children, and data sources
- [ ] Cycle detection across mixed node types
- [ ] Data-source reads resolve at the plan stage ("read seam")

**Plan**
- [ ] Serialize an ordered, reviewable set of plan steps
- [ ] `plan` command outputs human-readable diff before any mutation

**Apply over jsonrpc**
- [ ] Execute steps sequentially in dependency order over jsonrpc
- [ ] Stop on first failure; report partial progress; no automatic rollback
- [ ] Address → remote_id resolver for cross-apply m2m relations against global LiveState
- [ ] Module install/upgrade treated as highest-risk step class; cancellation threaded through all long ops

**Verify / re-plan**
- [ ] Post-apply re-plan; touched-resource verification + optional broader managed-drift check
- [ ] `verify` command as standalone drift detection

**xmlid identity model**
- [ ] State lives in Odoo's `ir.model.data` — no sidecar state file
- [ ] Two runs from two machines with no shared state file converge identically
- [ ] All 35 v1 requirements (CORE, SCHEM, IDENT, RSRC, REL, SAFE, UX, VAL families) satisfied

**Import action**
- [ ] `import` CLI command adopts existing Odoo records by writing an xmlid
- [ ] plan/apply never silently adopts unmanaged records (SAFE-03 enforced)

**Snapshot / restore**
- [ ] `snapshot` command exports managed-resource data to a portable artifact
- [ ] Restore from snapshot artifact

**Schema snapshot with version seam + store flag**
- [ ] Per-model: name, archivability, naming metadata
- [ ] Per-field: name, type, `store` flag (mandatory — BUG-07-B lesson), writability, relation target
- [ ] Explicit Odoo-version dimension in the schema registry from the start
- [ ] `store` flag captured in every schema snapshot

**SAFE delete/archive/reject behaviors**
- [ ] `delete_behavior` per resource: `delete | archive | reject`
- [ ] Safety surface matches Go v1 `delete_behavior` + TS `SafetyLevel/SafetyContext` rigour

**Acceptance fixtures**
- [ ] VAL-01: projects + stages lifecycle — all 4 fixture files (initial + mid-lifecycle), 5/5 subtests pass against real Odoo 17 via testcontainers
- [ ] VAL-02: module + namespaced config + server action — all 4 fixture files, 3 PASS + 1 correctly-SKIP against real Odoo 17 via testcontainers

### Out of Scope

- **OpenTofu provider (PROV-01..03)** — ruled out as load-bearing decision; do not re-litigate. Infrastructure-as-code provider path is dead.
- **HCL config surface** — Go v1 used HCL; replaced by Pythonic DSL.
- **TS `odoo-state-manager` DSL** — TypeScript-specific; deprecated in favour of this project. Conceptual salvage only; no code port.
- **All Go source code from `C:\dev\godoo`** — design salvaged; running code discarded.
- **EXEC-02 (whole-plan DB transaction)** — not achievable over jsonrpc (each call is its own transaction). Future research item only.
- **In-process Odoo execution / Odoo addon** — jsonrpc-only boundary is locked. No server-side component.

---

## Context

### Umbrella

`godoo-stateman` is one satellite in the `godoo-dev` multi-repo initiative. The shared
umbrella context (topology, three-layer architecture, spine's coordination role, load-bearing
rules) lives in `../godoo-hq/UMBRELLA_CLAUDE.md` and must be `@`-imported by this repo's
`CLAUDE.md`. Do not restate umbrella facts here — load them from the spine.

### Prior Art Salvaged

| Source | What is salvaged | What is discarded |
|--------|-----------------|-------------------|
| Go `godoo` v1 (`C:\dev\godoo`) | 7-stage pipeline design; xmlid identity model; 35 v1 requirements; VAL-01/VAL-02 acceptance fixtures; schema snapshot format; hard-won Odoo-reality lessons | All Go source code |
| TS `odoo-state-manager` | plan/apply/diff/clone conceptual surface; snapshot/restore concept; SafetyLevel/SafetyContext safety model; test coverage discipline (29 files / 4,564 LOC benchmark) | TypeScript DSL; all TS source |

### The 7-Stage Reconciliation Pipeline

```
config → normalize → graph → diff → plan → apply → verify
```

- **config** — evaluate the Python DSL into a desired-state resource tree (no Odoo calls)
- **normalize** — canonicalize values and relation shapes; propagate xmlid metadata
- **graph** — build dependency DAG; cycle detection across managed resources, inline children, data sources
- **diff** — desired vs. live (LiveState); produce per-resource plan actions
- **plan** — serialize ordered, reviewable steps; data-source reads resolve here ("read seam")
- **apply** — execute steps in dependency order over jsonrpc; stop-on-first-failure; report partial progress; no automatic rollback
- **verify** — re-plan post-apply; touched-resource + optional broader managed-drift check

### Hard-Won Odoo-Reality Lessons (ground every field claim before locking a decision)

- `project.project` in Odoo 17 CE has **no `member_ids`** — use `favorite_user_ids` instead
- `project.task.type` **is archivable** on Odoo 17 CE (`active` is writable) — contrary to some planning docs; do not let assumptions override a live snapshot
- **m2m relations to data sources** were structurally blocked in v1 — the rebuild must fix this from the start
- **Cross-apply m2m remote-id resolution** in v1 did not consult global `LiveState` — the rebuild's apply layer needs a proper `address → remote_id` resolver
- **Module install/upgrade is NOT atomic** — treat as the highest-risk step class; thread cancellation through every long op
- **`store` flag** must be captured in the schema snapshot (BUG-07-B lesson) — do not omit

### Go v1 Acceptance Scenarios (acceptance fixtures for v1 here)

- **VAL-01** — projects + stages lifecycle: 5/5 subtests PASS, ~95s wall clock, real Odoo 17 + PostgreSQL 16. Port all four fixture files including `02-mid-lifecycle` (delete/archive/reject paths).
- **VAL-02** — module + namespaced config + server action: 3 PASS + 1 correctly-SKIP, ~58s. Port all four fixture files.

### Key Dependency

`godoo-py` provides jsonrpc transport and introspection. `godoo-stateman` and `godoo-py`
must be developed in concert — the schema-snapshot layer depends on `godoo-py` introspection
capabilities.

### Report-Back Obligation

On adoption completion, append one `## YYYY-MM-DD — <title>` entry (newest-first) to
`../godoo-hq/.planning/dev-log.md`, confirming: CLI functional with all five commands,
VAL-01/VAL-02 passing, Go v1 formally superseded. Full format: `../godoo-hq/.planning/notes/report-back-mechanism.md`.

---

## Constraints

- **Tech stack**: Python CLI; jsonrpc-only Odoo interface via `godoo-py`. No Go, no TypeScript, no server-side Odoo component.
- **Python version**: Target the version required by `godoo-py` (verify before locking).
- **State boundary**: State lives exclusively in Odoo's `ir.model.data`. No sidecar state file, no local DB.
- **Odoo version**: Tested against Odoo 17.0, 18.0, and 19.0 (CE). The schema-snapshot/registry layer carries an explicit Odoo-version dimension.
- **Test harness**: Acceptance tests run against real Odoo 17.0, 18.0, and 19.0 via testcontainers. Unit/integration split matches or exceeds TS benchmark (29 files / 4,564 LOC).
- **Packaging**: PyPI public release. Licensing: LGPL-3.0.
- **Repo**: `godoo-dev/godoo-stateman` public GitHub repo (`gh repo create --public`).
- **CLAUDE.md**: Must `@`-import `../godoo-hq/UMBRELLA_CLAUDE.md`. This is a hard wiring requirement, not optional.
- **No code transfer**: No Go source from `C:\dev\godoo` is ported. Design only.

---

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Python CLI over jsonrpc; no OpenTofu provider, no Odoo addon, no in-process execution | Simplest deployment surface; no server-side change required; jsonrpc is the only stable remote API | — Pending |
| State/identity in Odoo `ir.model.data` / xmlid; no sidecar state file | Two machines with no shared file still converge; leverages Odoo's own stable external-ID mechanism | — Pending |
| LGPL-3.0, PUBLIC repo, PyPI packaging | Aligns with FOSS-first principle; "Terraform for Odoo" is a community-facing framing; broadens adoption | — Pending |
| REIMPLEMENT CLEAN — diverges from charter recommendation of port-stage-by-stage | Build the Python engine from scratch using Go v1 only as written spec; VAL-01/VAL-02 fixtures are the final acceptance gate, not a per-stage port harness; roadmap organizes around capabilities, not stages-as-port-units | — Pending |
| Odoo 17 first, but version seam NOW | Explicit Odoo-version dimension in the schema-snapshot/registry layer from the start; `store`-flag capture (BUG-07-B) lands in this layer | — Pending |
| FULL DSL ergonomics in v1 | v1 includes core surface (resource/data/with/mail.config) PLUS `resolve()` escape hatch, build-to-lockfile artifact, and walrus-operator convention | — Pending |
| `import` is a CLI action, not a DSL construct | SAFE-03: plan/apply must never silently adopt unmanaged records; adoption is always explicit | — Pending |
| EXEC-02 (whole-plan DB transaction) is out of scope | Not achievable over jsonrpc where each call is its own transaction; genuine future research item, not a near-term goal | — Pending |
| `godoo-adoption` protocol applies in design-adopt form only | No code transfer; protocol governs the design-adopt relationship conceptually; source/shed steps do not apply | — Pending |

---

## Evolution

PROJECT.md evolves throughout the project lifecycle.

**After each phase transition:**
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone:**
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state (users, feedback, metrics)

---

*Last updated: 2026-05-23 after initialization*
