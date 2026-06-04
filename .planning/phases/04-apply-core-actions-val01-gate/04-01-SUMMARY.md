---
phase: 04-apply-core-actions-val01-gate
plan: 01
subsystem: apply-foundations
tags: [apply, dsl, diff, serialize, errors, safety]
dependency_graph:
  requires:
    - dsl/types/nodes.py (ResourceNode frozen dataclass)
    - plan/types.py (PlanStep frozen Pydantic)
    - diff.py (PlanStep construction sites)
    - live/livestate.py (frozen LiveState — seed source)
    - identity.py (XmlIdRecord)
  provides:
    - ResourceOptions / ResourceNode.options (SAFE-01 _options surface)
    - PlanStep.delete_behavior + PlanStep.desired_fields
    - apply/serialize.py serialize_fields (REL-06 m2m SET seam)
    - apply/state.py GlobalLiveState (REL-05 slug->int resolver, D-02)
    - cli/_connection.py Connection/read_connection/open_client (D-04)
    - errors.py ApplyError/ArchiveNotSupportedError/DeleteRejectedError/ApplyStepError
  affects:
    - Plan 02 executor (consumes all contracts above)
    - Plan 03 VAL-01 suite
tech_stack:
  added: []
  patterns:
    - "frozen Pydantic value objects (ResourceOptions, PlanStep)"
    - "frozen dataclass field(default_factory=...) for ResourceNode.options"
    - "pure type-keyed transform mirroring normalize._normalize_value"
    - "mutable cross-step state seeded from (never mutating) frozen LiveState"
key_files:
  created:
    - src/godoo_stateman/apply/__init__.py
    - src/godoo_stateman/apply/serialize.py
    - src/godoo_stateman/apply/state.py
    - src/godoo_stateman/cli/_connection.py
    - tests/unit/test_apply_errors.py
    - tests/unit/test_options_dsl.py
    - tests/unit/test_serialize.py
  modified:
    - src/godoo_stateman/errors.py
    - src/godoo_stateman/dsl/types/nodes.py
    - src/godoo_stateman/dsl/context.py
    - src/godoo_stateman/plan/types.py
    - src/godoo_stateman/diff.py
    - tests/unit/test_diff.py
decisions:
  - "ResourceOptions placed in dsl/types/nodes.py (alongside ResourceNode); typed as base class on ResourceNode.options so per-type subclasses are not precluded (R5)"
  - "GlobalLiveState seeds managed entries by reconstructing complete xmlid f'{module}.{slug}' (module = xmlid_module or xmlid_prefix), matching LiveState.managed key shape, then keys the seed by slug (D-02)"
  - "Pass-2 Delete/Archive PlanSteps keep default delete_behavior='reject'; action is authoritative (no resource.options available)"
  - "cli/_connection.py created but NOT yet adopted by plan.py/import_.py — Plan 02 does the refactor to keep file sets non-overlapping"
metrics:
  duration: ~10m
  completed: 2026-06-05
---

# Phase 4 Plan 01: Apply Foundations (Type Contracts + Pure Transforms) Summary

Interface-first foundation slice for the apply executor: the SAFE-01 `_options`/`ResourceOptions`
DSL surface, the `PlanStep` extension carrying `delete_behavior` + the full desired-fields dict,
the REL-06 m2m `(6,0,[ids])` serialization seam, the REL-05 slug-keyed `GlobalLiveState` forward-
reference map (D-02), the `ApplyError` hierarchy, and the shared `GODOO_*` connection helper (D-04).

## What Was Built

**Task 1 — Error hierarchy + ResourceOptions DSL surface (commit 7eb99fd)**
- `errors.py`: `ApplyError` (message-only) + `ArchiveNotSupportedError(*, model, slug)`,
  `DeleteRejectedError(*, slug)`, `ApplyStepError(*, slug, action, cause)` storing the three attrs.
  All inherit `StatemanError`.
- `dsl/types/nodes.py`: frozen Pydantic `ResourceOptions(delete_behavior: Literal[...] = "reject")`;
  `ResourceNode.options: ResourceOptions = field(default_factory=ResourceOptions)`.
- `dsl/context.py`: `_ModelResourceCallable.__call__` pops `_options` from `**fields` and passes
  it to `ResourceNode(...)`, stripping the reserved kwarg.
- Tests: `test_apply_errors.py` (MRO + ApplyStepError attrs), `test_options_dsl.py`
  (options set + `_options` stripped + default "reject").

**Task 2 — PlanStep extension + diff() population (commit 59da101)**
- `plan/types.py`: `PlanStep.delete_behavior` (Literal, default "reject") + `desired_fields`
  (`dict[str, Any] | None`, default None).
- `diff.py`: CREATE sets `desired_fields=dict(resource.fields)` + `delete_behavior`;
  UPDATE/NOOP + REJECT carry `delete_behavior`; Pass-2 keeps default with an explanatory comment.
- Tests: extended `test_create_on_no_xmlid` + new `test_create_carries_delete_behavior_from_resource_options`.

**Task 3 — serialize seam + GlobalLiveState + connection helper (commit da3095d)**
- `apply/serialize.py`: `serialize_fields(model_schema, fields, gls)` — pure, emits
  `[(6, 0, ids)]` for many2many (slug→int via `gls`), pass-through otherwise. No `import odoo`.
- `apply/state.py`: mutable `GlobalLiveState` (slug→int) with `from_live_state(...)` seeding from
  managed (slug-keyed, D-02) + seam, plus `register`/`__setitem__`/`__getitem__`/`__contains__`.
- `cli/_connection.py`: frozen `Connection` + `read_connection()` (missing-list pattern,
  ODOO_VERSION regex validate) + `open_client()`. Credentials env-only, never logged (T-04-01).
- Tests: `test_serialize.py` — m2m int/slug/empty SET, scalar pass-through, register round-trip,
  managed+seam seed, and the D-02 slug-not-name assertion.

## Verification

- `uv run pytest -m "not integration" -q` — all 179 unit tests green.
- `uv run mypy --strict src/godoo_stateman` — clean (37 source files).
- `uv run ruff check src/ tests/` — clean.
- `serialize.py` contains no `import odoo` and no `Command`.
- All new symbols importable.

## Deviations from Plan

None — plan executed exactly as written. Task 3 is `tdd="true"` but the phase runs with
TDD_MODE off (no RED-commit gate, MVP mode), so tests and implementation were committed
together as a single verified slice per the MVP+TDD configuration.

## Known Stubs

None. `cli/_connection.py` is intentionally created-but-not-yet-consumed by `plan.py`/`import_.py`
this plan; Plan 02 adopts it (documented decision, non-overlapping file sets).

## Threat Flags

None — no new network endpoint, auth path, or trust-boundary surface beyond the planned
`cli/_connection.py` credential read (already covered by T-04-01 in the plan threat model).

## Self-Check: PASSED

All 7 created files present on disk; all 3 task commits (7eb99fd, 59da101, da3095d) present in git log.
