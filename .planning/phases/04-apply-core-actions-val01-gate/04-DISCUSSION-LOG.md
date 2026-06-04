# Phase 4: Apply (core actions) — VAL-01 gate - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 04-apply-core-actions-val01-gate
**Areas discussed:** VAL-01 fixture scope, GlobalLiveState seeding, delete_behavior carrier, Shared client/env helper

> **Note:** Requirements were locked by 04-SPEC.md before this discussion. Discussion covered implementation decisions only — no requirement negotiation occurred.

---

## VAL-01 fixture scope

| Option | Description | Selected |
|--------|-------------|----------|
| A | Minimal m2m, no o2m — model `project.project` + `project.task.type` as separate resources linked via task-type→project m2m (`project_ids`); cross-version-stable scalar fields only; o2m stays out of scope | ✓ |
| B | Allow o2m if a subtest needs it — permit o2m writes (`(0, 0, {})` / `(1, id, {})`) if a VAL-01 subtest cannot be expressed via m2o/m2m | |
| C | Richer fixtures, still no o2m — broader set of models/fields in fixtures while keeping o2m out of scope | |

**User's choice:** A — Minimal m2m, no o2m
**Notes:** Model `project.project` and `project.task.type` as separate resources, linked via the task-type→project m2m field (`project_ids`), serialized with `(6, 0, [ids])`. o2m stays out of Phase 4 scope. Fixtures use only cross-version-stable scalar fields (`name` + known-safe scalars); avoid version-divergent fields. Exact m2m field name and safe scalar-field subset to be verified against live introspection for Odoo 17/18/19 CE during planning.

---

## GlobalLiveState seeding

| Option | Description | Selected |
|--------|-------------|----------|
| A | Managed + seam IDs, then creates — pre-populate from both the initial `LiveState` managed slugs (`slug→res_id`) and data-source/seam-resolved record IDs, then register each create's new `res_id` as steps execute | ✓ |
| B | Managed + creates only — pre-populate from managed slugs only; seam/data-source IDs looked up separately at resolution time | |

**User's choice:** A — Managed + seam IDs, then creates
**Notes:** Provides one uniform lookup surface for all m2m resolution, regardless of whether the target is pre-existing-managed, data-sourced, or freshly created this run. Key shape: `dict[str, int]` keyed by `ResourceNode.slug` (SPEC R3).

---

## delete_behavior carrier

| Option | Description | Selected |
|--------|-------------|----------|
| A | Carry on PlanStep — `delete_behavior` (and/or the originating `options`) is carried on the frozen `PlanStep` model; executor needs no `DesiredState` back-reference; plan render can display the behavior | ✓ |
| B | Executor-side lookup by slug — executor looks up `delete_behavior` from `DesiredState` by slug at execution time | |

**User's choice:** A — Carry on PlanStep
**Notes:** Self-contained, renderable, matches the existing frozen-Pydantic step pattern. SPEC R6 had left this open; this discussion locks the PlanStep-extension path.

---

## Shared client/env helper

| Option | Description | Selected |
|--------|-------------|----------|
| A | Extract shared helper now — extract a shared `GODOO_*` env-read + `OdooClient`-construction helper as part of Phase 4; refactor `plan` and `import` to consume it | ✓ |
| B | Keep inline — leave env-read + client construction inline in each command; defer extraction to a future phase | |

**User's choice:** A — Extract shared helper now
**Notes:** Rule of three reached: `plan`, `import`, and `apply` all need the same connection logic. Single connection/credential surface. `plan` and `import` commands refactored to consume the shared helper.

---

## Claude's Discretion

The following technical mechanics were deferred to the planner (not user-facing decisions):

- `ResourceOptions` ↔ frozen `ResourceNode` integration: make `ResourceOptions` hashable (frozen Pydantic) vs adjust how options attach to the frozen `ResourceNode` dataclass.
- `_options=` kwarg consumption/stripping in `dsl/context.py` (mirror the existing `_module=` handling pattern).
- `apply/serialize.py` field-type → Odoo-write-format contract beyond m2m (m2o int pass-through, bool, char/text). Define explicitly during planning.
- How CREATE steps obtain the full desired-fields dict (`PlanStep` currently carries only `field_diff`): executor lookup from `DesiredState` by slug, or a `PlanStep` extension. Coordinate with D-03's PlanStep extension.
- Whether to house the executor in a new `apply/` subpackage and its module layout.

## Deferred Ideas

- **o2m serialization** (`(0, 0, {values})` / `(1, id, {values})`): kept out of Phase 4. Revisit only if a future VAL subtest cannot be expressed via m2o/m2m.
- **Shared connection-helper scope**: Phase 4 extracts env-read + client construction; broader connection/retry/error-mapping abstractions are not in scope now.
