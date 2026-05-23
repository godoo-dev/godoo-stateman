# Phase 1: Bootstrap + Schema Registry - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers a runnable godoo-stateman Python project skeleton: the full internal type vocabulary, a versioned schema registry that correctly captures the per-field `store` flag (keyed by Odoo version), the xmlid read/write helpers (filling godoo-py's gaps), and a Typer CLI exposing five commands. Everything downstream pipeline stages depend on. Discussion clarified HOW to implement; requirements come from ROADMAP.md (SCHEM-01..05, UX-06, PKG-04, PKG-05).

</domain>

<decisions>
## Implementation Decisions

### Schema Snapshot Storage (SCHEM-01, SCHEM-04)
- **D-01:** Persist snapshots to the XDG/platformdirs user cache (`platformdirs.user_cache_path("godoo-stateman", ...)`), NOT the user's repo. Treated as a regenerable cache, not state — consistent with the "no sidecar state file" rule (schema cache != reconciliation state).
- **D-02:** Key by directory structure `<odoo_version>/<instance_hash>.json` so multiple Odoo versions/instances coexist cleanly. Hash input must be stable (e.g. host+db); document the chosen hash input.
- **D-03:** Each snapshot JSON carries `odoo_version` and `schema_format_version`; loading a snapshot whose version mismatches raises `VersionMismatchError` (SCHEM-04). Staleness is handled at runtime via this error — regenerability is by design.
- **D-04:** CI/reproducibility: re-snapshot as a setup step (analogous to `terraform init`), do NOT commit the cache. Add `platformdirs` as a dependency.
- **D-05:** Configurable location (`--schema-dir`/env override) is DEFERRED to v1.1 — ship one well-documented default for v1.0.

### store-flag Acquisition (SCHEM-03, SCHEM-05) — TRUST the Introspector
- **D-06:** Source-verified: godoo-py `Introspector` already populates `store` correctly. `introspector.py` line ~290 does `store=bool(fr.get("store", True))`, reading the `store` column from `ir.model.fields` (it is in the `_IR_FIELDS` search_read projection, lines ~16-35). `FieldSchema.store` defaults to `True` (types.py line 23) — a safe fallback since Odoo only writes False for non-stored fields.
- **D-07:** The previously-noted `field_cache.py` "conflict" is a NON-issue: that CDC service (`packages/godoo/src/godoo/client/services/cdc/field_cache.py` lines ~43-44) fetches only `["name","ttype","relation","selection_ids"]` — no `store` — and is a separate, unrelated consumer. No reconciliation needed.
- **D-08:** Strategy: consume `FieldSchema.store` directly. NO supplemental `fields_get` call.
- **D-09:** SCHEM-05 verification test: assert `schema.fields["display_name"].store is False` on `res.partner` (a computed non-stored field present on every Odoo 17 instance with no module deps). This gate is self-enforcing against regressions.

### xmlid Helpers (Identity Boundary) — Namespace-Agnostic
- **D-10:** Helpers are namespace-agnostic: `write_xmlid(client, model, res_id, module, name)` and `find_by_xmlid(client, module, name)` take `module` and `name` as explicit, author-controlled args. NO synthetic `__stateman__` namespace is injected.
- **D-11:** Rationale (user-driven reframe): stateman is config-driven; the DSL author declares each resource's identity deliberately, like writing an Odoo data module. The `module` part of the xmlid belongs to the author's config namespace + slug — every record carries its own module already.
- **D-12:** The module-naming POLICY (where the module name comes from in the DSL — top-level config module vs per-resource override) is DEFERRED to Phase 2 (DSL surface). Phase 1 only needs the helpers to accept arbitrary (module, name).
- **D-13:** `write_xmlid` contract: idempotent upsert (create if absent, rewrite `res_id` if the xmlid exists). Exact return type (frozen `XmlIdRecord` dataclass vs plain int) is left to PLANNING.
- **D-14:** `find_by_xmlid`: absence is NOT an error (it means a CREATE action downstream) — return None/optional; do not raise. (Contrast godoo-py `client.ref()`, which raises `OdooMissingError`.)
- **D-15:** godoo-py primitives confirmed (all async) on `OdooClient` (client.py): `create`, `write`, `search_read`, `ref`. Error hierarchy: `OdooMissingError`, `OdooValidationError` subclass `OdooRpcError`. Match these conventions.

### CLI Skeleton Scope (UX-06) — snapshot Real, Four Stubbed
- **D-16:** Five commands registered: `plan`, `apply`, `verify`, `import`, `snapshot`. `godoo-stateman --help` exits 0 listing all five (success criterion #1).
- **D-17:** `snapshot` is FUNCTIONAL in Phase 1: introspects a live Odoo 17 and persists a versioned snapshot. Not scope creep — success criteria #2/#3 are essentially snapshot's job, and it closes the registry feedback loop with a real testcontainers acceptance test in Phase 1.
- **D-18:** `plan`/`apply`/`verify`/`import` are STUBS: print a Rich message naming the target phase, then `raise typer.Exit(code=1)`. Do NOT use exit code 2 for stubs (Phase 3 reserves exit 2 on `plan` for "changes pending").
- **D-19:** Async pattern: each command is a thin synchronous wrapper calling `asyncio.run(_impl(...))`; all logic lives in an `async def _impl`. Do NOT use `async-typer` (banned/unmaintained) or add `anyio`. `_impl` coroutines are unit-testable directly via pytest-asyncio.

### Claude's Discretion
Typer, Pydantic v2, NetworkX, Rich, hatchling, and uv are locked by the CLAUDE.md tech-stack table — no user decisions needed here.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Planning
- `.planning/ROADMAP.md` — Phase 1 section: goal, 5 success criteria, requirements (SCHEM-01..05, UX-06, PKG-04, PKG-05).
- `.planning/REQUIREMENTS.md` — full requirement definitions.
- `CLAUDE.md` (project root) — locked tech-stack table + godoo-py gap analysis.

### godoo-py — Introspection Layer
- `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\introspector.py` — `Introspector`, `get_schema`, `_IR_FIELDS` projection (~lines 16-35), store population (~line 290). MUST read before writing any schema code (SCHEM-05).
- `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\types.py` — `FieldSchema` (store default at line 23), `ModelSchema`.

### godoo-py — Client Layer
- `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\client.py` — `OdooClient` async primitives + error hierarchy; xmlid helper API must match these signatures.
- `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\services\cdc\field_cache.py` (~lines 43-44) — confirms the store-flag "conflict" is a non-issue (separate consumer, no store column).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- godoo-py `Introspector`: consume directly for schema discovery — no reimplementation needed.
- godoo-py `OdooClient`: use `create`, `write`, `search_read`, `ref` for all jsonrpc including xmlid helpers.
- `godoo-testcontainers` 0.2.0: powers the Phase 1 `snapshot` acceptance test against a real Odoo 17 container.

### Established Patterns
- godoo-py error hierarchy (`OdooMissingError`, `OdooValidationError` subclass `OdooRpcError`): stateman must match these conventions in xmlid helpers.
- All godoo-py client primitives are async: stateman follows the same pattern (`async def _impl`, synchronous Typer wrapper via `asyncio.run`).

### Integration Points
- godoo-py is a local uv workspace sibling at `C:\dev\godoo-dev\godoo-py` — use the workspace path in dev.
- Stateman fills ONLY the documented gaps: xmlid write/find helpers, and the versioned snapshot-to-disk persistence layer.
- New dependency introduced this phase: `platformdirs` (cache dir resolution).

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

- Configurable schema-snapshot location (`--schema-dir` flag / env var) — v1.1.
- DSL module-naming policy (how config authors namespace resource xmlids) — Phase 2 (DSL surface).

</deferred>

---

*Phase: 1-Bootstrap + Schema Registry*
*Context gathered: 2026-05-23*
