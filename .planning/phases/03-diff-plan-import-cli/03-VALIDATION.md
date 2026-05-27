---
phase: 3
slug: diff-plan-import-cli
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-27
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest >=8 + pytest-asyncio (`asyncio_mode = "auto"`) |
| **Config file** | `pyproject.toml` (`[tool.pytest.ini_options]`) |
| **Quick run command** | `uv run pytest -m "not integration" -q` |
| **Full suite command** | `uv run pytest -q` (includes `@pytest.mark.integration` Docker/live-Odoo acceptance tests) |
| **Estimated runtime** | ~10s unit-only; ~minutes with integration (testcontainers pulls Odoo 17 CE + Postgres) |

---

## Sampling Rate

- **After every task commit:** Run `uv run pytest -m "not integration" -q`
- **After every plan wave:** Run `uv run pytest -q` (full suite, including integration)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~10 seconds (unit feedback loop); integration on wave boundaries only

---

## Per-Task Verification Map

> Concrete task IDs are assigned by the planner. This map enumerates the validation
> targets that every plan task must trace back to. Each phase requirement maps to at
> least one automated test; SC-1..SC-5 each map to a live-Odoo integration test.

| Validation target | Requirement | SC | Test Type | Automated Command | Notes |
|--------------------|-------------|----|-----------|-------------------|-------|
| `module=` → `xmlid_prefix=` rename: DSL parses new keyword; old keyword errors | CORE-04 | — | unit | `uv run pytest tests/dsl -q` | D-05; Wave 0 — touches Phase-2 surface + tests |
| LiveState fetch is read-only + deterministic across two runs | CORE-03, UX-02 | SC-2 | unit + integration | `uv run pytest -k livestate` | inject fixture snapshot for unit; live fetch for integration |
| Diff classifies Create/Update/NoOp/Delete/Archive/Reject | CORE-03 | SC-1 | unit | `uv run pytest -k diff` | `find_by_xmlid` None→Create; normalize live values before compare |
| Scalar / m2o (`[id,name]`) / m2m (`[id,...]`) compared without false-positive diffs | CORE-03, REL-03 | SC-1 | unit | `uv run pytest -k "diff and relation"` | `_normalize_value()` applied to live values |
| Read seam fires `Deferred.fn`; `data.<model>` resolves to remote ID at plan time | REL-03, REL-04 | SC-4 | unit + integration | `uv run pytest -k seam` | m2m-to-data-source renders resolved ID in diff |
| Reject = xmlid-namespace collision (different model) from `ir.model.data` alone | CORE-03, SAFE-03 | SC-3 | unit | `uv run pytest -k reject` | D-02; never Create/Update on collision |
| Managed-set scoping: rows where `module == xmlid_prefix` absent from desired → Delete/Archive | META-01 | SC-1 | unit | `uv run pytest -k managed_set` | D-04; Phase 3 classifies only, does not execute |
| Plan render: Terraform-style annotated list, hidden NoOp, field `old → new` | UX-03, UX-05 | SC-1 | unit | `uv run pytest -k render` | D-06/D-07; topological + slug-sort order |
| Non-TTY fallback: markup stripped, readable in pipes/CI | UX-05 | SC-2 | unit | `uv run pytest -k non_tty` | `Console(force_terminal=False)` |
| `plan` exit codes: 0 (no changes) / 2 (changes) / 1 (error) | UX-01 | SC-1 | unit | `uv run pytest -k exit_code` | Phase-1 D-18 |
| `import --model --id --module --name` writes xmlid; existence-checked pre-write | IDENT-01, IDENT-02, IDENT-04 | SC-5 | integration | `uv run pytest -m integration -k import` | D-10/D-11; search_read confirms record exists |
| `import` idempotent re-run (same res_id → no-op exit 0); different record requires `--force` | IDENT-05, SAFE-03 | SC-5 | unit + integration | `uv run pytest -k "import and (idempotent or force)"` | no silent clobber |
| Post-`import`, subsequent `plan` treats record as managed | IDENT-03, IDENT-05 | SC-5 | integration | `uv run pytest -m integration -k roundtrip` | round-trip acceptance gate |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky — planner stamps per-task rows.*

---

## Wave 0 Requirements

- [ ] D-05 rename (`module=` → `xmlid_prefix=`) lands first: update Phase-2 tests asserting `state.module` so they assert `state.xmlid_prefix` — the rest of the phase builds on the corrected surface.
- [ ] `tests/conftest.py` — shared fixtures: fake/fixture `VersionedSnapshot` + fake LiveState for offline diff unit tests; `@pytest.mark.integration` Odoo 17 CE testcontainer fixture for SC-1..SC-5.
- [ ] Verify `nx.topological_generations` exists in NetworkX 3.6.1 (`uv run python -c "import networkx as nx; nx.topological_generations"`) before relying on it for D-08 deterministic ordering. (VERIFIED present during planning.)
- [ ] `tests/unit/test_seam.py` — owned by Plan 03-02 (live layer: LiveState.fetch + seam); covers CORE-04, REL-03, REL-04.
- [ ] `tests/unit/test_diff.py` — owned by Plan 03-03 (diff engine); covers CORE-03, SAFE-03, REL-03, REL-04.
- [ ] `tests/unit/test_plan_render.py` — owned by Plan 03-04 (Rich render); covers UX-03, UX-05.
- [ ] `tests/unit/test_plan_command.py` — owned by Plan 03-04 (plan command exit codes); covers UX-02.

*Existing pytest + pytest-asyncio infrastructure (from Phases 1–2) covers the framework; no new install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ROADMAP SC-3 + REQUIREMENTS SAFE-03 wording updated to match D-01/D-02/D-03 (Reject = xmlid collision, not natural-key match) | SAFE-03, SC-3 | Documentation correction — verifier will fail SC-3 as currently worded otherwise | Edit ROADMAP Phase-3 SC-3 and REQUIREMENTS SAFE-03 to the xmlid-collision definition before `/gsd:verify-work` |

*All runtime behaviors have automated verification; the only manual item is the locked-doc wording correction flagged in CONTEXT D-03.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (D-05 rename + conftest fixtures)
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s (unit loop)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
