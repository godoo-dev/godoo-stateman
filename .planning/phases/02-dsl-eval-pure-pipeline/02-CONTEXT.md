# Phase 2: DSL Eval + Pure Pipeline - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Phase Boundary

The full Python DSL authoring surface is evaluable in **complete isolation** (zero Odoo
calls, zero network I/O): a `.py` config evaluates to a `DesiredState` tree, the normalize
stage produces stable canonical values, and the dependency DAG detects cycles — all fully
unit-tested without Docker.

**In scope:** DSL evaluator (`exec()` + restricted builtins), `DesiredState` container,
resource/data/inline-child constructors, `resolve()` deferred values, normalize stage,
NetworkX dependency-graph build + cycle detection, the `resolve()` design spike (SC-5).

**Out of scope (other phases):** live Odoo calls / read seam (Phase 3), diff vs live state
+ plan serialization (Phase 3), apply executor + `GlobalLiveState` resolution (Phase 4),
`delete_behavior`/SAFE behaviors (Phase 4), module ops (Phase 5), CLI plan/apply wiring
(stays stubbed), `build`→lockfile artifact (deferred to v2).
</domain>

<decisions>
## Implementation Decisions

### DSL surface & desired-state container
- **D-01:** DSL eval returns a **frozen Pydantic `DesiredState`** model — the typed
  pipeline token. Carries separate typed collections: `resources`, `data_sources`, and
  module-config sugar (`mail.config["k"]="v"` via the `odoo_module` helper). Matches the
  Phase-1 frozen-pipeline-object pattern (`VersionedSnapshot` etc.). Pure value-objects
  inside it use `@dataclass(frozen=True)`.
- **D-02 (resolves D-12 from Phase 1):** Module identity is sourced from a **top-level
  `module = "..."` declaration** per config file (required — raise a `MissingModuleError`
  at eval time if absent), **plus an optional per-resource `_module=` override** stored on
  each resource node (`ResourceNode.xmlid_module`). Default path is frictionless
  (one declaration/file); the override is the documented escape hatch for multi-namespace
  files (e.g. module-install resources needing a `base`/`mail` xmlid namespace). Two files
  declaring the same `module` collide → surfaced at the plan stage via `ir.model.data`
  ownership (SAFE-03), not silently.
- **D-03:** `resource.<model>(slug, **fields)` — positional `slug` is the identity key;
  `data.<model>(**selector)` for read-only references (never mutated by plan/apply);
  `with` blocks for scoping (RSRC-03); attribute assignment for fields. Inline-child slugs
  are **auto-prefixed with the parent slug** to form their xmlid local name.

### Deferred values — `resolve()` (the SC-5 design spike)
- **D-04:** `resolve()` returns an **eager `Deferred` thunk** at eval time; it fires **no
  computation in Phase 2**. Signature: **`resolve(fn, *refs)`**. The `*refs` (resource
  references) serve double duty: (a) they become the **dependency edges** in the DAG, and
  (b) they are exactly the resolved values fed to `fn` at the read seam (plan stage,
  Phase 3). Edges = precisely what `fn` will receive — no divergence, no magic.
- **D-05:** In Phase 2 the `Deferred` stores `fn` + a serializable `deps: frozenset[str]`
  of referenced slugs. `build_graph()` adds one directed edge per dep slug found on any
  resource's fields. **Cycle detection is a pure graph property** — `networkx.find_cycle()`
  over the slug-node `DiGraph` raises `CycleError` with the cycle path **before any Odoo
  call** (SC-4). `Deferred` must be representable inside a frozen model (store `fn` as
  `Any` with a discriminated marker; do NOT attempt to serialize the callable).
- **D-06:** `resolve()` does NOT trigger Odoo I/O during Phase 2. The spike deliverable
  (SC-5) is: these semantics documented + the eval purity invariant (SC-1) preserved +
  unit tests covering edge creation and cycle detection through `resolve()` chains.

### Inline One2many children
- **D-07:** Inline O2m children use a **`children()` wrapper in the field value**:
  `lines = children(child_model, inverse_field, [resource.child(slug, **fields), ...])`.
  This is the battle-tested pattern from the real-world TS consumer.
- **D-08:** The **`inverse_field` (the child's Many2one back-reference) is mandatory** —
  always the 3-arg form. One canonical shape; Odoo always needs the inverse m2o to scope
  children to the parent. (2-arg variant explicitly deferred — see Deferred Ideas.)
- **D-09:** Children flatten to **top-level nodes** with parent-prefixed xmlids; the DAG
  gets `parent → child` edges and children **participate in cycle detection** (REL-07,
  SC-3). The `children()` wrapper is stripped from the parent's field values during the
  flatten step.

### Normalize stage — schema source
- **D-10:** `normalize()` accepts an **optional `VersionedSnapshot`** (the Phase-1
  artifact). It reads `snapshot.models[m].fields[f].ttype` / `.relation` to drive CORE-02
  (`False`→`None` for scalars, `False`→`[]` for relations) and CORE-08 (Many2one→integer
  ID; Many2many diff order-irrelevant). `SchemaRegistry` remains the **sole gateway** for
  live field metadata; unit tests inject a fixture snapshot (pattern proven by
  `_make_minimal_snapshot()` in `tests/unit/test_schema_registry.py`) → normalize is fully
  testable offline with zero Docker. When snapshot is `None`, schema-dependent rules are
  skipped (documented code path).

### Claude's Discretion
- Exact module/class layout under `src/godoo_stateman/dsl/` (e.g. `eval.py`, `context.py`,
  `types/desired.py`), the `ChildBuilder`/flatten internals, and new error subclasses
  (`CycleError`, `DslEvalError`, `MissingModuleError` under `errors.py`) are left to the
  planner/researcher — follow Phase-1 conventions.
- Whether pure stages are sync or `async def` — must remain compatible with the established
  `asyncio.run()` Typer-bridge pattern.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` — Phase 2 section (goal, success criteria SC-1..SC-5)
- `.planning/REQUIREMENTS.md` — CORE-01, CORE-02, CORE-08, RSRC-01..07, REL-01, REL-02, REL-07
- `.planning/PROJECT.md` — 7-stage pipeline; DSL/config evaluation + dependency-graph sections
- `.planning/phases/01-bootstrap-schema-registry/01-CONTEXT.md` — D-12 (module-naming policy, resolved here as D-02) + Phase-1 locked decisions

### Phase-1 code this phase builds on
- `src/godoo_stateman/types/schema.py` — `VersionedFieldSchema` (`ttype`, `relation`, `store`), `VersionedModelSchema`
- `src/godoo_stateman/schema/snapshot.py` — `VersionedSnapshot` (load/save, version-mismatch guard) — injected into normalize (D-10)
- `src/godoo_stateman/schema/registry.py` — `SchemaRegistry.get()`, the sole live field-metadata gateway
- `src/godoo_stateman/identity.py` — `XmlIdRecord` (frozen) — the resolved-xmlid shape resources reference
- `src/godoo_stateman/errors.py` — `StatemanError` base for new Phase-2 error subclasses

No external ADRs beyond the planning docs above — DSL design decisions are captured in this CONTEXT.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `VersionedSnapshot` (`schema/snapshot.py`): serializable, version-tagged, constructible
  in-process → the offline schema source for normalize (D-10) and its unit-test fixtures.
- `VersionedFieldSchema.ttype`/`.relation`: already carry m2o/m2m/scalar discrimination +
  target model — everything normalize needs for CORE-02/CORE-08.
- `XmlIdRecord` (`identity.py`): the frozen identity shape resource nodes resolve toward.
- `StatemanError` (`errors.py`): base for `CycleError`, `DslEvalError`, `MissingModuleError`.

### Established Patterns
- `from __future__ import annotations` + `TYPE_CHECKING` guards — universal.
- Frozen Pydantic (`ConfigDict(frozen=True)`) for serializable pipeline objects;
  `@dataclass(frozen=True)` for pure value objects.
- Tests: top-level functions (no `class TestX`), `asyncio_mode = "auto"`,
  `@pytest.mark.integration` only for Docker-backed tests. `_make_minimal_snapshot()`
  fixture-injection pattern in `tests/unit/test_schema_registry.py`.
- Typer async bridge: `asyncio.run(_impl(...))` — no anyio, no async-typer.
- `exec()` with restricted `__builtins__` is the DSL evaluator (RSRC-07); RestrictedPython
  banned (walrus `:=` is a hard requirement, RSRC-05).

### Integration Points
- DSL eval output (`DesiredState`) → normalize → `build_graph()` are the three Phase-2
  stages; all pure. The downstream read seam (Phase 3) is where `Deferred.fn` fires and
  `data.<model>` resolves — Phase 2 only defines the contract/interface, never calls it.

### Real-world grounding (TS predecessor consumer — anonymized)
The only production consumer of the TypeScript predecessor informed three decisions:
its `children(model, inverseField, [...])` wrapper (→ D-07/D-08), its `resourceRef`-style
explicit deferred references (→ D-04 explicit-deps form), and its directory-of-configs
authoring model. The TS tool used a fully-qualified-string module convention with no
declaration; we chose the explicit `module=` declaration (D-02) to make the namespace
authoritative and rename-safe rather than implicit.
</code_context>

<specifics>
## Specific Ideas

- Authoring should feel like the proven real-world consumer's ergonomics: drop-in config
  files, explicit inline children with a named inverse field, explicit deferred references.
- Keep eval **pure** — purity (SC-1) is the invariant that makes the whole phase
  Docker-free testable; any design that adds I/O or live state during eval is rejected.
</specifics>

<deferred>
## Deferred Ideas

- **2-arg `children(model, [...])` variant** (no inverse field) — the TS tool occasionally
  used it where scoping wasn't needed. Deferred: start with the single canonical 3-arg
  form (D-08); revisit only if a real need appears.
- **`build` → lockfile artifact** (RSRC-v2-01) — deferred to v2 per ROADMAP.
- **Routine per-resource `_module=` usage** — the override (D-02) is an escape hatch, not
  the default path; if multi-namespace configs become common, reconsider ergonomics then.
- **Inline `resource(...)` as a Many2one field value** (TS supported colocating a m2o
  sub-resource) — not decided here; flag for the planner if it falls out of the DSL surface
  naturally, otherwise its own consideration.

### Reviewed Todos (not folded)
None — no pending todos matched this phase.
</deferred>

---

*Phase: 2-dsl-eval-pure-pipeline*
*Context gathered: 2026-05-23*
