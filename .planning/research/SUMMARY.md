# Project Research Summary

**Project:** godoo-stateman
**Domain:** Declarative IaC state manager for Odoo ERP (jsonrpc-only, no sidecar state)
**Researched:** 2026-05-23
**Confidence:** HIGH

## Executive Summary

godoo-stateman is a "Terraform for Odoo" CLI: a Python tool that evaluates a declarative `.py` DSL, diffs desired state against live Odoo data via jsonrpc, and applies a dependency-ordered reconciliation plan. The identity model uses Odoo's own `ir.model.data` xmlid mechanism -- no external state file, no S3 bucket. Two machines applying the same config against the same Odoo converge to identical state automatically. This constraint is load-bearing and must never be relaxed.

The recommended approach is a clean reimplementation in Python 3.14, built on the locked godoo-py dependency family (godoo-client 0.2.0, godoo-introspection 0.2.0, godoo-testcontainers 0.2.0) that covers roughly 90% of the required jsonrpc surface. The remaining 10% -- specifically `write_xmlid` (creating/updating `ir.model.data` records to claim ownership) and the versioned schema-snapshot-to-disk layer -- must be built inside stateman itself. The build order is capability-oriented, not stage-by-stage: schema registry first, then the pure-Python DSL pipeline, then the first live Odoo calls at the diff/plan seam, then apply, then module ops as the highest-risk capability last.

Key risks are concrete and well-understood from the Go v1 post-mortem. Three are non-negotiable from day one: the `store` flag must be in every schema snapshot (BUG-07-B); the `GlobalLiveState` address-to-remote_id registry must be mutable and updated after every create step (v1 m2m gap); and all Odoo `False` returns for unset fields must be normalized to a canonical sentinel before diffing (false-diff risk). A fourth risk is protocol-level: `/jsonrpc` is deprecated as of Odoo 19 with removal scheduled for Odoo 22 (~2028), so the version seam in the schema registry must be designed now to accommodate a future transport migration.

## Key Findings

### Recommended Stack

godoo-py is a uv workspace monorepo requiring **Python >= 3.14** -- this is a hard floor for stateman with no negotiation. The four godoo-py packages are source-verified at version 0.2.0 and cover async CRUD, schema introspection, safety guards, module management, and a Docker-based test harness. On top of godoo-py, the recommended additions are: **Typer 0.25.1** for the CLI (type-hint-driven, Click-based, stable) with an `asyncio.run()` wrapper in every command function (Typer does not natively run async); **Pydantic v2** frozen models for immutable pipeline tokens; **NetworkX 3.6.1** for the dependency DAG; and **Rich 15.0.0** for plan output and diff rendering. Packaging follows godoo-py exactly: hatchling build backend, uv workspace, `pyproject.toml` with `requires-python = ">=3.14"`.

**Core technologies:**
- Python 3.14: hard constraint from godoo-py
- godoo-client 0.2.0: async jsonrpc transport, CRUD, safety guard, module manager
- godoo-introspection 0.2.0: `Introspector` providing `ModelSchema`/`FieldSchema` including `store` flag
- godoo-testcontainers 0.2.0: Docker-based Odoo + Postgres harness for VAL-01/VAL-02
- Typer 0.25.1 + `asyncio.run()` wrapper: CLI framework (do not use async-typer or argparse)
- Pydantic v2 frozen models: immutable pipeline tokens at all inter-stage boundaries
- NetworkX 3.6.1 DiGraph: DAG build, cycle detection, topological sort
- Rich 15.0.0: plan tables, unified diff rendering, progress bars
- `exec()` with restricted builtins: DSL evaluation (not RestrictedPython -- breaks walrus operators)

**godoo-py gaps stateman must fill itself:**
- `write_xmlid(model, res_id, module, name)` -- create/write against `ir.model.data`; via `client.create("ir.model.data", {...})`
- `find_by_xmlid(module, name)` -- via `client.search_read("ir.model.data", [...])`
- Versioned schema-snapshot-to-disk layer -- `Introspector` caches per-session only; stateman owns the `OdooVersion`-keyed persistent snapshot format

### Expected Features

**Must have (table stakes -- VAL-01 and VAL-02 gates):**
- `plan` -- human-readable diff, exit 0 (no changes) / exit 2 (changes pending), no Odoo mutation
- `apply` -- dependency-ordered sequential execution, stop-on-first-failure, progress reporting, confirmation prompt, `--auto-approve` flag
- `verify` -- post-apply re-plan on touched resources; standalone drift check
- `import` -- adopt existing record by model+ID; writes xmlid explicitly (SAFE-03: never silent adoption)
- `snapshot` -- export managed records to versioned JSON artifact; restore from artifact
- Python DSL: `resource.<type>(slug)`, `data.<type>()`, `with` blocks, `mail.config` sugar
- `resolve()` escape hatch -- required by VAL-02 server-action config pattern; needs its own design spike
- Dependency DAG with cycle detection (NetworkX)
- `delete_behavior: delete | archive | reject` per resource (`reject` as safe default)
- Schema snapshot with `store` flag, archivability, explicit Odoo-version dimension from day one
- SAFE-03: plan/apply never silently adopt unmanaged records
- Odoo-aware field normalization: many2one, many2many tuple commands, system-field exclusion, `False`-to-`None`
- Cross-apply m2m remote-id resolver via `GlobalLiveState` (v1 gap fix)
- Translation diff and apply (required by VAL-02)

**Should have (v1.x after validation):**
- `build` -> lockfile artifact (serialized plan to committable JSON; `apply --from-lockfile`) -- P2; defer until first CI/CD integration request
- Broader standalone drift scan in `verify` (`--all-managed` flag)
- walrus-operator convention documented with real examples

**Defer to v2+:**
- Multi-version schema registry (Odoo 16, 17 EE, 18) -- defer until community demand
- EXEC-02 (whole-plan DB transaction) -- not achievable over jsonrpc; do not re-litigate

**Anti-features (explicitly not built):**
- `--target slug` (targeted partial apply) -- dependency graph makes this semantically ambiguous; anti-feature
- Automatic rollback -- impossible over jsonrpc
- Silent adoption of unmanaged records -- violates SAFE-03
- OpenTofu/Terraform provider surface -- PROV-01..03 locked dead
- Sidecar state file -- breaks two-machine convergence

### Architecture Approach

The architecture is a 7-stage pure-function pipeline: `dsl/eval` (pure Python, no Odoo calls) -> `normalize` (schema-aware canonicalization) -> `graph` (DAG + cycle detection) -> `diff` (desired vs. live) -> `plan` (read seam fires here: data-source `search_read`, `GlobalLiveState` populated) -> `apply` (sequential executor, `GlobalLiveState` written after each create) -> `verify` (post-apply re-plan). Each stage is an `async def stage(input: StageInput) -> StageOutput` function receiving immutable Pydantic frozen model inputs. The one explicitly mutable object is `GlobalLiveState` (address-to-remote_id registry), passed explicitly to `apply()` and read by the per-step relation encoder. This is the architectural fix for both v1 m2m gaps (m2m-to-data-source was structurally blocked; cross-apply m2m did not consult global live state).

**Major components:**
1. `dsl/` -- pure config evaluation; `EvalContext` collects `ResourceNode` + `DataSourceNode`; zero Odoo calls
2. `schema/` -- `SchemaRegistry` wraps godoo-py `Introspector`; adds `OdooVersion` seam; serializes to/from JSON snapshot
3. `engine/` -- 7 pipeline stages as pure async functions: normalize, graph, diff, plan, apply, verify
4. `live_state.py` -- `GlobalLiveState`: mutable address-to-remote_id registry; only writer is `apply.py`
5. `types/` -- shared Pydantic vocabulary for all pipeline stages
6. `cli/` -- Typer entry points; `asyncio.run()` bridge; Rich rendering

### Critical Pitfalls

1. **`store` flag missing from schema snapshot (BUG-07-B)** -- computed non-stored fields cannot be written via jsonrpc; without `store`, the normalizer cannot exclude them. Fix: request `store` in every `fields_get` call from day one; filter `store=False AND compute set AND no inverse` from write plans. Mandatory -- no "fix later."

2. **`False` vs. `None` in normalize pass** -- Odoo returns Python `False` for all unset scalar fields over jsonrpc (12+ year convention). Without normalization, a DSL field left `None` always diffs against Odoo's `False`, breaking idempotency on every run. Fix: normalize stage converts `False` -> `None` (scalars) and `False` -> `[]` (m2m/o2m) before any comparison.

3. **m2m write format: tuple command protocol** -- reading a Many2many returns flat `[id1, id2]`; writing requires `(6, 0, [ids])` command tuples. Passing the flat list to `write()` raises a validation error. Fix: dedicated relation-command encoder in apply layer; never pass plan values to `write()` without encoding.

4. **Cross-apply m2m remote-ID resolution (v1 structural gap)** -- when resource B's m2m field references resource A created in the same apply run, B needs A's new remote integer ID. Go v1 did not consult a global registry; B silently wrote an empty set. Fix: `GlobalLiveState.register(address, remote_id)` called after every successful create before the next step executes.

5. **Module install/upgrade is non-atomic and long-running** -- can leave `ir.module.module.state` as `to install` on failure. Fix: use godoo-py `ModuleManager` (has `ir_cron` retry); place module steps as highest-risk tier in the DAG; thread cancellation through all module operations.

## Implications for Roadmap

Based on research, the build order is capability-oriented (end-to-end slices) rather than stage-by-stage ports. Each phase is independently testable and delivers observable value.

### Phase 1: Foundation -- Schema Registry + Types
**Rationale:** Everything downstream depends on schema correctness. The `store` flag must be in the schema spec before any field introspection code ships -- retrofitting it is BUG-07-B. Zero Odoo traffic in this phase means fast iteration.
**Delivers:** `types/` (all Pydantic models), `schema/SchemaRegistry` with `OdooVersion` seam, JSON snapshot format with version field, godoo-py integration verified. `SchemaRegistry.get("project.project")` returns correct `VersionedModelSchema` with `store` populated for every field. `write_xmlid` and `find_by_xmlid` helpers implemented.
**Addresses:** Schema introspection (SCHEM), Odoo-version dimension, `store` flag spec (BUG-07-B), xmlid write gap
**Avoids:** BUG-07-B (Pitfall 5), schema snapshot staleness (Pitfall 8)
**Research flag:** Standard patterns -- godoo-py source is authoritative. VERIFY FIRST: the `store` flag conflict (see Gaps section) must be resolved before writing any schema code.

### Phase 2: DSL + Pure Pipeline (no Odoo)
**Rationale:** DSL evaluation and the normalize/graph stages are pure Python with no Odoo dependency. Full unit-test coverage achievable without Docker. Establishing the pipeline shape before live Odoo calls makes integration much cleaner.
**Delivers:** `dsl/` (eval, context, helpers including `resolve()` design spike finalized), `engine/normalize.py`, `engine/graph.py`. Unit tests for all three.
**Addresses:** Python DSL (RSRC), dependency DAG + cycle detection (REL), field normalization including `False`-to-`None` (CORE)
**Avoids:** False/None pitfall (Pitfall 2 -- unit-tested here), Odoo calls in DSL eval (anti-pattern)
**Research flag:** `resolve()` escape hatch needs its own design spike -- semantics not fully specified; correctness implications for the read seam. Do not defer to implementation.

### Phase 3: Diff + Plan (first live Odoo calls)
**Rationale:** `diff.py` and `plan.py` are the first stages that touch Odoo. The read seam fires in `plan.py` -- `GlobalLiveState` is first populated here for data-source addresses, fixing the v1 m2m-to-data-source structural block. `import` command bundled here because it is a prerequisite for SAFE-03 correctness in plan output.
**Delivers:** `LiveState` fetch (xmlid lookup via `ir.model.data`), `engine/diff.py`, `engine/plan.py` (read-seam resolution + data-source `GlobalLiveState` population). `plan` command works end-to-end against real Odoo. `import` command (SAFE-03 guard in plan output).
**Addresses:** Diff/plan pipeline (CORE), data-source read seam (REL), SAFE-03 no-silent-adoption (SAFE), `import` CLI (IDENT)
**Avoids:** Silent adoption (Pitfall 6), N+1 LiveState reads (batch `search_read` per model)
**Research flag:** Standard patterns -- well-documented in TS reference and PROJECT.md

### Phase 4: Apply (MVP apply, no module ops)
**Rationale:** The `GlobalLiveState` address-to-remote_id registry is the structural fix for both v1 m2m gaps. Implementing apply without module ops (highest-risk, non-atomic) allows VAL-01 (projects + stages lifecycle) to pass and validates the full pipeline before introducing the riskiest capability.
**Delivers:** `engine/apply.py` with `GlobalLiveState` (mutable, written after each create), relation-command encoder (m2m tuple protocol `(6, 0, [ids])`), sequential executor for Create/Update/NoOp/Delete/Archive/Reject (no module install/upgrade), stop-on-first-failure + partial progress reporting. VAL-01 acceptance tests pass.
**Addresses:** Cross-apply m2m remote-id resolver (REL -- v1 gap fix), delete_behavior (SAFE), apply progress (UX), idempotency gate
**Avoids:** Cross-apply m2m gap (Pitfall 7), m2m tuple protocol error (Pitfall 3), atomicity illusion (Pitfall 1)
**Research flag:** Standard patterns -- apply loop fully specified in ARCHITECTURE.md and SEED.md

### Phase 5: Module Ops + Verify + Full VAL-02
**Rationale:** Module install/upgrade is the highest-risk capability class: non-atomic, long-running, can leave Odoo partially-migrated. Saving it for last means the rest of the pipeline is proven before this is introduced.
**Delivers:** Module install/upgrade via godoo-py `ModuleManager` (with `ir_cron` retry, cancellation threading), `engine/verify.py` (always re-fetches LiveState from Odoo), `snapshot` command (export/restore versioned JSON), translation diff + apply (required by VAL-02). VAL-02 acceptance tests pass.
**Addresses:** Module ops (RSRC), verify drift detection (CORE), snapshot export/restore, translation (CORE)
**Avoids:** Module partial-failure (Pitfall 4), cached-LiveState verify (UX pitfall), archiving side-effects (`project.task.type.active` ORM side-effect tested)
**Research flag:** Module ops cancellation threading -- verify `ModuleManager` source behavior under `CancelledError` before designing the cancellation contract

### Phase Ordering Rationale

- Phases 1-2 produce zero Odoo traffic; fast pure-Python iteration with full unit-test coverage before any Docker dependency
- Phase 3 introduces testcontainers for the first time; `import` command bundled here as a SAFE-03 prerequisite
- Phase 4 delivers the first working `apply`; VAL-01 is the gate; module ops excluded to isolate highest-risk capability
- Phase 5 is highest-risk; module ops saved for last so the proven pipeline contains the blast radius
- `build` -> lockfile artifact is P2 and entirely deferred; lockfile must NOT include resolved remote IDs (machine- and state-dependent)
- `--target` is an anti-feature and must not appear in any phase

### Research Flags

Phases needing deeper research or design work during planning:
- **Phase 2:** `resolve()` escape hatch design spike -- semantics not fully specified; correctness implications for the read seam
- **Phase 5:** Module ops cancellation threading -- verify `ModuleManager` source under `CancelledError` before designing the contract

Phases with standard patterns (skip additional research):
- **Phase 1:** godoo-py source authoritative; schema types fully specified (after resolving `store` conflict)
- **Phase 3:** Diff/plan patterns well-documented in TS reference and PROJECT.md
- **Phase 4:** Apply loop contract fully specified in ARCHITECTURE.md

### Verify-First Item (Conflict -- Do Not Assume)

**CONFLICT -- `store` flag in godoo-py Introspector:**
- ARCHITECTURE.md (source: `godoo-py/.../introspection/types.py`) states `FieldSchema` already includes `store: bool` and cites this as BUG-07-B satisfied.
- PITFALLS.md (source: `godoo-py/.../client/field_cache.py`) states `field_cache.py` does NOT capture the `store` flag and identifies this as the gap stateman must fix.

These may refer to different code paths: `types.py` may declare the field while `field_cache.py` may not request the `store` attribute in its `fields_get` call. **Before Phase 1 implementation, verify:** (a) does `Introspector.get_schema()` actually populate `store` on the returned `FieldSchema`? (b) which `fields_get` attributes does the fetcher request? Read `introspector.py` and `field_cache.py` source directly. Do not rely on either research file alone.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All library versions PyPI-verified; godoo-py API surface source-verified; async bridge confirmed via GitHub issues |
| Features | HIGH | First-party TS reference code read directly; v1 post-mortem (SEED.md) authoritative for gaps; Terraform/Pulumi UX verified |
| Architecture | HIGH | godoo-py source read directly; pipeline matches TS reference; NetworkX and Pydantic patterns standard |
| Pitfalls | HIGH | Odoo 17 CE source verified for project models; v1 post-mortem primary source; jsonrpc deprecation from Odoo 19 docs |

**Overall confidence:** HIGH

### Gaps to Address

- **`resolve()` semantics:** Required (VAL-02) but precise semantics are not fully specified. Phase 2 is the design spike. Do not defer to implementation.

- **`store` flag conflict:** Must be resolved by reading godoo-py source before Phase 1 schema code is written. If `store` is not populated by `Introspector.get_schema()`, stateman must issue its own `fields_get` call with `attributes=['store', 'compute', 'readonly', ...]` to supplement.

- **`build` -> lockfile format constraint:** Deferred to P2 but must NOT include resolved remote IDs (machine- and state-dependent). Record this constraint in the schema spec during Phase 1.

- **`/jsonrpc` deprecation migration path:** Deprecated Odoo 19, removal ~Odoo 22 (2028). The `OdooVersion` seam in `SchemaRegistry` is the right home for future transport migration. Document the seam contract in Phase 1.

## Sources

### Primary (HIGH confidence)
- godoo-py source (packages/godoo-client, godoo-introspection, godoo-testcontainers) -- API surface, gap analysis, `store` flag conflict
- `godoo-stateman/SEED.md` -- Go v1 hard-won lessons, requirement families, VAL-01/VAL-02 definitions
- `godoo-stateman/.planning/PROJECT.md` -- locked decisions, 7-stage pipeline spec, PROV-01..03, EXEC-02
- Odoo 17.0 CE source (`addons/project/`) -- `favorite_user_ids` confirmed, `member_ids` absent, task type `active` field confirmed writable
- Odoo 19.0 External RPC API docs -- `/jsonrpc` deprecation confirmed; JSON-2 API as successor
- PyPI: typer 0.25.1, pydantic 2.13.4, networkx 3.6.1, rich 15.0.0, testcontainers 4.14.2 -- versions verified

### Secondary (MEDIUM confidence)
- Typer GitHub issues #88, #950 -- async bridge requires `asyncio.run()` wrapper; native async not in 0.25.1
- Terraform/Pulumi CLI docs -- plan/apply/import UX conventions, exit code 2 for pending changes
- NetworkX documentation -- `find_cycle`, `topological_sort`, `topological_generations` API

### Tertiary (LOW confidence)
- Odoo forum / community -- `False` as absent-value convention over jsonrpc (community-confirmed; no official spec)
- IaC community post-mortems -- stop-on-first-failure rationale (pattern reference)

---
*Research completed: 2026-05-23*
*Ready for roadmap: yes*
