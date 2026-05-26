# Phase 3: Diff + Plan + Import CLI - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

The `plan` command works **end-to-end against real Odoo** (the first phase making live
jsonrpc calls): it fetches live state for managed resources, diffs desired vs. live into a
per-resource action, fires the read seam (`Deferred.fn` + `data.<model>` resolution at plan
time), and renders a human-readable, deterministic, reviewable plan. The `import` command
adopts an existing Odoo record into managed state by writing an xmlid — adoption is always
an explicit operator action.

**In scope:** LiveState fetch via `ir.model.data` + `search_read`; diff stage computing
`Create | Update | NoOp | Delete | Archive | Reject`; read-seam resolution (Deferred firing,
`data.<model>` → remote ID, m2m-to-data-source); Rich plan rendering with non-TTY fallback;
`plan` exit codes (0 / 2 / 1); the `import` command; the `module=` → `xmlid_prefix=` DSL
rename.

**Out of scope (other phases):** the apply executor + `GlobalLiveState` mutation (Phase 4);
`delete_behavior` enforcement and the archivability schema-error (Phase 4 — Phase 3 only
*classifies* Delete/Archive, does not execute); module install/upgrade resources (Phase 5);
verify-as-standalone + snapshot export/restore + translation diff (Phase 5); natural-identity
/ duplicate detection of unmanaged records (explicitly rejected — see D-01); `--domain` and
batch adoption for `import` (deferred — see D-04).
</domain>

<decisions>
## Implementation Decisions

### Reject semantics & "no silent adoption" (CORE-03, SAFE-03, SC-3) — REDEFINED
- **D-01:** **Natural-identity / duplicate detection is NOT a stateman concern.** stateman is
  purely **xmlid-driven**. `find_by_xmlid(xmlid_prefix, slug)` returning `None` → `Create`.
  stateman never searches Odoo for look-alike records. If a Create duplicates something Odoo
  cares about, **Odoo's own constraints arbitrate at apply time** — not stateman at plan time.
  The unique-constraint probe and any author-declared `natural_key=` are **dropped entirely**.
  *(User decision: "If the user attempts a duplicate either Odoo rejects it on apply, or
  doesn't. It is an Odoo concern.")*
- **D-02:** `Reject` survives **only for the deterministic xmlid-collision case**: when
  `find_by_xmlid(xmlid_prefix, slug)` resolves to a record of a **different model** than the
  config declares (the xmlid namespace is already taken by something else). This is decided
  from `ir.model.data` alone — zero Odoo-record guessing. An *unmanaged* look-alike record is
  simply invisible to stateman and gets `Create`.
- **D-03:** **Adoption happens only via explicit `import`** (SAFE-03 spirit preserved). This
  redefinition **requires editing the locked requirement wording** before/at verification:
  - ROADMAP **SC-3** — replace "natural identity matches an existing unmanaged record" with
    the xmlid-collision definition (D-02).
  - REQUIREMENTS **SAFE-03** — same redefinition: Reject = xmlid namespace collision, not
    natural-key match.
  - **CORE-03** keeps `Reject` in the action enum (now backed by D-02).
  Flag for the user / planner: the verifier will fail SC-3 as currently written unless ROADMAP
  + REQUIREMENTS are updated to match D-01/D-02.

### Managed-set scoping for Delete/Archive (META-01) — SETTLED by prior decisions
- **D-04:** The "managed universe" = all `ir.model.data` rows whose `module` (the xmlid
  namespace) equals the config's declared `xmlid_prefix`. Records present in that set but
  absent from the desired-state tree → `Delete` / `Archive`. No reserved namespace, no
  slug-shape filter needed — the prefix is author-chosen and author-owned (honors Phase-1
  D-10/D-11 namespace-agnostic decision; collision worry evaporates because the author would
  never declare a prefix shared with an addon). `plan` listing all managed resources satisfies
  META-01. *(This was raised as a gray area but is fully determined by locked decisions — no
  user decision required.)*

### DSL rename: `module=` → `xmlid_prefix=` (revises Phase-2 D-02)
- **D-05:** Rename the top-level config declaration **`module = "..."` → `xmlid_prefix = "..."`**
  and the per-resource override **`_module=` → `_xmlid_prefix=`**, to kill the confusion with
  installable Odoo modules (which are *resources*, Phase 5). Semantics unchanged: it is the
  first segment of every written xmlid (`<xmlid_prefix>.<slug>` in `ir.model.data`).
  **Touches already-shipped Phase-2 code** — at minimum: `DesiredState.module`,
  `ResourceNode.xmlid_module`, the `module=`/`_module=` reads in `dsl/eval.py` &
  `dsl/context.py`, `MissingModuleError` (→ `MissingXmlidPrefixError` or keep + rename
  message), and the Phase-2 tests asserting `state.module`. Planner: fold this rename in as a
  first task so the rest of Phase 3 builds on the corrected surface.

### Plan output & diff rendering (UX-03, UX-05, SC-2)
- **D-06:** **Terraform-style flat annotated list** — per-resource line prefixed by action
  symbol (`+` Create / `~` Update / `-` Delete / `x` Reject / archive + NoOp symbols TBD by
  planner), showing slug + Odoo model; for `Update`, changed fields indented as
  `field: old → new` lines (plain lines, **not** `rich.syntax.Syntax("diff")` — unified diff
  is noisy for scalar Odoo values).
- **D-07:** `NoOp` resources are **hidden by default**, summarized as a trailing
  `N resources unchanged` line; shown only under `--verbose`.
- **D-08:** **Deterministic ordering for SC-2:** emit in **topological order** from the
  NetworkX DAG (dependencies before dependents), ties broken by **slug sort**. Running `plan`
  twice against unchanged Odoo must produce byte-identical output.
- **D-09:** **Non-TTY fallback** via Rich `Console(force_terminal=False)` (or
  `Console.is_terminal` branch) — markup stripped, output stays readable in CI logs / pipes.
  All plan output via Rich (UX-05).

### `import` command surface (IDENT-04, IDENT-05, SC-5, SAFE-03)
- **D-10:** **`--id` only, validate-then-upsert.** Signature per SC-5:
  `import --model <m> --id <n> --module <prefix> --name <slug>`. (`--module`/`--name` arg
  spellings: planner aligns with the `xmlid_prefix` rename — keep `--module`/`--name` as the
  CLI flag names per SC-5, but they map to the xmlid `module`/`name` columns.)
- **D-11:** **Flow:** (1) `search_read` the target model by `--id` to confirm the record
  **exists** before any write (catches typos pre-mutation, IaC validate-before-write); (2)
  `find_by_xmlid(prefix, name)` — if it already binds the **same** `res_id` → no-op success
  (exit 0, idempotent re-import per IDENT-05); if it binds a **different** record → **error,
  require `--force`** to rewrite (honors SAFE-03 — no silent clobber); (3) otherwise
  `write_xmlid(...)` (the existing idempotent-upsert helper).
- **D-12:** **`--domain` selector and batch adoption are DEFERRED.** IDENT-04 mentions
  "id or domain" but SC-5 only exercises `--id`; the `--domain` branch (must resolve to exactly
  one record, ambiguous-match UX) is self-contained and can be added later without touching the
  `--id` path. Single record per invocation.

### Claude's Discretion
- LiveState fetch strategy (batch-fetch all managed xmlids up front vs per-model `search_read`;
  which fields to project — desired fields vs full schema). Must be deterministic (SC-2) and
  read-only. Planner/researcher decide; follow Phase-1/2 async + `SchemaRegistry`-as-sole-gateway
  conventions.
- Module/class layout under `src/godoo_stateman/` for the diff/plan/livestate code, the
  `PlanStep`/action model shape (frozen Pydantic, matching prior phases), and new error
  subclasses (e.g. xmlid-collision error) under `errors.py`.
- Exact archive/NoOp symbols in the annotated list (D-06).
- Whether the read-seam resolution lives in a dedicated stage module or inside the plan stage.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` — Phase 3 section (goal, success criteria SC-1..SC-5). **NOTE: SC-3
  wording must be updated per D-01/D-02/D-03 before verification.**
- `.planning/REQUIREMENTS.md` — CORE-03, CORE-04, IDENT-01..05, REL-03, REL-04, SAFE-03, UX-01,
  UX-02, UX-03, UX-05, META-01. **NOTE: SAFE-03 wording must be updated per D-01/D-02/D-03.**
- `.planning/PROJECT.md` — 7-stage pipeline; diff/plan/read-seam sections; "no sidecar state"
  constraint (state lives only in `ir.model.data`).
- `.planning/phases/02-dsl-eval-pure-pipeline/02-CONTEXT.md` — D-02 (module/`xmlid_prefix`
  declaration, now renamed in D-05), D-04/D-05/D-06 (read-seam / Deferred contract that fires
  this phase), D-10 (normalize consumes `VersionedSnapshot`).
- `.planning/phases/01-bootstrap-schema-registry/01-CONTEXT.md` — D-10/D-11 (namespace-agnostic
  xmlid policy → backs D-04), D-13/D-14 (`write_xmlid` upsert, `find_by_xmlid` returns None),
  D-18 (exit code 2 reserved for plan changes-pending).

### Phase-1/2 code this phase builds on
- `src/godoo_stateman/dsl/eval.py` & `src/godoo_stateman/dsl/context.py` — read `module=` /
  `_module=` today; **rename target for D-05**.
- `src/godoo_stateman/dsl/types/desired.py` — `DesiredState` (`.module` → `.xmlid_prefix`).
- `src/godoo_stateman/dsl/types/nodes.py` — `ResourceNode` (`model`, `slug`, `fields`,
  `xmlid_module`, `parent_slug`), `DataSourceNode` (`model`, `selector`, `node_key`).
- `src/godoo_stateman/dsl/types/deferred.py` — `Deferred` (`fn` + `deps`); **fires at the read
  seam this phase** (Phase-2 D-04/D-05/D-06).
- `src/godoo_stateman/dsl/graph.py` — `build_graph()` DAG; supplies topological order for D-08.
- `src/godoo_stateman/dsl/normalize.py` — normalize stage (consumes snapshot; D-10 prior).
- `src/godoo_stateman/identity.py` — `write_xmlid` (idempotent upsert), `find_by_xmlid`
  (returns None on absence), `XmlIdRecord`. Core of `import` (D-10/D-11) and the diff's
  managed-lookup.
- `src/godoo_stateman/schema/registry.py` — `SchemaRegistry.get()`, sole live field-metadata
  gateway (needed to classify scalar vs relation for diffing + LiveState projection).
- `src/godoo_stateman/cli/commands/plan.py` & `import_.py` — current stubs to replace.
- `src/godoo_stateman/errors.py` — `StatemanError` base for new Phase-3 errors.

### godoo-py (live jsonrpc — first used this phase)
- `C:\dev\godoo-dev\godoo-py\packages\godoo\src\godoo\client\client.py` — `OdooClient` async
  primitives (`search_read`, `read`, `ref`, `create`, `write`) + error hierarchy
  (`OdooMissingError`, `OdooValidationError`/`OdooRpcError`) for LiveState fetch & import.
- `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\` —
  `Introspector` / `FieldSchema` (`ttype`, `relation`, `store`) for diff field classification.
- `C:\dev\godoo-dev\godoo-py\packages\godoo-testcontainers\` — Odoo 17 CE + Postgres harness
  for the live-Odoo acceptance tests (`@pytest.mark.integration`).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `find_by_xmlid` / `write_xmlid` (`identity.py`): the entire managed-lookup + import path —
  `find_by_xmlid` returning None *is* the Create signal (D-01); its model field detects the
  xmlid-collision Reject (D-02); `write_xmlid`'s idempotent upsert is import's write step (D-11).
- `build_graph()` (`dsl/graph.py`): already produces the dependency DAG → topological order for
  deterministic plan output (D-08).
- `Deferred` (`dsl/types/deferred.py`): `fn` + `deps` contract defined in Phase 2; this phase
  is where `fn` actually fires (the read seam) with resolved `data.<model>` IDs.
- `SchemaRegistry` + `VersionedSnapshot`: classify fields (scalar vs m2o vs m2m) for diffing and
  for choosing which fields to project in LiveState fetch.

### Established Patterns
- Async everywhere: `async def _impl` per command, synchronous Typer wrapper via
  `asyncio.run(...)` (no anyio, no async-typer). LiveState/diff stages follow suit.
- Frozen Pydantic (`ConfigDict(frozen=True)`) for serializable pipeline objects;
  `@dataclass(frozen=True)` for pure value objects — apply to the new `PlanStep`/action model.
- `from __future__ import annotations` + `TYPE_CHECKING` guards — universal.
- Tests: top-level functions (no `class TestX`), `asyncio_mode = "auto"`,
  `@pytest.mark.integration` only for Docker/live-Odoo tests; pure diff logic stays unit-testable
  offline by injecting a fixture `VersionedSnapshot` + a fake LiveState.
- Exit codes: 0 / 2 / 1 already reserved (Phase-1 D-18); stubs currently use 1.

### Integration Points
- DSL eval → normalize → `build_graph()` (Phase 2, pure) now feed into **diff** (desired vs
  fetched LiveState) → **plan render**. The read seam (`Deferred.fn`, `data.<model>` resolution)
  sits at the plan stage and is the first place live Odoo IDs enter the pipeline.
- `import` writes to `ir.model.data`; a subsequent `plan` reads it back via `find_by_xmlid`
  and treats the record as managed (IDENT-05) — the round-trip is the acceptance gate (SC-5).
- Acceptance tests run against **vanilla Odoo 17 CE base addons only** (testcontainers) — only
  base-addon models/constraints exist; design LiveState/import tests around base models.

</code_context>

<specifics>
## Specific Ideas

- Plan output should read like `terraform plan` — operator-reviewable before apply, familiar
  IaC idiom (`+`/`~`/`-`/`x`, indented field changes, hidden NoOp).
- Hard boundary the user set: **stateman does not police Odoo's uniqueness.** It manages what it
  has an xmlid for; everything else is Odoo's domain. Keep the engine purely xmlid-driven —
  any design that reintroduces natural-identity record matching is rejected.
- `xmlid_prefix` is just an author-chosen string written into `ir.model.data` — no magic, no
  reserved namespace; this keeps the managed-set definition trivial.

</specifics>

<deferred>
## Deferred Ideas

- **`import --domain` selector** (IDENT-04 "id or domain") — adopt by a search domain that must
  resolve to exactly one record. Self-contained branch; add post-Phase-3 without touching the
  `--id` path.
- **Batch `import`** (multiple records / domain returning many) — deferred; single record per
  invocation for now.
- **Optional `natural_key=` DSL declaration** — was considered for proactive duplicate
  detection and explicitly rejected (D-01) as out of stateman's remit. Recorded only so a future
  maintainer knows it was a conscious "no", not an oversight.
- **ROADMAP/REQUIREMENTS wording update (SC-3 / SAFE-03)** — required follow-up so the verifier
  matches D-01/D-02/D-03. Not a future *feature*; a documentation correction to do before this
  phase is verified.

### Reviewed Todos (not folded)
None — no pending todos matched this phase.

</deferred>

---

*Phase: 3-diff-plan-import-cli*
*Context gathered: 2026-05-26*
