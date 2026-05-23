# Stack Research

**Domain:** Declarative reconciliation CLI — "Terraform for Odoo" over jsonrpc
**Researched:** 2026-05-23
**Confidence:** HIGH (godoo-py: source-verified; library versions: PyPI-verified; patterns: WebSearch-corroborated)

---

## godoo-py API Surface (locked dependency — source-verified)

godoo-py is a uv workspace monorepo at `../godoo-py`. Requires **Python >= 3.14**.
Four published packages — all LGPL-3.0, all version 0.2.0:

| Package (PyPI name) | Import root | Purpose |
|---------------------|-------------|---------|
| `godoo-client` | `godoo.client` | Async JSON-RPC transport + CRUD helpers + safety guard |
| `godoo-introspection` | `godoo.introspection` | Schema discovery — `Introspector`, `ModelSchema`, `FieldSchema` |
| `godoo-testcontainers` | `godoo.testcontainers` | Docker-based Odoo + Postgres test harness |
| `godoo` (meta) | — | Empty meta-package pulling all three |

### godoo-client — what stateman will call

```
OdooClient(OdooClientConfig(url, database, username, password, safety, timeout))
  .authenticate() → OdooSessionInfo
  .search(model, domain, **kw) → list[int]
  .read(model, ids, fields, **kw) → list[dict]
  .search_read(model, domain, *, fields, limit, offset, order, **kw) → list[dict]
  .search_count(model, domain) → int
  .iter_search_read(model, domain, *, fields, batch_size, limit) → AsyncIterator[dict]
  .fields_get(model, attributes) → dict
  .ref(xml_id) → int                  # resolves xmlid → numeric id
  .create(model, values) → int | list[int]
  .write(model, ids, values) → bool
  .unlink(model, ids) → bool
  .execute_kw(model, method, args, kwargs) → Any   # raw passthrough
  .with_context(**kw)                  # sync ctx-manager; merges ambient RPC context
  .set_safety_context(ctx | None)
  .modules → ModuleManager            # install/uninstall/upgrade/list
  .mail → MailService
  .cdc → CdcService                   # change-data capture / tracking history
  + async context manager (__aenter__/__aexit__)

config_from_env(prefix="ODOO") → OdooClientConfig   # reads ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD
create_client(prefix="ODOO") → OdooClient            # convenience: config_from_env + authenticate
```

Error hierarchy: `OdooError > OdooRpcError > OdooAuthError | OdooNetworkError | OdooTimeoutError | OdooValidationError | OdooAccessError | OdooMissingError`. Plus `OdooSafetyError` (local guard, not an RPC error).

Safety model: `SafetyContext(confirm: Callable[[OperationInfo], Awaitable[bool]])`. Level inferred from method name (READ/WRITE/DELETE). Matches the TS SafetyLevel/SafetyContext rigor.

### godoo-introspection — what stateman needs for schema snapshot

```
Introspector(client)
  .get_schema(name, *, bypass_cache) → ModelSchema
  .get_schemas(names, *, bypass_cache) → dict[str, ModelSchema]

ModelSchema(name, display_name, transient, fields: dict[str, FieldSchema])
FieldSchema(name, ttype, field_description, relation, relation_field,
            required, readonly, store,   # <-- store flag present (BUG-07-B lesson satisfied)
            index, copy, translate, help, compute, depends, modules,
            on_delete, size, digits, selection)
```

Batch fetch is 2–3 RPCs (ir.model + ir.model.fields + optional ir.model.fields.selection). Per-instance `IntrospectionCache` avoids re-fetching. `bypass_cache=True` for forced refresh.

### godoo-testcontainers — what stateman acceptance tests will use

```
TestHarness(*, modules, properties, addons_path, snapshot, cache_dir,
            database, admin_password, startup_timeout, env)
  async context manager → self
  .client → OdooClient      (already authenticated)
  .modules → ModuleManager
  .properties → ConfigParameterHelper
  .url → str

OdooTestContainer(*, modules, database, admin_password, startup_timeout,
                  addons_path, snapshot, cache_dir, env, properties)
  .start() → StartedOdooContainer
```

Snapshot caching: pg_dump/restore keyed on (modules, version, addons content hash, properties).
Seed image path: `ODOO_SEED_IMAGE` env + `docker/seed-config.json` for pre-baked databases.
Odoo version from `ODOO_VERSION` env (defaults `"17.0"`). Uses `odoo:{version}` Docker image.

### godoo-py gaps that stateman must fill

| Gap | Detail | Impact |
|-----|--------|--------|
| No `ir.model.data` write helper | `client.ref()` reads xmlid → int, but stateman needs `write_xmlid(model, res_id, module, name)` — a `create/write` against `ir.model.data` | Must be implemented inside stateman; straightforward via `client.create("ir.model.data", {...})` |
| No xmlid search helper | No `find_by_xmlid(module, name) → record | None` | Stateman implements via `client.search_read("ir.model.data", [...], fields=["res_id", "complete_name"])` |
| No `active` / archive helper | No `toggle_active(model, ids, active)` | One-liner `client.write(model, ids, {"active": False})` |
| No `check_archivability` | schema has `store` flag but no "is this model archivable?" helper | Derive from `FieldSchema(name="active", store=True)` presence in ModelSchema |
| No version-tagged schema snapshot store | `Introspector` caches per-session, not versioned | Stateman owns the schema-snapshot-to-disk layer with explicit Odoo-version dimension |
| Python version constraint | godoo-py requires Python 3.14 | stateman must also target Python 3.14 — this is a hard constraint |

---

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

---

## Key Design Decisions

### CLI Framework: Typer 0.25.1 (not Click, not argparse)

Use Typer. It builds on Click (mature, stable) but eliminates boilerplate through type hints. The five commands (`plan`, `apply`, `verify`, `import`, `snapshot` + `build`) map cleanly to Typer sub-commands with a top-level `app = typer.Typer()`.

**Async bridge required.** Typer does NOT natively run `async def` commands — it invokes the decorated function synchronously. The standard pattern is:

```python
import asyncio
import typer

app = typer.Typer()

@app.command()
def plan(config: Path = typer.Argument(...)):
    asyncio.run(_async_plan(config))

async def _async_plan(config: Path) -> None:
    ...
```

Alternatively use `anyio.run()` if anyio is already a transitive dependency. Both are equivalent. Do NOT use the third-party `async-typer` package (unmaintained). The `asyncio.run()` wrapper is the idiomatic, zero-dependency approach. (Confidence: MEDIUM — verified via GitHub issue #88/#950 discussion; native async was planned but as of 0.25.1 is still not in the codebase.)

### Python DSL Evaluation: `exec()` with restricted namespace (not RestrictedPython)

The config `.py` file describes desired state. Execute it with a controlled namespace and no imports of side-effectful modules:

```python
def evaluate_config(path: Path, dsl_globals: dict) -> ResourceTree:
    source = path.read_text()
    namespace: dict = {"__builtins__": _SAFE_BUILTINS, **dsl_globals}
    exec(compile(source, str(path), "exec"), namespace)
    return namespace["_tree"]
```

`_SAFE_BUILTINS` whitelists `print`, `len`, `range`, `isinstance`, `type`, `str`, `int`, `float`, `bool`, `list`, `dict`, `set`, `tuple`, `None`, `True`, `False`. Import is blocked. The DSL objects (`resource`, `data`, `mail`) are injected as `dsl_globals`.

Do NOT use RestrictedPython — it transforms the AST and breaks walrus operators and modern Python syntax. The threat model here is accidental side effects from misconfigured files authored by the same person running the CLI, not adversarial code. A whitelist builtins dict is sufficient. (Confidence: HIGH — established pattern for Ansible-style config evaluation, Doit task files, etc.)

### Schema Validation: Pydantic v2 (not dataclasses alone)

Use `pydantic.BaseModel` with `model_config = ConfigDict(frozen=True)` for immutable pipeline objects (plan steps, diff entries, lockfile schema). Use `frozen=False` only for objects that accumulate state during execution (e.g., `LiveState`).

Rationale: Pydantic v2 is 5-50x faster than v1 due to Rust core. `model_validate()` at the lockfile deserialization boundary gives clear error messages for schema mismatches. For internal objects that never cross serialization boundaries, Python `dataclasses` are fine — use Pydantic selectively at I/O boundaries.

### Dependency Graph: NetworkX DiGraph (not hand-rolled)

Use `networkx.DiGraph` for the dependency DAG in the graph stage.

```python
import networkx as nx

G = nx.DiGraph()
G.add_node(resource_address, resource=resource_obj)
G.add_edge(dependency_address, resource_address)

# Cycle detection
if not nx.is_directed_acyclic_graph(G):
    cycle = nx.find_cycle(G)
    raise CyclicDependencyError(cycle)

# Execution order (dependencies before dependents)
order = list(nx.topological_sort(G))
```

NetworkX 3.6.1 provides `topological_sort()`, `topological_generations()` (for parallel batches), `find_cycle()`, and `all_simple_paths()`. The full feature set is far cheaper than hand-rolling. Size is acceptable (~4MB). (Confidence: HIGH — verified via networkx.org/documentation/stable.)

### CLI Output and Diff Rendering: Rich 15.0.0

Use `rich.console.Console` throughout. Key primitives:

- `rich.table.Table` — plan step summary (action, model, slug, fields changed)
- `rich.syntax.Syntax(diff_text, "diff")` — coloured unified diff for field value changes
- `rich.panel.Panel` — per-resource plan blocks
- `rich.progress.Progress` — apply stage progress bar
- `rich.traceback.install()` — enhanced tracebacks in dev mode

Do NOT use `click.echo()` or `print()` directly — Rich handles Windows terminal color correctly (unlike raw ANSI). (Confidence: HIGH — version verified on PyPI.)

### Packaging: hatchling + uv, pyproject.toml

Match godoo-py exactly:

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "godoo-stateman"
requires-python = ">=3.14"
license = "LGPL-3.0-or-later"
dependencies = [
    "godoo-client>=0.2.0",
    "godoo-introspection>=0.2.0",
    "typer>=0.25.1",
    "pydantic>=2.13.4",
    "networkx>=3.6.1",
    "rich>=15.0.0",
]

[project.scripts]
godoo-stateman = "godoo_stateman.cli:app"

[tool.hatch.build.targets.wheel]
sources = ["src"]
```

Use `uv` for all local workflows. Publish to PyPI via `uv publish`. Do NOT use Poetry — godoo-py doesn't use it, mixing would complicate the workspace.

---

## Installation

```bash
# Production install
uv add godoo-stateman

# Development setup (from godoo-stateman root)
uv sync

# Dev dependencies
uv add --dev pytest>=8 pytest-asyncio>=0.24 ruff>=0.8 mypy>=1.13 godoo-testcontainers>=0.2.0

# Run tests
uv run pytest -m "not integration"        # unit tests only
uv run pytest -m integration              # requires Docker
```

---

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

---

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

---

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

---

## Testcontainers Pattern for VAL-01 / VAL-02

godoo-testcontainers already provides the full harness. The acceptance test pattern:

```python
import pytest
from godoo.testcontainers import TestHarness

@pytest.fixture(scope="session")
async def odoo():
    async with TestHarness(
        modules=["project"],  # for VAL-01
        snapshot=True,        # pg_dump cache — ~95s cold, ~5s warm
    ) as h:
        yield h

@pytest.mark.integration
async def test_val01_initial_state(odoo, val01_initial_config):
    result = await run_plan(odoo.client, val01_initial_config)
    assert result.all_actions_noop()
```

Set `ODOO_VERSION=17.0` in CI. Snapshot cache avoids re-initializing Odoo on every run. The `integration` marker matches godoo-py's convention for Docker-required tests.

---

## Sources

- PyPI `typer` page — version 0.25.1 confirmed; async support pattern from GitHub issue #88, #950, discussion #864 (MEDIUM confidence — async requires `asyncio.run()` wrapper)
- PyPI `pydantic` page — version 2.13.4 confirmed; frozen model API from docs.pydantic.dev/latest (HIGH)
- PyPI `networkx` page — version 3.6.1 confirmed; `topological_sort`, `find_cycle` from networkx.org/documentation/stable (HIGH)
- PyPI `rich` page — version 15.0.0 confirmed; feature list from rich.readthedocs.io/en/stable (HIGH)
- PyPI `testcontainers` page — version 4.14.2 confirmed (HIGH)
- godoo-py source code at `../godoo-py/packages/` — all API surface and gap analysis are source-verified (HIGH)
- Python packaging guide 2025 — uv + hatchling as recommended defaults; WebSearch-corroborated with Medium blog post cross-check (MEDIUM)

---
*Stack research for: godoo-stateman — Python declarative Odoo reconciliation CLI*
*Researched: 2026-05-23*
