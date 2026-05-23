<!-- Umbrella context: topology, three-layer architecture, spine role, coordination rules -->
@../godoo-hq/UMBRELLA_CLAUDE.md

<!-- GSD:project-start source:PROJECT.md -->
## Project

**godoo-stateman**

A standalone Python CLI — "Terraform for Odoo" — that reconciles Odoo instance state
remotely over jsonrpc. It evaluates a Python DSL describing desired Odoo state, diffs
it against live Odoo, and executes a plan of creates/updates/deletes/archives in
dependency order. Designed for community use, released under LGPL-3.0, targeting the
Odoo 17+ ecosystem via `godoo-py` for transport and introspection.

**Core Value:** Deterministic, idempotent Odoo state reconciliation from a version-controlled Python config
file — without an agent, an addon, or a sidecar state file.

### Constraints

- **Tech stack**: Python CLI; jsonrpc-only Odoo interface via `godoo-py`. No Go, no TypeScript, no server-side Odoo component.
- **Python version**: Target the version required by `godoo-py` (verify before locking).
- **State boundary**: State lives exclusively in Odoo's `ir.model.data`. No sidecar state file, no local DB.
- **Odoo version**: Odoo 17 CE is the primary target. The schema-snapshot/registry layer must carry an explicit Odoo-version dimension from day one.
- **Test harness**: Acceptance tests run against real Odoo 17 via testcontainers. Unit/integration split matches or exceeds TS benchmark (29 files / 4,564 LOC).
- **Packaging**: PyPI public release. Licensing: LGPL-3.0.
- **Repo**: `godoo-dev/godoo-stateman` public GitHub repo (`gh repo create --public`).
- **CLAUDE.md**: Must `@`-import `../godoo-hq/UMBRELLA_CLAUDE.md`. This is a hard wiring requirement, not optional.
- **No code transfer**: No Go source from `C:\dev\godoo` is ported. Design only.

---
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## godoo-py API Surface (locked dependency — source-verified)
| Package (PyPI name) | Import root | Purpose |
|---------------------|-------------|---------|
| `godoo-client` | `godoo.client` | Async JSON-RPC transport + CRUD helpers + safety guard |
| `godoo-introspection` | `godoo.introspection` | Schema discovery — `Introspector`, `ModelSchema`, `FieldSchema` |
| `godoo-testcontainers` | `godoo.testcontainers` | Docker-based Odoo + Postgres test harness |
| `godoo` (meta) | — | Empty meta-package pulling all three |
### godoo-client — what stateman will call
### godoo-introspection — what stateman needs for schema snapshot
### godoo-testcontainers — what stateman acceptance tests will use
### godoo-py gaps that stateman must fill
| Gap | Detail | Impact |
|-----|--------|--------|
| No `ir.model.data` write helper | `client.ref()` reads xmlid → int, but stateman needs `write_xmlid(model, res_id, module, name)` — a `create/write` against `ir.model.data` | Must be implemented inside stateman; straightforward via `client.create("ir.model.data", {...})` |
| No xmlid search helper | No `find_by_xmlid(module, name) → record | None` | Stateman implements via `client.search_read("ir.model.data", [...], fields=["res_id", "complete_name"])` |
| No `active` / archive helper | No `toggle_active(model, ids, active)` | One-liner `client.write(model, ids, {"active": False})` |
| No `check_archivability` | schema has `store` flag but no "is this model archivable?" helper | Derive from `FieldSchema(name="active", store=True)` presence in ModelSchema |
| No version-tagged schema snapshot store | `Introspector` caches per-session, not versioned | Stateman owns the schema-snapshot-to-disk layer with explicit Odoo-version dimension |
| Python version constraint | godoo-py requires Python 3.14 | stateman must also target Python 3.14 — this is a hard constraint |
## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Python | 3.14 | Runtime | Hard constraint from godoo-py. Python 3.14 is current stable as of late 2025. |
| `godoo-client` | 0.2.0 | jsonrpc transport | Locked dependency — provides async CRUD, safety guard, module manager |
| `godoo-introspection` | 0.2.0 | Schema discovery | Locked dependency — provides ModelSchema/FieldSchema with `store` flag |
| Typer | 0.25.1 | CLI framework | Type-hint-driven commands, rich help output, subcommand trees, Click-based (tested, stable). See async note below. |
| Pydantic v2 | 2.13.4 | Internal data models | Validated dataclasses for plan steps, lockfile schema, diff output. Fast Rust core. Frozen models for immutable pipeline objects. |
| NetworkX | 3.6.1 | Dependency DAG | `DiGraph` + `topological_sort()` + `find_cycle()` covers graph/diff/plan stage. Battle-tested; no need for hand-rolled DAG. |
| Rich | 15.0.0 | CLI output and diff rendering | Tables, `Syntax` (diff output), `Panel`, progress bars — all needed for plan display. MIT license. |
| uv | latest | Dependency management + packaging | Already used by godoo-py. `uv build` with hatchling backend. Fast installs. |
| hatchling | latest | Build backend | Already used by godoo-py — keeps both repos consistent. Supports `src/` layout cleanly. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pytest` | >=8 | Test runner | All tests — matches godoo-py dev deps |
| `pytest-asyncio` | >=0.24 | Async test support | All async tests (all pipeline stages are async) |
| `godoo-testcontainers` | 0.2.0 | VAL-01 / VAL-02 acceptance tests | Integration tests against real Odoo 17 via Docker |
| `ruff` | >=0.8 | Linter + formatter | Already used by godoo-py; matches `target-version = "py314"` |
| `mypy` | >=1.13 | Type checking | Strict mode; matches godoo-py configuration |
| `python-semantic-release` | >=9 | Release automation | If adopting same release flow as godoo-py |
| `anyio` | >=4 | Async bridge for Typer | Required to run `async def` commands from Typer (see note below) |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| uv | Workspace + venv + publish | Use `uv run`, `uv build`, `uv publish`. Matches godoo-py toolchain. |
| ruff | Lint + format | `target-version = "py314"`, `line-length = 120`, select `["E","F","W","I","UP","B","SIM","TCH","RUF"]` |
| mypy | Static typing | `strict = true`, `python_version = "3.14"`, `disallow_untyped_defs = true` |
| Docker | Required for acceptance tests | `testcontainers` pulls `odoo:17.0` + `postgres:15-alpine` |
## Key Design Decisions
### CLI Framework: Typer 0.25.1 (not Click, not argparse)
### Python DSL Evaluation: `exec()` with restricted namespace (not RestrictedPython)
### Schema Validation: Pydantic v2 (not dataclasses alone)
### Dependency Graph: NetworkX DiGraph (not hand-rolled)
# Cycle detection
# Execution order (dependencies before dependents)
### CLI Output and Diff Rendering: Rich 15.0.0
- `rich.table.Table` — plan step summary (action, model, slug, fields changed)
- `rich.syntax.Syntax(diff_text, "diff")` — coloured unified diff for field value changes
- `rich.panel.Panel` — per-resource plan blocks
- `rich.progress.Progress` — apply stage progress bar
- `rich.traceback.install()` — enhanced tracebacks in dev mode
### Packaging: hatchling + uv, pyproject.toml
## Installation
# Production install
# Development setup (from godoo-stateman root)
# Dev dependencies
# Run tests
## Alternatives Considered
| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| CLI framework | Typer 0.25.1 | Click directly | Typer adds type-hint ergonomics and rich help output with no downside; it's a thin wrapper over Click |
| CLI framework | Typer 0.25.1 | argparse | argparse has no type safety, verbose boilerplate, poor help formatting |
| Data validation | Pydantic v2 | `dataclasses` everywhere | Pydantic adds serialization and validation at I/O boundaries; dataclasses are fine internally |
| Data validation | Pydantic v2 | attrs | Less ecosystem traction; Pydantic v2 is de facto standard for typed Python in 2025 |
| Graph | NetworkX | Hand-rolled DAG | NetworkX has all primitives needed (cycle detection, topo sort, generations); reimplementing wastes time |
| Graph | NetworkX | graphlib (stdlib) | `graphlib.TopologicalSorter` exists but lacks cycle detection details, no edge metadata, fewer utilities |
| Output | Rich | Click's echo + termcolor | Rich renders diff, tables, panels and handles Windows color; no comparison |
| Output | Rich | Textual | Textual is an interactive TUI framework; overkill for a non-interactive CLI |
| Build backend | hatchling | uv_build | uv_build is newer and zero-config but less mature; hatchling is what godoo-py uses — consistency wins |
| Build backend | hatchling | poetry-core | Poetry-core couples build to Poetry's lockfile model; unnecessary friction with uv workspace |
| Testing | pytest | unittest | pytest is the ecosystem standard; pytest-asyncio handles async test functions |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `erppeek` / `odoorpc` / `odoo-client-lib` | Alternative Odoo clients — locked decision excluded them | `godoo-client` (see locked decisions) |
| RestrictedPython | Breaks walrus operators and f-strings with complex expressions; overkill for trusted authors | `exec()` with restricted `__builtins__` dict |
| `async-typer` (PyPI) | Unmaintained third-party wrapper; last release was 2022 | `asyncio.run()` wrapper in each command function |
| `graphlib` (stdlib) | No cycle detection detail, no edge metadata, no path analysis | NetworkX DiGraph |
| `click.echo` / `print` | No color on Windows without extra deps; no diff/table rendering | Rich Console |
| Pydantic v1 | Legacy API; 10-50x slower than v2; no `model_config`; deprecated | Pydantic v2 (already current) |
| `setup.py` / `setup.cfg` | Legacy packaging; pyproject.toml is the standard | `pyproject.toml` + hatchling |
| Poetry | godoo-py uses uv; mixing breaks workspace integration | uv |
## Version Compatibility
| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `godoo-client` 0.2.0 | Python >=3.14 | Hard lower bound — stateman must match |
| `godoo-introspection` 0.2.0 | `godoo-client` >=0.1.0 | Use workspace path in dev |
| `godoo-testcontainers` 0.2.0 | `testcontainers[postgres]` >=4 | testcontainers 4.14.2 is current |
| `typer` 0.25.1 | Python >=3.7, click >=8.0 | No upper bound issues |
| `pydantic` 2.13.4 | Python >=3.8 | v2 only — do not mix v1 imports |
| `networkx` 3.6.1 | Python >=3.10 | Satisfied by Python 3.14 |
| `rich` 15.0.0 | Python >=3.9.0 | Satisfied by Python 3.14 |
## Testcontainers Pattern for VAL-01 / VAL-02
## Sources
- PyPI `typer` page — version 0.25.1 confirmed; async support pattern from GitHub issue #88, #950, discussion #864 (MEDIUM confidence — async requires `asyncio.run()` wrapper)
- PyPI `pydantic` page — version 2.13.4 confirmed; frozen model API from docs.pydantic.dev/latest (HIGH)
- PyPI `networkx` page — version 3.6.1 confirmed; `topological_sort`, `find_cycle` from networkx.org/documentation/stable (HIGH)
- PyPI `rich` page — version 15.0.0 confirmed; feature list from rich.readthedocs.io/en/stable (HIGH)
- PyPI `testcontainers` page — version 4.14.2 confirmed (HIGH)
- godoo-py source code at `../godoo-py/packages/` — all API surface and gap analysis are source-verified (HIGH)
- Python packaging guide 2025 — uv + hatchling as recommended defaults; WebSearch-corroborated with Medium blog post cross-check (MEDIUM)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
