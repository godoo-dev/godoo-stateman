---
phase: 02
slug: dsl-eval-pure-pipeline
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest >=8 + pytest-asyncio >=0.24 |
| **Config file** | `pyproject.toml` `[tool.pytest.ini_options]` |
| **Quick run command** | `uv run pytest tests/unit/dsl/ -x -q` |
| **Full suite command** | `uv run pytest tests/unit/ -q` |
| **Estimated runtime** | ~10 seconds (no Docker; all unit tests) |

---

## Sampling Rate

- **After every task commit:** Run `uv run pytest tests/unit/dsl/ -x -q`
- **After every plan wave:** Run `uv run pytest tests/unit/ -q`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | REL-01, REL-07 | T-02-SC | networkx runtime dep; no install checkpoint needed (audited) | unit | `uv run python -c "from godoo_stateman.errors import CycleError, DslEvalError, MissingModuleError; print('ok')"` | created inline | ⬜ pending |
| 02-01-02 | 01 | 1 | CORE-01, RSRC-06, REL-01 | T-02-01, T-02-02 | Deferred.fn never called; frozen → FrozenInstanceError on mutation | unit | `uv run pytest tests/unit/dsl/test_deferred.py -x -q` | created inline | ⬜ pending |
| 02-02-01 | 02 | 2 | RSRC-01..05, RSRC-07 | T-02-03, T-02-04 | build_dsl_namespace keys present; no __import__/open in namespace | unit | `uv run python -c "from godoo_stateman.dsl.context import build_dsl_namespace, _Collector; c = _Collector(); ns = build_dsl_namespace(c); assert set(ns.keys()) >= {'resource','data','children','resolve','mail'}; print('ok')"` | created inline | ⬜ pending |
| 02-02-02 | 02 | 2 | CORE-01, RSRC-01..07 | T-02-03, T-02-04, T-02-05, T-02-06 | import/open raise NameError; DesiredState has no ChildrenWrapper | unit | `uv run pytest tests/unit/dsl/test_eval.py -x -q` | created inline | ⬜ pending |
| 02-03-01 | 03 | 2 | CORE-02, CORE-08 | T-02-07, T-02-08 | boolean False preserved; m2m sorted; m2o tuple→int | unit | `uv run pytest tests/unit/dsl/test_normalize.py -x -q` | created inline | ⬜ pending |
| 02-04-01 | 04 | 3 | REL-01, REL-02, REL-07 | T-02-09, T-02-10 | CycleError raised with path; acyclic graph returns without error | unit | `uv run pytest tests/unit/dsl/test_graph.py -x -q` | created inline | ⬜ pending |
| 02-04-02 | 04 | 3 | CORE-01, REL-01, REL-02, REL-07 | T-02-11 | plan stub calls eval_config; Typer exists=True validates path | unit + integration | `uv run pytest tests/unit/ -q && uv run ruff check src/godoo_stateman/ && uv run mypy src/godoo_stateman/` | created inline | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 test files are created **inline within the TDD implementation tasks** — there is no separate
Wave 0 plan for this phase. Each plan's tasks create both the source module and its test file in the
same task, following TDD (write test structure → implement to green). The test files listed below
are created during execution of their respective plans, not as a pre-step:

- `tests/unit/dsl/__init__.py` — created in Plan 01 Task 2
- `tests/unit/dsl/test_deferred.py` — created in Plan 01 Task 2 (covers RSRC-06, D-04/D-05, SC-5)
- `tests/unit/dsl/test_eval.py` — created in Plan 02 Task 2 (covers CORE-01, RSRC-01..07)
- `tests/unit/dsl/test_normalize.py` — created in Plan 03 Task 1 (covers CORE-02, CORE-08, SC-2)
- `tests/unit/dsl/test_graph.py` — created in Plan 04 Task 1 (covers REL-01, REL-02, REL-07)
- `src/godoo_stateman/dsl/__init__.py` — created in Plan 01 Task 2 (package marker)

*All test infrastructure is inline — no separate Wave 0 plan required.*

---

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Plan |
|--------|----------|-----------|-------------------|------|
| CORE-01 | eval_config returns DesiredState with zero Odoo calls | unit | `uv run pytest tests/unit/dsl/test_eval.py -x -q` | 02-02 |
| CORE-02 | normalize: False→None scalar, False→[] relation; round-trip stable | unit | `uv run pytest tests/unit/dsl/test_normalize.py -x -q` | 02-03 |
| CORE-08 | normalize: m2o tuple→int; m2m order-irrelevant (sorted canonical) | unit | `uv run pytest tests/unit/dsl/test_normalize.py -x -q` | 02-03 |
| RSRC-01 | resource.\<model>(slug, **fields) constructor works | unit | `uv run pytest tests/unit/dsl/test_eval.py::test_resource_constructor -x -q` | 02-02 |
| RSRC-02 | data.\<model>(**selector) read-only ref works | unit | `uv run pytest tests/unit/dsl/test_eval.py::test_data_source -x -q` | 02-02 |
| RSRC-03 | with blocks + attribute assignment | unit | `uv run pytest tests/unit/dsl/test_eval.py::test_with_block -x -q` | 02-02 |
| RSRC-04 | mail.config["key"]="val" produces config_parameter entry | unit | `uv run pytest tests/unit/dsl/test_eval.py::test_mail_config -x -q` | 02-02 |
| RSRC-05 | Walrus := inside expression context works in exec | unit | `uv run pytest tests/unit/dsl/test_eval.py::test_walrus_operator -x -q` | 02-02 |
| RSRC-06 | resolve() returns Deferred, does not fire fn | unit | `uv run pytest tests/unit/dsl/test_deferred.py -x -q` | 02-01 |
| RSRC-07 | exec() blocks import, open, eval; allows required ops | unit | `uv run pytest tests/unit/dsl/test_eval.py::test_restricted_builtins_blocks_import -x -q` | 02-02 |
| REL-01 | build_graph produces DiGraph with correct nodes/edges | unit | `uv run pytest tests/unit/dsl/test_graph.py -x -q` | 02-04 |
| REL-02 | CycleError raised with cycle path | unit | `uv run pytest tests/unit/dsl/test_graph.py::test_cycle_detection -x -q` | 02-04 |
| REL-07 | inline children participate in cycle detection | unit | `uv run pytest tests/unit/dsl/test_graph.py::test_children_participate_in_cycle -x -q` | 02-04 |

---

## Manual-Only Verifications

*All phase behaviors have automated verification. No manual-only checks required for Phase 02.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands (inline with tasks)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covered: test files created inline within TDD tasks (no separate Wave 0 plan needed)
- [x] No watch-mode flags in any verify command
- [x] Feedback latency < 15s (pure unit tests, no Docker)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
