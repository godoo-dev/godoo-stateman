# Phase 3: Diff + Plan + Import CLI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-26
**Phase:** 3-diff-plan-import-cli
**Areas discussed:** Reject / adoption-conflict detection, Managed-set scoping (dropped), Plan output & diff rendering, `import` command surface
**Mode:** advisor (research-backed comparison tables; calibration tier = standard; non-technical-owner = false)

---

## Reject / adoption-conflict detection

First framed (advisor research) as *how to detect a natural-identity duplicate*:

| Option | Description | Selected |
|--------|-------------|----------|
| Unique-constraint probe (best-effort) | Read single-column UNIQUE from ir.model.constraint + _rec_name, search target model | |
| Explicit `natural_key=` in DSL | Author declares the identity field(s) per resource | |
| Probe now, natural_key later | Ship probe in Phase 3, add natural_key as follow-on | |

**User's choice (override):** *"I don't think this is a stateman concern. If the user attempts a
duplicate either Odoo rejects it on apply, or doesn't. It is an Odoo concern."*

Re-framed around the conflict with locked SAFE-03 / SC-3 / CORE-03:

| Option | Description | Selected |
|--------|-------------|----------|
| Keep Reject for xmlid-collision only | Reject fires only when requested (prefix, slug) xmlid already bound to a different model in ir.model.data; drop natural-identity entirely; redefine SAFE-03/SC-3 | ✓ |
| Drop Reject entirely | Actions become Create/Update/NoOp/Delete/Archive; edit CORE-03/SAFE-03/SC-3 to remove Reject | |
| Keep as-is, rethink later | Leave requirements unchanged, revisit before planning | |

**User's choice:** Keep Reject for xmlid-collision only.
**Notes:** stateman is purely xmlid-driven. Natural-identity / duplicate detection is rejected as
out of remit — Odoo's constraints arbitrate duplicates at apply. `Reject` survives only for the
deterministic xmlid-namespace-collision case (different model bound to the requested xmlid).
Requires updating ROADMAP SC-3 + REQUIREMENTS SAFE-03 wording (flagged in CONTEXT D-03). → D-01, D-02, D-03.

---

## Managed-set scoping (Delete/Archive) — RAISED THEN DROPPED

Presented as a gray area (module-name enumeration vs reserved namespace vs slug-filter), but the
user pointed out the framing conflated the xmlid-namespace string with installable Odoo modules,
and that the scope is fully determined by author-chosen prefix.

**Outcome:** Dropped as a discussion topic. Settled by prior locked decisions (Phase-1 D-10/D-11,
Phase-2 D-02): managed universe = ir.model.data rows whose namespace = the config's `xmlid_prefix`.
No reserved namespace, no slug filter. → D-04.

---

## DSL rename (emerged during discussion)

**User request:** rename `module = "..."` → `xmlid_prefix = "..."` to avoid confusion with
installable Odoo modules (which are resources, Phase 5).
**Outcome:** Accepted. Revises Phase-2 D-02; touches shipped Phase-2 code. → D-05.

---

## Plan output & diff rendering

| Option | Description | Selected |
|--------|-------------|----------|
| Terraform-style flat annotated list | +/~/-/x prefixes, `field: old → new` indented, NoOp hidden, topo order | ✓ |
| Single summary Rich table | One row per resource + field-change count | |
| Per-resource Rich panels + diffs | Panel + Syntax('diff') per resource | |

**User's choice:** Terraform-style flat annotated list.
**Notes:** plain `field: old → new` lines (not Syntax diff); NoOp hidden by default, `--verbose`
shows; topological order + slug tie-break for SC-2 determinism; non-TTY fallback via Rich Console.
→ D-06, D-07, D-08, D-09.

---

## `import` command surface

| Option | Description | Selected |
|--------|-------------|----------|
| `--id` only, validate-then-upsert (+`--force`) | Verify exists, check binding, no-op if same, error+force if conflict | ✓ |
| `--id` + `--domain`, validate-then-upsert | Also accept a domain resolving to exactly one record | |
| `--id` only, error-on-existing | Refuse if any xmlid already exists | |

**User's choice:** `--id` only, validate-then-upsert with `--force`.
**Notes:** existence check before write; idempotent no-op on same binding (IDENT-05); `--force`
required to rewrite a conflicting binding (SAFE-03). `--domain` + batch deferred. → D-10, D-11, D-12.

---

## Claude's Discretion

- LiveState fetch strategy (batch vs per-model search_read; field projection) — must be
  deterministic + read-only.
- Module/class layout for diff/plan/livestate code; `PlanStep`/action model shape; new error
  subclasses.
- Exact archive/NoOp symbols in the annotated list.
- Whether read-seam resolution is a dedicated stage module or lives in the plan stage.

## Deferred Ideas

- `import --domain` selector (IDENT-04 "id or domain").
- Batch `import`.
- Optional `natural_key=` DSL declaration — explicitly rejected (D-01), recorded as a conscious "no".
- ROADMAP/REQUIREMENTS wording update (SC-3 / SAFE-03) — required correction before verification.
