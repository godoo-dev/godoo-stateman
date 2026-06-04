---
phase: 4
slug: apply-core-actions-val01-gate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-04
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `04-RESEARCH.md` → Validation Architecture. Task IDs are
> provisional (requirement-level) until the planner assigns them; the planner
> and executor refine the Per-Task map against real PLAN.md task IDs.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest >=8 + pytest-asyncio (`asyncio_mode = "auto"`) |
| **Config file** | `pyproject.toml` (`[tool.pytest.ini_options]`) — existing |
| **Quick run command** | `uv run pytest -m "not integration" -q` (unit, no Docker) |
| **Full suite command** | `uv run pytest -q` (incl. `@pytest.mark.integration` — needs Docker) |
| **VAL-01 only** | `uv run pytest tests/acceptance/test_apply.py -m integration -q` |
| **Estimated runtime** | unit ~seconds; VAL-01 ≤120s per Odoo version |

---

## Sampling Rate

- **After every task commit:** Run `uv run pytest -m "not integration" -q` + `uv run mypy --strict src` + `uv run ruff check`
- **After every plan wave:** Full unit suite + one local integration run on Odoo 17 (Docker)
- **Before `/gsd-verify-work`:** Full suite green; CI `integration` job green on 17.0/18.0/19.0; per-version VAL-01 ≤120s
- **Max feedback latency:** unit suite < ~30 seconds

---

## Per-Task Verification Map

> Provisional — keyed on requirement until planner assigns task IDs.

| Req / Behavior | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|----------------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| Creates→Updates→Deletes, slug tiebreak | TBD | TBD | CORE-05 / REL-08 | — | N/A | unit | `pytest tests/unit/test_executor_order.py -x` | ❌ W0 | ⬜ pending |
| new id threaded; B.m2m = A.new_id | TBD | TBD | REL-05 | — | N/A | integration | VAL-01 cross-apply subtest | ❌ W0 | ⬜ pending |
| m2m payload shaped `[(6,0,[ids])]` | TBD | TBD | REL-06 | — | N/A | unit | `pytest tests/unit/test_serialize.py -x` | ❌ W0 | ⬜ pending |
| `_options` → `ResourceNode.options.delete_behavior` | TBD | TBD | SAFE-01 | — | N/A | unit | `pytest tests/unit/test_options_dsl.py -x` | ❌ W0 | ⬜ pending |
| archive preflight halts before RPC | TBD | TBD | SAFE-02 | T-archive-non-archivable | halt before any Odoo mutation when no writable `active` | unit | `pytest tests/unit/test_delete_behavior.py -x` | ❌ W0 | ⬜ pending |
| zero mutation calls on re-apply | TBD | TBD | CORE-06 | — | N/A | unit+integration | mock-client count test + VAL-01 subtest 2 | ❌ W0 | ⬜ pending |
| prompt `n` aborts; `--auto-approve` skips; all-NoOp short-circuit | TBD | TBD | SAFE-04 | T-mass-delete-no-confirm | human confirmation gate before destructive apply | unit (CLI) | `pytest tests/unit/test_apply_cli.py -x` | ❌ W0 | ⬜ pending |
| fail step → committed listed, rest skipped | TBD | TBD | SAFE-05 | T-partial-failure-ambiguity | partial-progress report lists committed vs skipped + remote ids | unit | `pytest tests/unit/test_partial_progress.py -x` | ❌ W0 | ⬜ pending |
| `[N/total]` + status tokens in stdout | TBD | TBD | UX-04 | — | N/A | unit (CLI) | `pytest tests/unit/test_apply_progress.py -x` | ❌ W0 | ⬜ pending |
| exit codes 0/1/3/4/5 | TBD | TBD | UX-04 | — | N/A | unit (CLI) | `pytest tests/unit/test_apply_exit_codes.py -x` | ❌ W0 | ⬜ pending |
| 5 subtests, Odoo 17/18/19, ≤120s | TBD | TBD | VAL-01 | — | N/A | integration | `pytest tests/acceptance/test_apply.py -m integration` | ❌ W0 | ⬜ pending |
| error hierarchy + mypy strict | TBD | TBD | — | T-traceback-host-paths | server tracebacks path-stripped; `.human_message` only | unit | `pytest tests/unit/test_apply_errors.py -x` + `mypy --strict` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/acceptance/test_apply.py` — VAL-01 5-subtest lifecycle (VAL-01)
- [ ] `tests/acceptance/fixtures/val01/01-initial.py`, `02-mid-lifecycle.py` (project / task.type, m2m) (VAL-01)
- [ ] Phase-4 session fixture installing `project` module (`TestHarness(modules=["project"])`) (VAL-01)
- [ ] `tests/unit/` files: executor order, serialize, options DSL, delete_behavior, partial progress, CLI/exit-codes, errors
- [ ] Mock/counting `OdooClient` wrapper for zero-mutation idempotency assertion (CORE-06)
- [ ] Verify `project.task.type` m2m field name on 17/18/19 (A2) before fixture lock

*No framework install needed — pytest + pytest-asyncio already configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A2: `project.task.type` ↔ `project.project` m2m field name | VAL-01 / REL-05 | Live introspection needed; field name (`project_ids` hypothesis) must be `fields_get`-verified on 17/18/19 before fixtures are locked | Run `fields_get` against each Odoo version in the harness; confirm the m2m field name; lock fixtures |
| A1: non-m2m scalar serialization shape | REL-06 | Pin via live round-trip rather than assert from docs | Round-trip a scalar field write/read against live Odoo; confirm pass-through shape |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < ~30s (unit)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
