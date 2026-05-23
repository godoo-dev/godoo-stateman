# Phase 2: DSL Eval + Pure Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-23
**Phase:** 2-dsl-eval-pure-pipeline
**Areas discussed:** DSL surface & module identity, resolve() semantics + DAG, Inline One2many child syntax, Schema access in pure pipeline
**Mode:** advisor (research-backed comparison tables; calibration tier = standard; non-technical-owner = false)
**Research input:** 4 parallel advisor-researcher agents + 1 scout of the real-world TS predecessor consumer (anonymized)

---

## DSL surface & module identity

Container shape presented as a near-locked default (typed frozen `DesiredState`); the open D-12 decision was module-identity sourcing.

| Option | Description | Selected |
|--------|-------------|----------|
| Top-level `module=` decl | One authoritative namespace/file; collision-safe; matches Odoo addon convention | |
| Fully-qualified slug strings | `resource.model("mymod.slug")`; module = first dot-segment (the proven TS approach) | |
| Derived from file stem | Zero boilerplate; rename silently rewrites all xmlids | |
| Top-level + `_module=` override | Top-level default plus per-resource escape hatch for multi-namespace files | ✓ |

**User's choice:** Top-level `module=` declaration + per-resource `_module=` override.
**Notes:** Container shape (typed frozen `DesiredState`) accepted as the default. Resolves D-12 carried forward from Phase 1.

---

## resolve() semantics + DAG (SC-5 design spike)

| Option | Description | Selected |
|--------|-------------|----------|
| Deferred thunk + explicit deps | Eager `Deferred`, `deps: frozenset[str]`; pure eval; trivial cycle detection; supports real computation | ✓ |
| Auto-capture via eval proxy | Deps captured automatically (Terraform-style); adds statefulness to pure eval (conflicts with SC-1) | |
| Reference-only (`ref("slug")`) | Mirrors proven TS `resourceRef`; dead simple; no computed values beyond plain refs | |

**User's choice:** Deferred thunk + explicit deps.
**Follow-up — signature:** `resolve(fn, *refs)` chosen over `resolve(fn, deps=[...])` and `resolve(expr)`. The `*refs` serve as both the DAG edges and the resolved args fed to `fn` at the read seam — edges equal exactly what `fn` receives, no divergence.

---

## Inline One2many child syntax (REL-07)

| Option | Description | Selected |
|--------|-------------|----------|
| `children()` wrapper | `children(child_model, inverse_field, [resource(...)])` in field value; battle-tested in real consumer | ✓ |
| Nested `with` blocks | `with p.lines.child(slug) as c:`; extends RSRC-03; doesn't name inverse field; more nesting | |
| Parent accessor method | `p.child.model(slug, **fields)`; explicit ownership; new verb, no precedent | |

**User's choice:** `children()` wrapper.
**Follow-up — arity:** inverse Many2one field is **mandatory** (always 3-arg form) over allowing a 2-arg variant. One canonical shape; Odoo always needs the inverse m2o to scope children.

---

## Schema access in pure pipeline (CORE-02/CORE-08)

| Option | Description | Selected |
|--------|-------------|----------|
| Inject `VersionedSnapshot` | normalize accepts optional snapshot; reuses Phase-1 artifact; fixture injection proven; offline-testable | ✓ |
| Defer to Phase 3 | Keep P2 normalize schema-agnostic; but CORE-02 is a P2 requirement (correctness gap) | |
| Schema-agnostic / DSL types | normalize infers from DSL-declared types; no schema dep but expands DSL surface | |

**User's choice:** Inject `VersionedSnapshot` into normalize.
**Notes:** `SchemaRegistry` stays the live gateway; unit tests inject fixture snapshots (proven `_make_minimal_snapshot()` pattern).

---

## Claude's Discretion

- Module/class layout under `src/godoo_stateman/dsl/`, `ChildBuilder`/flatten internals, new error subclasses.
- Sync vs `async def` for pure stages (must stay `asyncio.run()`-bridge compatible).

## Deferred Ideas

- 2-arg `children(model, [...])` variant (no inverse field) — start with canonical 3-arg form.
- `build` → lockfile artifact (RSRC-v2-01) — deferred to v2.
- Routine per-resource `_module=` usage — override is an escape hatch, not default.
- Inline `resource(...)` as a Many2one field value (TS supported it) — flag for planner if it falls out naturally.
