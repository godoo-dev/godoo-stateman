# godoo-stateman — Project Seed

> A standalone Python CLI — "Terraform for Odoo" — that reconciles Odoo state
> remotely over jsonrpc. Ports the verified 7-stage reconciliation design from the
> closed Go v1 prototype.

**Seed written:** 2026-05-18
**Status:** Pre-charter. This document is the input to a `/gsd:new-project` pass.
**Supersedes:** `godoo-stateman-SEED.md` (`C:\dev\godoo-dev\godoo-stateman-SEED.md`) — that
document is the strategic charter input; this brief operationalizes it with the adoption
protocol and report-back.

---

## Orientation — read this first if you cloned this repo cold

**The `godoo-dev` umbrella** is a multi-repo initiative — the *godoo / Odoo Atlas
initiative* — to build a coherent family of Odoo tooling across languages, plus a
desktop surface and a state manager, all coordinated from a single vantage point (the
`godoo-hq` *spine*). **The godoo library family** is the core of that initiative: the
TypeScript library monorepo (`godoo-ts`), the Python library monorepo (`godoo-py`), and
this state manager (`godoo-stateman`).

**What this document is — an adoption brief.** This `SEED.md` is the *adoption brief*
that seeds this repo: a self-orienting charter document, committed as `godoo-stateman`'s
first commit, and consumed directly as the `/gsd:new-project` input that bootstraps this
repo's own Layer-1 GSD project. It states what `godoo-stateman` is for, what it must
deliver, what success looks like, and how it relates to the rest of the initiative.

**What `godoo-stateman` is adopting, and why.** `godoo-stateman` is a fresh Python state
manager. It *salvages the design* of the earlier closed Go `godoo` v1 state manager and
the *concepts* of the TypeScript `odoo-state-manager` package. No running code is
transferred from either source — only design and concepts. The Python engine is a
from-scratch reimplementation of a reconciliation model already verified end-to-end
against real Odoo 17.

**Umbrella context.** This brief assumes the shared umbrella context and does not
restate it. Load it: `@../godoo-hq/UMBRELLA_CLAUDE.md` — the canonical "what every
umbrella project must know" file, `@`-imported by every project under the `godoo-dev`
umbrella (topology, three-layer architecture, the spine's role, the load-bearing
coordination rules).

---

## 0. What this document is

This adoption brief is issued by the `godoo-hq` spine as part of the v1.1 Umbrella
milestone. It extends and operationalizes `godoo-stateman-SEED.md` (the strategic vision
reference at `C:\dev\godoo-dev\godoo-stateman-SEED.md`). The pre-existing SEED remains the
authoritative strategic narrative — the detailed architecture decisions, design rationale,
hard-won lessons, and the full Python DSL worked examples all live there.

This brief adds adoption mechanics: the exact salvage inventory this satellite must carry
forward, the `godoo-adoption` protocol as it applies here (design-adopt, no code transfer),
and the report-back this satellite owes the spine at completion.

This document is directly consumable as the input to a `/gsd:new-project` charter pass.

---

## 1. Vision — what this satellite holds

`godoo-stateman` is a **standalone Python CLI** that reconciles Odoo state remotely over
jsonrpc. It is built from scratch in Python — no running code is transferred from any prior
source. The engine is a from-scratch Python reimplementation of a verified design.

**Core decision (locked):** Python CLI over jsonrpc. No OpenTofu provider. No Odoo addon.
No in-process execution. State/identity lives in Odoo (`ir.model.data`/xmlid); the engine
does not.

**Key dependency:** Leverages `godoo-py` (the Python client library) for jsonrpc transport
and introspection capabilities — both satellites must be developed in concert.

**Python authoring surface (from the strategic charter):** The `.py` config file describes
desired state; it is evaluated to build a resource tree with no side effects against Odoo.
Authoring conventions:
- `with` blocks for resource scopes; attribute assignment for fields
- `resource.<type>(slug, **fields)` constructors (positional slug is the stable identity)
- `data.<type>(**selector)` for read-only references
- Object references replace stringly-typed canonical addresses
- `mail.config["key"] = "val"` for module config sugar (`odoo_module` helper)

---

## 2. What to salvage

### From the Go v1 prototype (`C:\dev\godoo`)

The Go *source code* is discarded; the *design* is the primary reference — a reconciliation
model verified end-to-end against real Odoo 17. Port the design, not the code.

**The 7-stage reconciliation pipeline** (language-neutral; reproduced verbatim):
```
config → normalize → graph → diff → plan → apply → verify
```
- **config** — load declared desired state (v1: JSON decode; rebuild: evaluate the Python DSL into a desired-state tree)
- **normalize** — canonicalize Odoo values and relation shapes so diffing is deterministic; propagate explicit identity metadata
- **graph** — build a dependency DAG across managed resources, inline children, and data sources; cycle detection across mixed node types
- **diff** — desired vs. live (`LiveState`), producing per-resource plan actions: `Create | Update | NoOp | Delete | Archive | Reject`
- **plan** — serialize an ordered, reviewable set of plan steps; data-source reads resolve here (the "read seam")
- **apply** — execute steps sequentially in dependency order over jsonrpc; stop on first failure; report partial progress; no automatic rollback
- **verify** — re-plan post-apply; touched-resource verification + optional broader managed-drift check

**The xmlid identity model:** State lives in Odoo's `ir.model.data` — no sidecar state
file. A managed resource is found again on the next run because Odoo itself records the
xmlid. Two runs from two machines, with no shared state file, still agree.

**All 35 v1 requirements as a verified spec** (CORE, SCHEM, IDENT, RSRC, REL, SAFE, UX,
VAL families) — authoritative source: `C:\dev\godoo\.planning\REQUIREMENTS.md`.

**The two live validation scenarios as acceptance fixtures:**
- **VAL-01** — projects + stages lifecycle: 5/5 subtests PASS, ~95s wall clock against real Odoo 17 + PostgreSQL 16
- **VAL-02** — module + namespaced config + server action: 3 PASS + 1 correctly-SKIP, ~58s

Both scenarios have mid-lifecycle fixtures (`02-mid-lifecycle.tf`) that exercise
delete/archive/reject paths — port all four fixture files, not just the initial states.

**Hard-won Odoo-reality lessons** (ground every field/model claim against a live snapshot
before locking it into a decision):
- `project.project` in Odoo 17 CE has no `member_ids` — use `favorite_user_ids`
- `project.task.type` is archivable on Odoo 17 CE (`active` is writable) — contrary to some planning docs
- m2m relations to data sources were structurally blocked in v1 — fix from the start in the rebuild
- Cross-apply m2m remote-id resolution did not consult global `LiveState` — the rebuild's apply layer needs a proper `address → remote_id` resolver
- Module install/upgrade is not atomic — treat as highest-risk step class; thread cancellation through every long op
- `store` flag must be captured in the schema snapshot — BUG-07-B lesson

**The schema snapshot format** (JSON; lift verbatim from `C:\dev\godoo\internal\core\schema\`):
- Per model: name; archivability; naming metadata for generated type names
- Per field: name; type; the **`store` flag** (mandatory — do not omit); whether it is a writable relation; relation target model

**The import flow:** `import` is a CLI action (not a DSL construct) that adopts existing
Odoo records into managed state by writing an xmlid. Ordinary plan/apply never silently
adopts unmanaged records (SAFE-03).

**v2 requirements status (re-triage before chartering):**
- `PROV-01..03` → dead (OpenTofu provider ruled out — load-bearing decision, do not re-litigate)
- `META-01..03` → carry forward
- `EXEC-01..03` → carry forward, except `EXEC-02` (whole-plan DB transaction is not achievable over jsonrpc where each call is its own transaction; remains a genuine future research item)

### From TS `odoo-state-manager` (`C:\dev\odoo-toolbox\packages\odoo-state-manager`)

Conceptual salvage only — no direct code port. The TS package is TypeScript-specific and
is deprecated/handed off in favour of `godoo-stateman`. The Python rebuild draws on it as
a parallel design reference:

- **The plan/apply/diff/clone conceptual surface** — the Go v1 prototype independently
  arrived at the same high-level commands, providing convergent validation that these are
  the right top-level operations
- **The `exportData`/`importData` (snapshot/restore) concept** — no direct code port; a
  parallel design reference for the `godoo snapshot` command
- **Test coverage discipline** — the TS version has 29 test files / 4,564 LOC; the Python
  rebuild should match this investment in test coverage
- **The `SafetyLevel` / `SafetyContext` model** for write/delete protection — maps to the
  Go v1 `delete_behavior` concept (`delete | archive | reject`); adopt the same rigour in
  the Python safety surface

### What is discarded

- All Go source code from `C:\dev\godoo`
- The HCL config surface
- The OpenTofu provider ambition (`PROV-01..03` requirements — dead)
- The TS `odoo-state-manager` DSL (TypeScript-specific; replaced by Pythonic DSL)

---

## 3. godoo-adoption protocol — how it applies here

The `godoo-adoption` protocol is the initiative's shared mechanism for moving code
cleanly from a source repo into a satellite repo, using a shared `godoo-adoption` branch
on both the source (shed) and destination (adopt) sides so there is no period of
dual-maintenance. Its canonical definition lives in the spine:
`../godoo-hq/.planning/notes/godoo-adoption-protocol.md`.

**`godoo-stateman` is the destination / design-adopt side — and a special case.** The
protocol's normal subject is *code transfer*; for `godoo-stateman` there is no code
transfer at all. The Go source at `C:\dev\godoo` is discarded outright, and only the
*design* is salvaged. The protocol therefore governs the design-adopt relationship
*conceptually*, not as a literal file-move operation: `godoo-stateman` is the repo that
adopts what the closed Go v1 prototype produced, and the prototype is the source that is
shed once that adoption is complete.

Because no files move, the protocol's **"source / shed side" steps do not apply** to
`godoo-stateman` — there are no packages to remove incrementally and no deprecation
README to write on the source side beyond confirming the Go prototype is closed. The
**"destination / adopt side"** intent applies in spirit: do the adoption work on a
`godoo-adoption` branch in this repo, and report back to the spine on completion. See the
spine note above for the full protocol text and the which-side quick reference.

---

## 4. Report-back

When `godoo-stateman` completes its adoption work it files a single terminal report with
the spine: one `## YYYY-MM-DD — <title>` entry appended (newest-first) to the spine's
`dev-log.md`, naming the satellite, the completion date, and the verified outcomes. It is
a one-time "done" report, not a periodic status update; the spine verifies it by querying
this sibling repo directly. Full format, location, trigger, and verification rules:
`../godoo-hq/.planning/notes/report-back-mechanism.md`.

**At completion, godoo-stateman reports:**
- Python CLI functional with `plan`/`apply`/`verify`/`import`/`snapshot` commands
- VAL-01 and VAL-02 acceptance scenarios passing against real Odoo via testcontainers
- Go `godoo` v1 formally superseded and closed (the prototype repo at `C:\dev\godoo` is confirmed retired)

---

## 5. Org bootstrap

Create the satellite repo under the `godoo-dev` org during the satellite's own bootstrap:

```bash
gh repo create godoo-dev/godoo-stateman --private
```

Note: `godoo-stateman` is internal tooling. Visibility (`--private` vs `--public`) is the
satellite's decision — if the project is released under LGPL-3.0 it may be public. The
spine does not create satellite GitHub repos (D-03).

**CLAUDE.md wiring.** When `godoo-stateman` runs `/gsd:new-project`, the generated
`CLAUDE.md` must `@`-import the shared umbrella context — add the line
`@../godoo-hq/UMBRELLA_CLAUDE.md` to it. This keeps the repo umbrella-aware: a
freshly-cloned `godoo-stateman` immediately sees the topology, the spine's role, and the
load-bearing coordination rules without those being copied into this repo.

---

## 6. Open questions / discretion areas

These are left for the satellite's own `/gsd:new-project` planning pass. The strategic
charter (`godoo-stateman-SEED.md`) carries the full rationale for each.

**(a) Licensing / visibility** — whether `godoo-stateman` is LGPL-3.0 (public, for
community use as "Terraform for Odoo") or proprietary (private, internal tooling). The
topology naming note marks it as "internal tooling"; this brief uses `--private` as the
default. The satellite decides.

**(b) Internal consumer migration timeline** — An existing internal consumer of
`odoo-state-manager` will migrate to `godoo-stateman` once it reaches functional parity.
That migration is tracked in the consumer project's own planning.

**(c) Packaging** — PyPI public release vs. internal package registry. Related to the
licensing decision above.

**(d) DSL ergonomics** — the strategic charter (§6) specifies the core authoring surface
with worked examples (VAL-01, VAL-02 translated). Exact ergonomics beyond what the charter
specifies (e.g. the `resolve()` escape hatch for structure-depends-on-resolved-value, the
walrus operator convention, the `build`-to-lockfile artifact) are satellite decisions (see
open questions Q1–Q10 in `godoo-stateman-SEED.md`).

**(e) Engine reuse vs. clean reimplementation** — Q2 in the strategic charter: port
stage-by-stage with v1 VAL fixtures as the acceptance suite, or reimplement clean using v1
as spec. Recommendation in the charter: port stage-by-stage.

**(f) Odoo version coverage** — Q7: single-version-first (Odoo 17) is fine; decide whether
the snapshot/registry layer carries an explicit version seam now or later.
