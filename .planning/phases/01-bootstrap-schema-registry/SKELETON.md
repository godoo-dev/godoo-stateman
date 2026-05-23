# Walking Skeleton — godoo-stateman

**Phase:** 1
**Generated:** 2026-05-23

## Capability Proven End-to-End

A developer runs `uv run godoo-stateman snapshot` against a live Odoo 17 CE instance (via testcontainers), receives a versioned JSON schema snapshot in the platformdirs user-cache directory with `odoo_version`, `schema_format_version`, and `store` flag populated for every field — and the helper functions `write_xmlid`/`find_by_xmlid` round-trip correctly against `ir.model.data`.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Python 3.14 | Hard floor from godoo-py `requires-python = ">=3.14"` — no flexibility |
| CLI framework | Typer 0.25.1 + `asyncio.run()` bridge | Type-hint-driven commands; locked by CLAUDE.md; Typer 0.25.1 has no native async, so every command is a sync wrapper calling `asyncio.run(_impl(...))` |
| Odoo transport | godoo-client 0.2.0 (`OdooClient`) | Locked dependency; async JSON-RPC with safety guard, session management, retry logic |
| Schema introspection | godoo-introspection 0.2.0 (`Introspector`) | Locked dependency; source-verified `store` flag population at introspector.py line 290 |
| Schema snapshot storage | platformdirs `user_cache_path("godoo-stateman")` / `<odoo_version>/<instance_hash>.json` | XDG-compliant, cross-platform, regenerable cache (not state); D-01/D-02 locked |
| Snapshot format | Pydantic v2 `BaseModel` with `ConfigDict(frozen=True)` + `model_dump_json()` | JSON round-trip correctness, structural validation on load, frozen for thread safety |
| Internal value objects | `@dataclass(frozen=True)` | Hashable value objects without serialization overhead (e.g., `XmlIdRecord`, `OdooVersion`) |
| Build backend | hatchling + uv | Matches godoo-py packaging convention; `src/` layout; uv workspace for local godoo-py deps |
| Directory layout | `src/godoo_stateman/` with sub-packages: `cli/`, `schema/`, `types/` + top-level `identity.py`, `errors.py` | Mirrors godoo-py package structure; clean separation of CLI, schema, and identity concerns |
| Error hierarchy | `StatemanError` base (local) alongside godoo-py's `OdooError` hierarchy (remote) | Local errors (e.g., `VersionMismatchError`) do NOT subclass `OdooError` — different responsibility boundary |
| Test harness | pytest 8 + pytest-asyncio (asyncio_mode="auto") + testcontainers (godoo-testcontainers 0.2.0) | Matches godoo-py dev tooling; `integration` marker gates Docker-dependent tests |
| Credential handling | Env vars only (`ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_PASSWORD`) | ASVS L1 — credentials never in DSL config or codebase |

## Stack Touched in Phase 1

- [x] Project scaffold (pyproject.toml, hatchling, uv, src layout, ruff, mypy, pytest config)
- [x] Routing — CLI entry point (`godoo-stateman`) with 5 registered commands
- [x] Database — real Odoo 17 read (schema introspection via `ir.model` + `ir.model.fields`) AND real write (`ir.model.data` via `write_xmlid`)
- [x] UI — Rich console output in `snapshot` command; stub messages in `plan`/`apply`/`verify`/`import`
- [x] Deployment — `uv run godoo-stateman` local full-stack run; acceptance tests via `uv run pytest -m integration`

## Out of Scope (Deferred to Later Slices)

- DSL config evaluation (`exec()` with restricted builtins) — Phase 2
- Normalize, diff, plan, and apply pipeline stages — Phases 2–4
- `GlobalLiveState` and cross-apply m2m resolution — Phase 4
- `resolve()` escape hatch design spike — Phase 2
- Configurable `--schema-dir` flag / env var override — v1.1 (D-05)
- DSL module-naming policy (how config authors namespace xmlids) — Phase 2 (D-12)
- Full `import`, `verify`, `plan`, `apply` command implementations — Phases 2–5
- Module install/upgrade operations — Phase 5
- PyPI release packaging, LGPL headers, public README — Phase 6
- Multi-version schema registry (multiple concurrent Odoo versions) — v2

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: A developer evaluates a `.py` config file with `resource()` / `data()` / `with` / walrus DSL surface and gets a valid `DesiredState` tree + dependency DAG with cycle detection — no Odoo calls
- Phase 3: `godoo-stateman plan config.py` fetches live state, diffs desired vs. live, and prints a human-readable reviewable plan; `import` adopts existing records into managed state
- Phase 4: `godoo-stateman apply config.py` executes the plan sequentially in dependency order against real Odoo 17 and passes all 5 VAL-01 subtests
- Phase 5: Module ops, verify, snapshot export/restore, and VAL-02 pass; test suite reaches 29 files / 4,564 LOC
- Phase 6: PyPI publish, LGPL headers on every source file, public README quickstart
