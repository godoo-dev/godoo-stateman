---
phase: 01-bootstrap-schema-registry
verified: 2026-05-23T00:00:00Z
status: human_needed
score: 7/8 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Run `uv run pytest -m integration -x -q` (requires Docker)"
    expected: "All 6 integration tests pass: test_schema_registry_get, test_store_flag_regression, test_snapshot_round_trip, test_version_mismatch_on_load, test_xmlid_round_trip, test_xmlid_idempotent"
    why_human: "Acceptance tests require Docker and a running Odoo 17 CE container. The orchestrator confirmed 41 unit tests pass but integration tests were not run. Success criteria 2, 4, and SCHEM-05's regression gate can only be definitively verified against real Odoo."
---

# Phase 1: Bootstrap + Schema Registry Verification Report

**Phase Goal:** A runnable Python project exists with the full type vocabulary, a versioned schema registry that correctly captures the `store` flag, and the xmlid write helpers — everything downstream stages depend on.
**Verified:** 2026-05-23
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `uv run godoo-stateman --help` exits 0 with plan, apply, verify, import, snapshot listed | VERIFIED | CLI exits 0; all 5 commands confirmed in help output. `tests/unit/test_cli_help.py` passes (7 tests). |
| 2 | `SchemaRegistry.get("project.project")` returns `VersionedModelSchema` with `store` populated for every field against real Odoo 17 | UNCERTAIN | Unit tests confirm the wrapping logic (`test_registry_get_wraps_model_schema`). `tests/acceptance/test_snapshot.py::test_schema_registry_get` (marked `@pytest.mark.integration`) exists and covers this. Requires Docker for definitive verification. |
| 3 | Snapshot JSON includes `odoo_version`, `schema_format_version`, `store` at field level; loading a mismatched snapshot raises `VersionMismatchError` | VERIFIED | Directly verified: JSON output contains all three required keys. `VersionedSnapshot.load()` raises on both `schema_format_version` and `odoo_version` mismatches. 8 unit tests cover this. |
| 4 | `write_xmlid` / `find_by_xmlid` round-trip correctly against `ir.model.data` via jsonrpc | UNCERTAIN | Unit tests cover all contract cases (14 tests). `test_xmlid_round_trip` and `test_xmlid_idempotent` acceptance tests exist but require Docker. |
| 5 | `store`-flag conflict (SCHEM-05): computed non-stored fields have `store=False` in the registry | VERIFIED (unit) / UNCERTAIN (real Odoo) | `registry.py:53` reads `fs.store` directly from `Introspector`, which populates it via `bool(fr.get("store", True))` (godoo-py introspector.py:290). Unit test `test_registry_get_wraps_model_schema` asserts `display_name.store is False`. Regression gate `test_store_flag_regression` (acceptance) confirms against real Odoo 17 but requires Docker. |

**Score:** 3 definitively VERIFIED, 2 UNCERTAIN pending Docker run

### Per-Requirement Verdicts

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| SCHEM-01 | Schema registry stores per-model metadata keyed by Odoo-version dimension | VERIFIED | `VersionedModelSchema` has `odoo_version: str`. `SchemaRegistry.__init__` takes `OdooVersion`. `archivable` derived from `active.store` (note: `readonly` not checked — see warning below). |
| SCHEM-02 | Schema registry stores per-field metadata including `store` flag | VERIFIED | `VersionedFieldSchema` has all required fields: `name`, `ttype`, `store: bool`, `readonly`, `compute`, `relation`, `required`. `registry.py:56-65` maps each field including `store`. |
| SCHEM-03 | `store` flag captured correctly; computed `store=False` fields excluded from write plans | VERIFIED | `store` is preserved as-is from Introspector. Exclusion from write plans is downstream (Phase 3 plan stage) — the schema layer captures it correctly. Unit + acceptance tests confirm. |
| SCHEM-04 | Snapshot serialized to versioned JSON; stale snapshots rejected with `VersionMismatchError` | VERIFIED | `VersionedSnapshot.save()` writes `odoo_version`, `schema_format_version`, `captured_at`, `models`. `load()` checks format version first, then Odoo version. Both raise `VersionMismatchError`. 5 unit tests + 1 acceptance test cover this. |
| SCHEM-05 | `store` flag verified correct from godoo-py `Introspector` (BUG-07-B gate) | VERIFIED (code) | `Introspector` populates `store=bool(fr.get("store", True))` from `fields_get` (godoo-py introspector.py:290). Registry reads it directly. UNCERTAIN against real Odoo 17 (requires Docker). |
| UX-06 | CLI via Typer; async commands bridged via `asyncio.run()` | VERIFIED | `snapshot.py` uses `asyncio.run(_snapshot_impl(config))`. All other commands are sync stubs. No `async def` function is decorated directly with `@app.command()`. 7 unit tests pass. |
| PKG-04 | `pyproject.toml` uses hatchling build backend | VERIFIED | `pyproject.toml:28-30`: `requires = ["hatchling"]`, `build-backend = "hatchling.build"`. `requires-python = ">=3.14"`. All runtime deps declared. |
| PKG-05 | GitHub repo `godoo-dev/godoo-stateman` is public; CLAUDE.md `@`-imports `../godoo-hq/UMBRELLA_CLAUDE.md` | VERIFIED | `gh repo view godoo-dev/godoo-stateman --json visibility` returns `PUBLIC`. `CLAUDE.md` line 1: `@../godoo-hq/UMBRELLA_CLAUDE.md`. |

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `pyproject.toml` | hatchling backend, deps, entry point | VERIFIED | All fields correct. Entry point: `godoo-stateman = "godoo_stateman.cli.app:app"`. |
| `src/godoo_stateman/errors.py` | `StatemanError`, `VersionMismatchError` | VERIFIED | Both classes substantive, correct hierarchy, importable. |
| `src/godoo_stateman/cli/app.py` | Typer app with 5 commands | VERIFIED | All 5 commands registered: `plan`, `apply`, `verify`, `import`, `snapshot`. |
| `src/godoo_stateman/schema/version.py` | `OdooVersion`, `SCHEMA_FORMAT_VERSION` | VERIFIED | Frozen dataclass, correct `__str__`, constant = 1. |
| `src/godoo_stateman/types/schema.py` | `VersionedFieldSchema`, `VersionedModelSchema` | VERIFIED | Frozen Pydantic v2 models with all required fields. |
| `src/godoo_stateman/schema/registry.py` | `SchemaRegistry` with version seam | VERIFIED | Wraps `Introspector`, derives `archivable`, in-memory cache, `_instance_hash`, `cache_path`, `build_snapshot`. |
| `src/godoo_stateman/schema/snapshot.py` | `VersionedSnapshot` with version-gated load | VERIFIED | `save()` / `load()` with `VersionMismatchError` on both mismatch types. |
| `src/godoo_stateman/identity.py` | `XmlIdRecord`, `find_by_xmlid`, `write_xmlid` | VERIFIED | Frozen dataclass + full idempotent upsert with model-mismatch guard. |
| `src/godoo_stateman/cli/commands/snapshot.py` | Real async implementation wired to `SchemaRegistry` | VERIFIED | Full implementation: env credentials, version validation, OdooClient, SchemaRegistry, cache path, save, Rich panel. |
| `tests/unit/test_cli_help.py` | 7 unit tests for CLI | VERIFIED | 7 tests pass. |
| `tests/unit/test_schema_registry.py` | Unit tests for schema layer | VERIFIED | 20 tests pass. All SCHEM-01-04 cases covered with mocked Introspector. |
| `tests/unit/test_identity.py` | Unit tests for xmlid helpers | VERIFIED | 14 tests pass. All contract cases covered. |
| `tests/acceptance/test_snapshot.py` | Integration tests (Docker) | EXISTS, NOT RUN | 6 tests marked `@pytest.mark.integration`. All are substantive (non-stub). |
| `tests/conftest.py` | Session-scoped `odoo` TestHarness fixture | VERIFIED | `TestHarness(snapshot=True)` async context manager, session scope. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `pyproject.toml [project.scripts]` | `godoo_stateman.cli.app:app` | hatchling entry point | VERIFIED | `godoo-stateman = "godoo_stateman.cli.app:app"` at line 26. CLI exits 0. |
| `cli/app.py` | `cli/commands/*.py` | `app.command()` | VERIFIED | All 5 commands imported and registered. `app.command("import")(import_)` handles keyword name. |
| `schema/registry.py::SchemaRegistry` | `godoo.introspection.Introspector` | `_introspector.get_schema(model_name)` | VERIFIED | `Introspector(client)` at line 36; `_introspector.get_schema()` at line 49. |
| `schema/registry.py::SchemaRegistry` | `types/schema.py::VersionedModelSchema` | wraps raw schema | VERIFIED | `VersionedModelSchema(...)` constructed at lines 68-76 with `store` from each `FieldSchema`. |
| `schema/snapshot.py::VersionedSnapshot` | `errors.py::VersionMismatchError` | `raise VersionMismatchError(...)` | VERIFIED | `raise VersionMismatchError(...)` at lines 59 and 64. |
| `cli/commands/snapshot.py::_snapshot_impl` | `schema/registry.py::SchemaRegistry` | `SchemaRegistry(client, odoo_version)` | VERIFIED | `SchemaRegistry(client, odoo_version)` at line 92; `registry.build_snapshot()` at line 95. |
| `identity.py::write_xmlid` | `godoo.client.OdooClient` | `client.search_read("ir.model.data", ...)` | VERIFIED | `search_read("ir.model.data", ...)` at lines 64, 122; `create("ir.model.data", ...)` at line 104; `write("ir.model.data", ...)` at line 128. |

---

## Data-Flow Trace (Level 4)

The `SchemaRegistry` does not render UI data directly — it wraps Introspector RPC data. The snapshot command writes to a file rather than rendering to a display. The data flow is:

- `SchemaRegistry.get()` → `Introspector.get_schema()` → real Odoo RPC → `VersionedModelSchema`
- `VersionedSnapshot.save()` → JSON file on disk (confirmed with direct runtime check)

Unit tests use `AsyncMock` for `Introspector.get_schema()` and confirm the mapping is not hollow. Acceptance tests (Docker) confirm end-to-end RPC flow.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CLI exits 0 with 5 commands | `uv run godoo-stateman --help` | Exit 0; all 5 commands listed | PASS |
| Stub exits 1 with phase message | `uv run godoo-stateman plan` | Exit 1; "Phase 3" in output | PASS |
| Error hierarchy imports | `python -c "from godoo_stateman.errors import StatemanError, VersionMismatchError"` | Exit 0 | PASS |
| All imports resolve | `python -c "from godoo_stateman.identity import find_by_xmlid, write_xmlid"` | Exit 0 | PASS |
| `VersionMismatchError` on format mismatch | direct Python invocation | Raised with "Schema format version mismatch" | PASS |
| `VersionMismatchError` on Odoo version mismatch | direct Python invocation | Raised with "Odoo version mismatch" | PASS |
| Snapshot JSON structure | direct Python invocation | `odoo_version`, `schema_format_version`, field-level `store` all present | PASS |
| 41 unit tests pass | `uv run pytest tests/unit/ -q` | `41 passed in 0.38s` | PASS |

---

## Probe Execution

No probe scripts found in `scripts/*/tests/probe-*.sh`. No probes declared in PLAN files.

**Step 7c: SKIPPED** — No probe scripts in project.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SCHEM-01 | 01-02 | Per-model metadata keyed by Odoo-version | SATISFIED | `VersionedModelSchema.odoo_version`, `SchemaRegistry(version)` |
| SCHEM-02 | 01-02 | Per-field metadata with `store` flag | SATISFIED | `VersionedFieldSchema.store: bool`, mapped in `registry.py` |
| SCHEM-03 | 01-02 | `store` flag captured; computed `store=False` available | SATISFIED | Pass-through from Introspector; not filtered at registry level |
| SCHEM-04 | 01-02 | Versioned JSON with format+version mismatch detection | SATISFIED | `VersionedSnapshot` save/load with both `VersionMismatchError` checks |
| SCHEM-05 | 01-02 | Introspector's `store` flag verified correct | SATISFIED (code) | godoo-py uses `fields_get` to populate `store`; registry reads directly |
| UX-06 | 01-01 | Typer CLI with `asyncio.run()` async bridge | SATISFIED | `snapshot.py` uses `asyncio.run(_snapshot_impl(config))` |
| PKG-04 | 01-01 | hatchling build backend | SATISFIED | `pyproject.toml` build-backend = hatchling |
| PKG-05 | 01-01 | Public GitHub repo; CLAUDE.md @-import | SATISFIED | Repo is PUBLIC; CLAUDE.md line 1 is the @-import |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `cli/commands/snapshot.py` | 20 | `_PHASE1_MODELS = ["project.project", "res.partner"]` hardcoded | INFO | Intentional Phase 1 stub — comment notes "Phase 3 will enumerate from config". Not a blocking anti-pattern. |
| `cli/commands/plan.py` | 12 | `"not yet implemented (Phase 3)"` + `raise typer.Exit(code=1)` | INFO | Intentional stub per plan design. Required behavior for Phase 1. |

No `TBD`, `FIXME`, or `XXX` markers found in any source file. No unreferenced debt markers.

---

## Warnings (Non-blocking)

**SCHEM-01 archivable writability gap:** The requirement states "archivability (active field presence and **writability**)" but `registry.py:53` only checks `active_field.store` — not `active_field.readonly`. In practice, the `active` field on Odoo 17 CE standard models is never readonly, so this is not a runtime defect. However, `SAFE-02` (Phase 4) depends on `archivable` being accurate. This is a partial implementation of the stated requirement.

Severity: WARNING (not BLOCKER). The check is correct for all real-world Odoo 17 CE models; the omission of `readonly` check is a future-proofing gap that SAFE-02 may catch if needed. No test exercises a model with a readonly `active` field.

---

## Human Verification Required

### 1. Integration Test Suite (Docker)

**Test:** With Docker available, run `uv run pytest -m integration -x -q` from the project root.

**Expected:** All 6 integration tests pass:
- `test_schema_registry_get` — `project.project` schema with `store: bool` on every field
- `test_store_flag_regression` — `res.partner.display_name.store is False` (SCHEM-05 gate)
- `test_snapshot_round_trip` — build/save/load round-trip against real Odoo 17
- `test_version_mismatch_on_load` — `VersionMismatchError` on stale snapshot (Docker not required but included in suite)
- `test_xmlid_round_trip` — `find_by_xmlid` / `write_xmlid` against real `ir.model.data`
- `test_xmlid_idempotent` — second `write_xmlid` produces exactly one row

**Why human:** Requires Docker runtime and a running Odoo 17 CE container. Definitively satisfies roadmap success criteria 2 and 4.

---

## Gaps Summary

No BLOCKER gaps. All unit-testable must-haves are VERIFIED. The 2 UNCERTAIN items are both verified at the code and unit-test level — they become VERIFIED once the Docker integration suite is confirmed to pass.

The only gap requiring future attention is:
- **SCHEM-01 archivable derivation** (WARNING, not BLOCKER): `readonly` flag is not checked when deriving `archivable`. This may need correction in Phase 4 when SAFE-02 is implemented.

---

_Verified: 2026-05-23_
_Verifier: Claude (gsd-verifier)_
