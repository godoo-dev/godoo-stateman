---
phase: 01-bootstrap-schema-registry
plan: "01"
subsystem: scaffold
tags: [cli, typer, pyproject, errors, packaging]
dependency_graph:
  requires: []
  provides:
    - godoo_stateman.errors.StatemanError
    - godoo_stateman.errors.VersionMismatchError
    - godoo_stateman.cli.app:app (entry point)
    - pyproject.toml (hatchling, deps, tool config)
  affects:
    - All downstream plans depend on the package structure and entry point
tech_stack:
  added:
    - typer 0.25.1 (CLI framework)
    - pydantic >=2.13.4 (data models, future plans)
    - rich >=15.0.0 (CLI output)
    - platformdirs >=4.9.6 (XDG cache, future plans)
    - godoo-client 0.2.0 (jsonrpc transport, local path)
    - godoo-introspection 0.2.0 (schema discovery, local path)
    - godoo-testcontainers 0.2.0 (acceptance tests, local path)
  patterns:
    - Typer sync wrapper + asyncio.run(_impl()) for async commands
    - Local error hierarchy (StatemanError, VersionMismatchError) independent of OdooError
    - uv.sources pointing to individual godoo-py package subdirectories
key_files:
  created:
    - pyproject.toml
    - uv.lock
    - README.md
    - src/godoo_stateman/__init__.py
    - src/godoo_stateman/errors.py
    - src/godoo_stateman/cli/__init__.py
    - src/godoo_stateman/cli/app.py
    - src/godoo_stateman/cli/commands/__init__.py
    - src/godoo_stateman/cli/commands/plan.py
    - src/godoo_stateman/cli/commands/apply.py
    - src/godoo_stateman/cli/commands/verify.py
    - src/godoo_stateman/cli/commands/import_.py
    - src/godoo_stateman/cli/commands/snapshot.py
    - tests/__init__.py
    - tests/unit/__init__.py
    - tests/unit/test_cli_help.py
  modified: []
decisions:
  - "uv.sources paths corrected to individual package dirs (../godoo-py/packages/godoo, etc.) — workspace root path caused setuptools multi-package discovery error"
  - "README.md added (hatchling required it; pyproject.toml referenced it)"
  - "import command registered as app.command('import')(import_) — Python keyword conflict"
metrics:
  duration: "4m 19s"
  completed_date: "2026-05-23"
  tasks_completed: 3
  files_created: 16
---

# Phase 01 Plan 01: Walking Skeleton — pyproject.toml + CLI Scaffold Summary

Bootstrapped godoo-stateman as a runnable Python project: pyproject.toml with hatchling backend and all deps, error hierarchy, Typer CLI with five registered commands (four stubs + snapshot stub), confirmed public GitHub repo.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | pyproject.toml + package skeleton | d6b8d2b | pyproject.toml, uv.lock, errors.py |
| 2 | Typer CLI skeleton + unit test | 8f29ef1 | cli/app.py, commands/*.py, tests/unit/test_cli_help.py |
| 3 | Confirm public GitHub repository (PKG-05) | (no code — repo created) | github.com/godoo-dev/godoo-stateman |

## Verification Evidence

- `uv run godoo-stateman --help` exits 0, lists all 5 commands (plan, apply, verify, import, snapshot)
- `uv run pytest tests/unit/test_cli_help.py -x -q` — 7 tests, all pass
- `uv run python -c "from godoo_stateman.errors import StatemanError, VersionMismatchError"` exits 0
- `uv build` produces `dist/godoo_stateman-0.1.0-py3-none-any.whl`
- `gh repo view godoo-dev/godoo-stateman --json visibility` returns PUBLIC

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] uv.sources path corrected from workspace root to individual packages**
- **Found during:** Task 1 — `uv sync` failed
- **Issue:** pyproject.toml `[tool.uv.sources]` pointed to `../godoo-py` (the workspace root). The godoo-py workspace root contains `packages/` and `docker/` directories; setuptools multi-package discovery error: "Multiple top-level packages discovered in a flat-layout"
- **Fix:** Changed each source path to the individual package directory: `../godoo-py/packages/godoo`, `../godoo-py/packages/godoo-introspection`, `../godoo-py/packages/godoo-testcontainers`
- **Files modified:** pyproject.toml
- **Commit:** d6b8d2b

**2. [Rule 3 - Blocking] README.md added**
- **Found during:** Task 1 — `uv sync` failed with "Readme file does not exist: README.md"
- **Issue:** pyproject.toml referenced `readme = "README.md"` but the file did not exist; hatchling requires it
- **Fix:** Created README.md with project description, installation, and license info
- **Files modified:** README.md (created)
- **Commit:** d6b8d2b

## Known Stubs

| File | Content | Reason |
|------|---------|--------|
| src/godoo_stateman/cli/commands/plan.py | Prints "plan: not yet implemented (Phase 3)" + Exit(1) | Stub per plan spec; plan 03 implements |
| src/godoo_stateman/cli/commands/apply.py | Prints "apply: not yet implemented (Phase 4)" + Exit(1) | Stub per plan spec; plan 04 implements |
| src/godoo_stateman/cli/commands/verify.py | Prints "verify: not yet implemented (Phase 5)" + Exit(1) | Stub per plan spec; plan 05 implements |
| src/godoo_stateman/cli/commands/import_.py | Prints "import: not yet implemented (Phase 3)" + Exit(1) | Stub per plan spec; plan 03 implements |
| src/godoo_stateman/cli/commands/snapshot.py | `_snapshot_impl` prints "schema registry wiring in progress" | Stub body; plan 02 Task 3 wires up SchemaRegistry |

These stubs are intentional per plan spec (D-18). The snapshot command is registered and functional in its CLI structure; only the implementation body is a stub.

## Threat Surface Scan

No new security-relevant surface beyond the plan's threat model. `pyproject.toml` contains no credentials. GitHub repo was created with `gh` CLI (no token read into context). `uv.sources` paths are local filesystem references, not network installs.

## Self-Check: PASSED

- [x] pyproject.toml exists with hatchling backend
- [x] uv.lock committed alongside pyproject.toml
- [x] src/godoo_stateman/errors.py exports StatemanError, VersionMismatchError
- [x] cli/app.py exports app Typer instance with 5 commands
- [x] tests/unit/test_cli_help.py — 7 passing tests
- [x] GitHub repo godoo-dev/godoo-stateman is PUBLIC
- [x] CLAUDE.md @-import present on line 2
- [x] dist/godoo_stateman-0.1.0-py3-none-any.whl produced by `uv build`
- [x] Commits d6b8d2b and 8f29ef1 exist in git log
