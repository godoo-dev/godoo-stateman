---
phase: 1
slug: bootstrap-schema-registry
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-23
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | pytest >= 8 + pytest-asyncio >= 0.24 |
| Config file | `pyproject.toml` `[tool.pytest.ini_options]` (Wave 0 gap — not yet written) |
| Quick run command | `uv run pytest tests/unit/ -q` |
| Full suite command | `uv run pytest -q` |
| Integration run command | `uv run pytest -m integration` (requires Docker) |
| Estimated runtime — unit | < 10 seconds (no Docker, mocked client) |
| Estimated runtime — full suite | Several minutes (testcontainers pulls `odoo:17.0` + `postgres:15-alpine`, boots Odoo, runs acceptance tests) |

## Sampling Rate

- **Per task commit:** `uv run pytest tests/unit/ -q` (< 10s, no Docker required)
- **Per wave merge:** `uv run pytest -q` (full suite including integration if Docker is available)
- **Phase gate:** Full suite green, including `tests/acceptance/test_snapshot.py`, before `/gsd:verify-work`

## Per-Task Verification Map

| Task ID | Req ID | Behavior Under Test | Test Type | Automated Command | File Exists |
|---------|--------|---------------------|-----------|-------------------|-------------|
| 1-01-01 | SCHEM-01 | `VersionedModelSchema` carries `odoo_version` dimension and archivability flag | unit | `uv run pytest tests/unit/test_schema_registry.py -x -q` | ❌ W0 |
| 1-01-02 | SCHEM-02 | `VersionedFieldSchema` captures `store`, `ttype`, `readonly`, `compute`, `relation` for every field | unit | `uv run pytest tests/unit/test_schema_registry.py -x -q` | ❌ W0 |
| 1-01-03 | SCHEM-03 | `store=False` fields captured in snapshot (not excluded at registry level) against real Odoo 17 | integration | `uv run pytest tests/acceptance/test_snapshot.py -x -q -m integration` | ❌ W0 |
| 1-01-04 | SCHEM-04 | Snapshot JSON includes `odoo_version` + `schema_format_version`; `VersionMismatchError` raised on format version mismatch | unit | `uv run pytest tests/unit/test_schema_registry.py::test_version_mismatch -x -q` | ❌ W0 |
| 1-01-05 | SCHEM-04 | `VersionMismatchError` raised on Odoo version mismatch (e.g. `"17.0"` vs `"18.0"`) | unit | `uv run pytest tests/unit/test_schema_registry.py::test_odoo_version_mismatch -x -q` | ❌ W0 |
| 1-01-06 | SCHEM-05 | `res.partner.display_name.store is False` against real Odoo 17 (store-flag regression) | integration | `uv run pytest tests/acceptance/test_snapshot.py::test_store_flag_regression -x -q -m integration` | ❌ W0 |
| 1-02-01 | UX-06 | `uv run godoo-stateman --help` exits 0 and lists `plan`, `apply`, `verify`, `import`, `snapshot` | unit | `uv run pytest tests/unit/test_cli_help.py -x -q` | ❌ W0 |
| 1-02-02 | UX-06 | Stubbed commands (`plan`, `apply`, `verify`, `import`) print Rich message and exit with code 1 | unit | `uv run pytest tests/unit/test_cli_help.py -x -q` | ❌ W0 |
| 1-03-01 | SCHEM-01–05 | `SchemaRegistry.get()` returns `VersionedModelSchema` with `store` populated against real Odoo 17 (success criterion 2) | integration | `uv run pytest tests/acceptance/test_snapshot.py -x -q -m integration` | ❌ W0 |
| 1-03-02 | SCHEM-04 | Snapshot JSON round-trip: `save()` then `load()` preserves all fields including `odoo_version` + `schema_format_version` (success criterion 3) | unit | `uv run pytest tests/unit/test_schema_registry.py::test_snapshot_round_trip -x -q` | ❌ W0 |
| 1-04-01 | — | `write_xmlid` / `find_by_xmlid` round-trip against real `ir.model.data` (success criterion 4) | integration | `uv run pytest tests/acceptance/test_snapshot.py::test_xmlid_round_trip -x -q -m integration` | ❌ W0 |
| 1-04-02 | — | `find_by_xmlid` returns `None` for absent xmlid (does not raise) | unit | `uv run pytest tests/unit/test_identity.py::test_find_by_xmlid_absent -x -q` | ❌ W0 |
| 1-04-03 | — | `write_xmlid` idempotent: second call with same args does not create duplicate `ir.model.data` row | unit | `uv run pytest tests/unit/test_identity.py::test_write_xmlid_idempotent -x -q` | ❌ W0 |
| 1-05-01 | PKG-04 | `pyproject.toml` uses hatchling build backend; `uv build` produces a `.whl` | manual | `uv build && ls dist/*.whl` | ❌ W0 |
| 1-05-02 | PKG-05 | GitHub repo is public; `CLAUDE.md` contains `@`-import of `../godoo-hq/UMBRELLA_CLAUDE.md` | manual | `gh repo view godoo-dev/godoo-stateman --json visibility` | CLAUDE.md exists ✅ |

## Wave 0 Requirements

The following must be stubbed (empty test files with correct markers and fixtures) before any implementation tasks begin. The test framework config must also exist so `pytest` can discover and run tests.

- [ ] `pyproject.toml` `[tool.pytest.ini_options]` section — `asyncio_mode = "auto"`, `asyncio_default_fixture_loop_scope = "session"`, `testpaths = ["tests"]`, `integration` marker declaration, `addopts = "--tb=short -q"`. No config means pytest cannot auto-discover async tests.
- [ ] `tests/conftest.py` — session-scoped `odoo` fixture using `TestHarness` from `godoo-testcontainers`; shared across acceptance tests.
- [ ] `tests/unit/test_schema_registry.py` — stub covering SCHEM-01, SCHEM-02, SCHEM-04 (unit, mocked `OdooClient`).
- [ ] `tests/unit/test_identity.py` — stub covering `write_xmlid` / `find_by_xmlid` logic (mocked `OdooClient`).
- [ ] `tests/unit/test_cli_help.py` — stub covering UX-06 (`subprocess` or Typer `CliRunner` invocation).
- [ ] `tests/acceptance/test_snapshot.py` — stub covering SCHEM-03, SCHEM-05, success criteria 2–5 (marked `@pytest.mark.integration`; requires Docker).

**Framework install (if not already present):**
```bash
uv add --dev pytest>=8 pytest-asyncio>=0.24 godoo-testcontainers>=0.2.0
```

## Manual-Only Verifications

All phase behaviors have automated verification with the following two exceptions, which require human inspection because they verify packaging and repository metadata rather than code logic:

- **PKG-04** (`uv build` produces a valid wheel): Run `uv build && ls dist/*.whl`. Confirm a `.whl` file is produced and `pip show godoo-stateman` succeeds when installed into a clean venv.
- **PKG-05** (GitHub repo public + CLAUDE.md `@`-import): Run `gh repo view godoo-dev/godoo-stateman --json visibility` and confirm `"public"`. Open `CLAUDE.md` and confirm the first line is `@../godoo-hq/UMBRELLA_CLAUDE.md`.

## Validation Sign-Off

- [ ] All unit tests pass: `uv run pytest tests/unit/ -q` exits 0
- [ ] All acceptance tests pass: `uv run pytest -m integration -q` exits 0 (Docker required)
- [ ] Full suite clean: `uv run pytest -q` exits 0
- [ ] `uv run godoo-stateman --help` lists exactly `plan`, `apply`, `verify`, `import`, `snapshot`
- [ ] `SchemaRegistry.get("res.partner")` returns `VersionedModelSchema` with `fields["display_name"].store is False` against real Odoo 17
- [ ] Snapshot JSON round-trip preserves `odoo_version` and `schema_format_version`; `VersionMismatchError` raised on mismatch
- [ ] `write_xmlid` / `find_by_xmlid` round-trip confirmed against `ir.model.data` on real Odoo 17
- [ ] `uv build` produces a `.whl`; GitHub repo is public
- [ ] Feedback latency: no more than **1 task** between a code change and a `uv run pytest tests/unit/ -q` run

**Approval:** pending
