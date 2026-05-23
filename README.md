# godoo-stateman

[![PyPI version](https://img.shields.io/pypi/v/godoo-stateman)](https://pypi.org/project/godoo-stateman)
[![Python 3.14+](https://img.shields.io/pypi/pyversions/godoo-stateman)](https://pypi.org/project/godoo-stateman)
[![License: LGPL-3.0-or-later](https://img.shields.io/badge/License-LGPL--3.0--or--later-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0.html)

**Terraform for Odoo** — declarative Odoo state reconciliation over JSON-RPC.

`godoo-stateman` evaluates a Python DSL describing desired Odoo state, diffs it against a live Odoo instance over JSON-RPC, and executes a plan of creates, updates, deletes, and archives in dependency order. State is stored exclusively in Odoo's built-in `ir.model.data` records — no sidecar file, no Odoo addon, and no agent required on the server side.

## Status — Early Development

This is **Phase 1 of 6**. Only the `snapshot` command is functional today.

The commands `plan`, `apply`, `verify`, and `import` are registered in the CLI but each prints "not yet implemented" and exits with code 1. The DSL parser, diff engine, and apply engine are planned for subsequent phases.

| Command | Status |
|---------|--------|
| `snapshot` | Implemented — Phase 1 |
| `plan` | Stub — not yet implemented |
| `apply` | Stub — not yet implemented |
| `verify` | Stub — not yet implemented |
| `import` | Stub — not yet implemented |

## Requirements

- Python 3.14 or later (hard requirement from the JSON-RPC transport dependency)
- Access to an Odoo 17.0+ instance over HTTP or HTTPS

## Installation

**Production:**

```bash
pip install godoo-stateman
```

**Development setup** (using `uv`, which matches the godoo-py toolchain):

```bash
git clone https://github.com/godoo-dev/godoo-stateman.git
cd godoo-stateman
uv sync --group dev
```

The development install uses local workspace paths for the godoo-py packages as configured in `pyproject.toml` via `uv.sources`.

## Usage

### `snapshot` — Capture schema from a live Odoo instance

Connects to Odoo using credentials from environment variables, introspects a fixed set of models (Phase 1: `project.project`, `res.partner`), and writes a versioned schema snapshot to the local cache.

```bash
godoo-stateman snapshot <config>
```

`<config>` is the path to a stateman config `.py` file. In Phase 1 the config path is accepted but model enumeration from config content arrives in Phase 3.

#### Environment variables

Credentials are read exclusively from environment variables — never passed as CLI arguments or stored in the config file.

| Variable | Aliases | Required | Default | Description |
|----------|---------|----------|---------|-------------|
| `ODOO_URL` | — | Yes | — | Full URL to the Odoo instance (e.g. `https://odoo.example.com`) |
| `ODOO_DB` | `ODOO_DATABASE` | Yes | — | Database name |
| `ODOO_USER` | `ODOO_USERNAME` | Yes | — | Odoo login username |
| `ODOO_PASSWORD` | — | Yes | — | Odoo login password |
| `ODOO_VERSION` | — | No | `17.0` | Odoo major.minor version (format: `N.N`, e.g. `17.0`) |

Connecting over plain HTTP to a non-local host causes a warning; use HTTPS in production.

**Example:**

```bash
export ODOO_URL=https://odoo.example.com
export ODOO_DB=production
export ODOO_USER=admin
export ODOO_PASSWORD=...
godoo-stateman snapshot my_config.py
```

### Planned commands (not yet implemented)

The following commands are registered in the CLI but are not yet functional. Each prints "not yet implemented" and exits with code 1 until the relevant phase ships:

- `plan`
- `apply`
- `verify`
- `import`

## Development

**Run tests:**

```bash
uv run pytest                        # unit tests only
uv run pytest -m integration         # requires Docker (pulls odoo:17.0 + postgres:15-alpine)
```

**Linting and type checking:**

```bash
uv run ruff check src tests
uv run mypy src
```

## Repository

https://github.com/godoo-dev/godoo-stateman

## License

LGPL-3.0-or-later. See the `LICENSE` file.
