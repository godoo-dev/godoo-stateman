# Python implementation reference

This describes the Python source retained at `db7b260` on 2026-10-22. It is an
incomplete prior implementation, useful for design and tests while standalone
TypeScript delivery proceeds. It is not a commitment to publish or finish a parallel
Python product. Existing Python build metadata declares LGPL-3.0-or-later; preserve
its notices. The successor's distribution/license decision is separate.

## Source map

| Area | Source directory | Responsibility |
| --- | --- | --- |
| Schema | `src/godoo_stateman/schema` | Versioned schema, field writability/store metadata and cache |
| DSL | `src/godoo_stateman/dsl` | Desired resources, data references, normalization and graph |
| Live state | `src/godoo_stateman/live` | Managed records and deferred read resolution |
| Identity | `src/godoo_stateman/identity.py` | XML-ID lookup/write helpers |
| Diff and plan | `src/godoo_stateman/diff.py`, `src/godoo_stateman/plan` | Desired/live comparison, ordered actions and rendering |
| Apply | `src/godoo_stateman/apply` | Serialization, remote IDs, execution and partial-progress result |
| CLI | `src/godoo_stateman/cli` | Typer commands and async bridges |

The useful conceptual pipeline is config → normalize → graph → diff → plan →
apply → verify. Identity lives in Odoo `ir.model.data`, not a shared sidecar state
file. Local schema caching is disposable and must not become the identity source.
Capture `store`, relation target, writability and Odoo/schema versions: non-stored
computed fields without inverses cannot become write targets.

The resource graph spans managed resources, inline children and read-only data
references. Detect cycles before mutation. Global resource-address → remote-ID
resolution must learn each created record before resolving later relations; m2m
writes need Odoo command tuples. Odoo-version-specific fields and archivability
must come from the selected instance, not assumptions copied from a prototype.

## Existing CLI source

| Command | Source-level behavior and boundary |
| --- | --- |
| `plan CONFIG.py` | Evaluates/normalizes, reads schema/live state and renders; exit 0 for no changes, 2 for pending changes, 1 for errors |
| `apply CONFIG.py` | Builds/renders a plan, prompts unless `--auto-approve`, then executes; exits 0 success, 1 pre-execution error, 3 partial failure, 4 first-step failure, 5 declined |
| `import --model MODEL --id ID --module PREFIX --name SLUG` | Explicit XML-ID adoption; validates the record and rejects collisions unless explicitly forced |
| `snapshot CONFIG.py` | Captures schema for fixed `project.project`/`res.partner` models; this is not record export/restore |
| `verify` | Stub, reports not implemented and exits 1 |

The first three use `GODOO_URL`, `GODOO_DB`, `GODOO_USER`, `GODOO_PASSWORD` through
`cli/_connection.py`. `snapshot` still uses `ODOO_URL`, `ODOO_DB` (or
`ODOO_DATABASE`), `ODOO_USER` (or `ODOO_USERNAME`), `ODOO_PASSWORD`. Both use
`ODOO_VERSION` in `N.N` format, default `17.0`. This inconsistency is a prior-source
fact, not a recommended successor interface. Never log connection objects or
passwords. `plan` reads the remote instance; `apply` and `import` mutate it.

The apply executor records committed, failed and skipped work and stops on failure.
Each RPC can commit independently: whole-run rollback is unavailable. A create
followed by failed XML-ID write requires a recoverable result and must not cause
blind duplicate creates. Archive/delete need concrete owned targets and writable
schema support; relation removal and target deletion are different operations.
The TS contract strengthens ownership/adoption beyond merely finding an XML ID.

These statements come from source inspection. They do not prove the complete
create → no-op → update → drift lifecycle or VAL-01/VAL-02 acceptance; module
operations, cancellation, record snapshot restore and standalone verify remain
incomplete prior-product obligations to reevaluate against the TS contract.

## Working with the reference source

Python >=3.14 and uv are required. `pyproject.toml` points editable dependencies at
individual packages in sibling `godoo-py`; a fresh checkout without that sibling
cannot resolve this development environment unchanged.

```sh
uv sync --locked --group dev
uv run pytest tests/unit/ -m 'not integration'
uv run ruff check src tests
uv run mypy src
```

Integration is explicit: `uv run pytest -m integration` starts Docker/Odoo, and the
prior Python CI matrix selected Odoo 17.0/18.0/19.0. Active CI now checks the
TypeScript offline foundation. Neither the old matrix nor historical Python check
output establishes current TS compatibility. Do not run live/business
instances to verify a documentation edit.
