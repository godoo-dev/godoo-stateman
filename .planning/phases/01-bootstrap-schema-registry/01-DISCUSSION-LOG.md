# Phase 1: Bootstrap + Schema Registry - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-23
**Phase:** 1-Bootstrap + Schema Registry
**Areas discussed:** Snapshot on-disk layout, store-flag strategy, ir.model.data namespace, write_xmlid shape, CLI skeleton scope

---

## Snapshot On-Disk Layout

| Option | Description | Selected |
|--------|-------------|----------|
| XDG cache (regenerable) | Store in `platformdirs.user_cache_path()`; treated as a cache, not committed to repo; re-snapshot like `terraform init` | ✓ |
| Repo-local committed | Store alongside config in the project repo; committed to version control | |
| Configurable (both) | Accept a `--schema-dir` flag that defaults to XDG cache but can be overridden | |

**User's choice:** XDG cache, regenerable.
**Notes:** Consistent with the "no sidecar state file" design rule — schema cache is not reconciliation state. Configurable location deferred to v1.1.

---

## store-flag Strategy (SCHEM-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Trust Introspector | Consume `FieldSchema.store` directly from godoo-py; no supplemental call | ✓ |
| Always supplement fields_get | Call `fields_get` on every model as a second pass to confirm store flags | |
| Detect-and-fallback | Check if store is populated; fall back to `fields_get` only if missing | |

**User's choice:** Trust Introspector.
**Notes:** Source-verified that `introspector.py` ~line 290 already reads `store` from `ir.model.fields`. The `field_cache.py` apparent conflict is a non-issue — it's a separate CDC consumer that doesn't fetch the `store` column.

---

## ir.model.data Namespace

| Option | Description | Selected |
|--------|-------------|----------|
| Synthetic `__stateman__` namespace | Inject a fixed module prefix for all stateman-managed records | |
| Namespace-agnostic helpers | `write_xmlid` and `find_by_xmlid` take `module` and `name` as explicit author-controlled args; no injected prefix | ✓ |
| Configurable namespace | Allow a top-level config key to set a default module prefix | |

**User's choice:** Namespace-agnostic.
**Notes:** User rejected the premise of a synthetic namespace: "every record has its own module already." Stateman is config-driven — DSL authors declare each resource's identity deliberately, like writing an Odoo data module. Module-naming policy (how the DSL author sets the module name) is deferred to Phase 2.

---

## write_xmlid Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Upsert + XmlIdRecord | Idempotent upsert; return a frozen `XmlIdRecord` dataclass | |
| Upsert + int | Idempotent upsert; return the raw `res_id` int | |
| Decide in planning | Lock the upsert contract now; leave return type to the planner | ✓ |

**User's choice:** Idempotent-upsert contract locked, return type decided in planning.
**Notes:** The critical contract is idempotency (create if absent, rewrite `res_id` if xmlid exists). The exact return shape is a planning detail, not a discussion-phase decision.

---

## CLI Skeleton Scope

| Option | Description | Selected |
|--------|-------------|----------|
| snapshot real + 4 stubbed | `snapshot` is fully functional in Phase 1; `plan`/`apply`/`verify`/`import` are stubs exiting 1 | ✓ |
| All stubbed | All five commands are stubs in Phase 1; snapshot deferred to later | |
| snapshot + inspect | Add an extra `inspect` command alongside snapshot for schema browsing | |

**User's choice:** snapshot real, four stubbed.
**Notes:** `snapshot` is not scope creep — Phase 1 success criteria #2 and #3 are essentially the snapshot command's job. Making it functional closes the registry feedback loop with a real testcontainers acceptance test. Stubs exit code 1 (NOT 2; Phase 3 reserves exit 2 on `plan` for "changes pending").

---

## Claude's Discretion

The following items were locked by the CLAUDE.md tech-stack table and required no user decision during discussion:
- CLI framework: Typer 0.25.1
- Data validation: Pydantic v2
- Dependency graph: NetworkX DiGraph
- CLI output: Rich 15.0.0
- Build backend: hatchling + uv
- Async bridge: `asyncio.run()` wrapper pattern (no `async-typer`, no `anyio`)

## Deferred Ideas

- Configurable schema-snapshot location (`--schema-dir` flag / env var) — deferred to v1.1.
- DSL module-naming policy (how config authors namespace resource xmlids) — deferred to Phase 2 (DSL surface).
