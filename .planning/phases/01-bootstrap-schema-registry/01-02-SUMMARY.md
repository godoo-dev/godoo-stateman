---
phase: 01-bootstrap-schema-registry
plan: "02"
subsystem: schema-registry
tags: [schema, pydantic, registry, snapshot, snapshot-command, cli]
dependency_graph:
  requires:
    - godoo_stateman.errors.VersionMismatchError
    - godoo.introspection.Introspector
    - godoo.introspection.types.ModelSchema
    - godoo.introspection.types.FieldSchema
    - godoo.client.client.OdooClient
    - godoo.testcontainers.TestHarness
  provides:
    - godoo_stateman.schema.version.OdooVersion
    - godoo_stateman.schema.version.SCHEMA_FORMAT_VERSION
    - godoo_stateman.types.schema.VersionedFieldSchema
    - godoo_stateman.types.schema.VersionedModelSchema
    - godoo_stateman.schema.registry.SchemaRegistry
    - godoo_stateman.schema.snapshot.VersionedSnapshot
  affects:
    - All downstream plans (plan, apply, verify, import) depend on SchemaRegistry and VersionedModelSchema
    - Phase 3 will replace the hardcoded model list in snapshot command
tech_stack:
  added:
    - platformdirs>=4.9.6 (XDG cache path for snapshot files)
  patterns:
    - Pydantic v2 frozen BaseModel for all typed pipeline objects
    - SchemaRegistry as the sole gateway to godoo-py Introspector
    - In-memory dict cache + platformdirs disk cache
    - Typer sync wrapper + asyncio.run(_impl()) — unchanged from plan 01
    - VersionMismatchError as the version-gate exception type
    - archivable flag derived from presence of stored 'active' field
    - TYPE_CHECKING guard for OdooClient import in registry.py
key_files:
  created:
    - src/godoo_stateman/schema/__init__.py
    - src/godoo_stateman/schema/version.py
    - src/godoo_stateman/schema/registry.py
    - src/godoo_stateman/schema/snapshot.py
    - src/godoo_stateman/types/__init__.py
    - src/godoo_stateman/types/schema.py
    - tests/unit/test_schema_registry.py
    - tests/conftest.py
    - tests/acceptance/__init__.py
    - tests/acceptance/test_snapshot.py
  modified:
    - src/godoo_stateman/cli/commands/snapshot.py
decisions:
  - "archivable derived by SchemaRegistry.get() not VersionedModelSchema — VersionedModelSchema accepts it as constructor arg; avoids Pydantic validator complexity"
  - "SCHEMA_FORMAT_VERSION lives in schema/version.py; snapshot.py imports it from there (Open Question Q2 RESOLVED)"
  - "snapshot command hardcodes ['project.project', 'res.partner'] for Phase 1 — real config enumeration deferred to Phase 3 per spec"
  - "TYPE_CHECKING guard for OdooClient in registry.py avoids circular imports at runtime"
  - "test_version_mismatch_on_load kept as @pytest.mark.integration for consistent filter but does not require Docker"
metrics:
  duration: "3m 37s"
  completed_date: "2026-05-23"
  tasks_completed: 2
  files_created: 10
  files_modified: 1
---

# Phase 01 Plan 02: Schema Registry — Types, Registry, Snapshot Summary

Pydantic v2 versioned schema types, SchemaRegistry wrapping godoo-py Introspector with OdooVersion seam, VersionedSnapshot with disk I/O and version-gate enforcement, and the snapshot command wired end-to-end with env-credential security and platformdirs cache path.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Schema types, version constants, registry, snapshot + unit tests | 75a3669 | schema/version.py, schema/registry.py, schema/snapshot.py, types/schema.py, tests/unit/test_schema_registry.py |
| 2 | Wire snapshot command + acceptance tests | b4a05d5 | cli/commands/snapshot.py, tests/conftest.py, tests/acceptance/test_snapshot.py |

## Verification Evidence

- `uv run pytest tests/unit/ -x -q` — 27 tests, all pass (0.32s, no Docker)
- `uv run pytest tests/unit/test_schema_registry.py -x -q` — 20 tests, all pass; covers SCHEM-01 through SCHEM-04
- `uv run godoo-stateman --help` — exits 0, all 5 commands listed including snapshot
- `uv run python -c "from godoo_stateman.cli.commands.snapshot import snapshot"` — imports OK
- `tests/acceptance/test_snapshot.py` — 4 integration tests created; covers SCHEM-02, SCHEM-03, SCHEM-04, SCHEM-05; requires Docker to run (`uv run pytest -m integration -q`)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

| File | Content | Reason |
|------|---------|--------|
| src/godoo_stateman/cli/commands/plan.py | Prints "plan: not yet implemented (Phase 3)" + Exit(1) | Inherited stub from plan 01; plan 03 implements |
| src/godoo_stateman/cli/commands/apply.py | Prints "apply: not yet implemented (Phase 4)" + Exit(1) | Inherited stub from plan 01; plan 04 implements |
| src/godoo_stateman/cli/commands/verify.py | Prints "verify: not yet implemented (Phase 5)" + Exit(1) | Inherited stub from plan 01; plan 05 implements |
| src/godoo_stateman/cli/commands/import_.py | Prints "import: not yet implemented (Phase 3)" + Exit(1) | Inherited stub from plan 01; plan 03 implements |
| src/godoo_stateman/cli/commands/snapshot.py | Hardcoded `_PHASE1_MODELS = ["project.project", "res.partner"]` | Phase 1 spec; real config enumeration comes in Phase 3 |

The snapshot command is fully functional; only the model list is hardcoded for Phase 1.

## Threat Surface Scan

All threats from the plan's STRIDE register were mitigated as implemented:

| Threat ID | Mitigation | Implemented |
|-----------|-----------|-------------|
| T-02-01 | Credentials from env only; error prints var names not values | Yes — `_snapshot_impl` reads `ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_PASSWORD`; missing-var message lists names only |
| T-02-02 | Pydantic `model_validate()` at snapshot load boundary | Yes — `VersionedSnapshot.load()` calls `cls.model_validate(data)` before any version check |
| T-02-03 | `re.match(r"^\d+\.\d+$", odoo_version)` before path use | Yes — validated before `OdooVersion` construction; raises `typer.BadParameter` if invalid |
| T-02-04 | Rich console warning on http:// to non-local host | Yes — `urlparse` checks scheme + hostname; warns but does not block (ASVS L1) |

## Self-Check: PASSED

- [x] src/godoo_stateman/schema/version.py exists with OdooVersion and SCHEMA_FORMAT_VERSION=1
- [x] src/godoo_stateman/schema/registry.py exists with SchemaRegistry._instance_hash, .get(), .build_snapshot(), .cache_path()
- [x] src/godoo_stateman/schema/snapshot.py exists with VersionedSnapshot.save() and .load()
- [x] src/godoo_stateman/types/schema.py exists with VersionedFieldSchema and VersionedModelSchema (Pydantic v2 frozen)
- [x] tests/unit/test_schema_registry.py — 20 passing tests
- [x] tests/conftest.py — session-scoped odoo TestHarness fixture
- [x] tests/acceptance/test_snapshot.py — 4 integration tests with @pytest.mark.integration
- [x] 27 total unit tests pass (0 failures)
- [x] snapshot command wired end-to-end with env credentials and platformdirs cache
- [x] Commits 75a3669 and b4a05d5 exist in git log
