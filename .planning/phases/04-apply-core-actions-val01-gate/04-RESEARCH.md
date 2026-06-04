# Phase 4: Apply (core actions) — VAL-01 gate - Research

**Researched:** 2026-06-04
**Domain:** Live Odoo mutation over jsonrpc — sequential plan execution, m2m forward-reference resolution, delete_behavior enforcement, VAL-01 acceptance against real Odoo 17/18/19 CE
**Confidence:** HIGH (transport surface, existing pipeline, and Odoo m2m protocol are all source-/doc-verified; only the VAL-01 fixture field names carry an [ASSUMED] tag pending live introspection)

## Summary

This phase converts the read-only Phase-3 pipeline into the project's first live-mutation path. The entire transport surface stateman needs (`create`, `write`, `unlink`, `search_read`, `ref`) already exists on `godoo.client.OdooClient` with exactly the signatures the SPEC assumes — all source-verified in `client.py`. There is no transport gap to fill in Phase 4: the `ir.model.data` xmlid helpers (`write_xmlid`/`find_by_xmlid`) were already built in Phase 3 (`identity.py`) and the executor reuses them. The genuine net-new work is a thin executor that walks the *already-built* `list[PlanStep]` in the *same generation/slug order render uses*, serializes field dicts to Odoo write shape (m2m → `(6, 0, [ids])`), threads new `res_id`s through a mutable `GlobalLiveState`, enforces `delete_behavior` with a schema preflight, and reports `[N/total]` progress with stop-on-first-failure semantics.

The single highest-leverage finding: **the Odoo `(6, 0, [ids])` command is a SET operation (replace the whole relation), not an additive link.** This is exactly right for a declarative tool — it makes m2m writes idempotent by construction (the second apply asserts the identical id-set, producing no DB change), directly serving the CORE-06 idempotency invariant. Forward references resolve because `GlobalLiveState` is updated with each create's new int id *before* the next step runs; the m2m serializer just looks up `slug → int` at write time.

VAL-01's only structural friction is that vanilla Odoo CE containers do not ship the `project` module. The `godoo-testcontainers` `TestHarness` already accepts `modules=["project"]` at construction (install happens at container start and is snapshot-cached), so the cleanest path is a Phase-4-local session fixture that requests the module — no author-facing module surface, exactly as the SPEC scopes it.

**Primary recommendation:** Build a single `apply/` subpackage (`executor.py` + `serialize.py` + `state.py` for `GlobalLiveState`), reuse the `plan.py` pipeline verbatim to produce `list[PlanStep]`, drive execution off `nx.topological_generations(graph)` with the existing Creates→Updates→Deletes/Archives, slug-sorted ordering, and use `(6, 0, [ids])` for every m2m write. Do not invent any new transport — every Odoo call is an existing `OdooClient` method.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Plan-step execution loop | stateman executor (`apply/executor.py`) | — | Pure orchestration over pre-built `PlanStep` list; owns ordering, progress, stop-on-failure |
| Field → Odoo write-shape conversion | stateman serializer (`apply/serialize.py`) | — | m2m `(6,0,[ids])` + scalar mapping; isolated so it is unit-testable without Odoo |
| Forward-reference id resolution | stateman `GlobalLiveState` (`apply/state.py`) | — | Mutable `dict[str,int]`; the executor's only state across steps |
| Actual create/write/unlink RPC | `godoo.client.OdooClient` | Odoo server | Transport boundary — never reimplemented; safety guard lives here |
| xmlid bind/read (`ir.model.data`) | stateman `identity.py` (Phase 3) | `OdooClient` | Already built; executor calls `write_xmlid` after each create |
| Archivability decision | stateman `SchemaRegistry` (Phase 1) | `OdooClient.fields_get` | `registry.get(model).archivable` flag is the SAFE-02 gate |
| Module install for VAL-01 | `godoo-testcontainers` `TestHarness` / `ModuleManager` | Odoo server | Test-harness-only; NOT an author surface (SPEC out-of-scope #2) |
| Confirmation prompt / exit codes | stateman CLI (`cli/commands/apply.py`) | Typer | UX tier; wraps the async executor via `asyncio.run()` |

## Standard Stack

No new runtime dependencies. Phase 4 is built entirely from already-locked stack members (Typer, Pydantic v2, NetworkX, Rich, `godoo-client`) plus existing stateman modules. Per CLAUDE.md, the stack is locked; this phase adds *zero* packages.

### Core (all already present — verified in `pyproject.toml` lineage via Phase 1–3)
| Library | Version | Purpose in Phase 4 | Why Standard |
|---------|---------|--------------------|--------------|
| `godoo-client` | 0.2.0 | `create`/`write`/`unlink`/`search_read` — every Odoo mutation | Locked transport dependency; signatures source-verified below |
| NetworkX | 3.6.1 | `nx.topological_generations(graph)` drives execution order | Same DAG used by `render_plan`; no second ordering algorithm |
| Pydantic v2 | 2.13.4 | `PlanStep` extension (D-03), new `ResourceOptions` model | Frozen models already the project convention |
| Rich | 15.0.0 | `[N/total]` per-step transcript + summary | UX-05 mandates Rich; one-line-per-step is sufficient (no spinner) |
| Typer | 0.25.1 | `apply` command, `--auto-approve`/`--verbose` flags, exit codes | Existing CLI framework; `asyncio.run()` bridge pattern established |

### Supporting (test-only)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `godoo-testcontainers` | 0.2.0 | VAL-01 real-Odoo harness; `modules=["project"]` install | Acceptance subtests only |
| pytest / pytest-asyncio | >=8 / >=0.24 | `@pytest.mark.integration` suite | `asyncio_mode="auto"` already configured |

**Installation:** None. No `npm install` / `uv add` step in this phase. (Stack locked per CLAUDE.md.)

## Package Legitimacy Audit

> Not applicable — Phase 4 installs **zero** new packages. All libraries used are pre-existing locked dependencies verified in Phases 1–3. No registry lookup, no slopcheck run required because no install occurs.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none) | — | No new packages added in Phase 4 |

## godoo-client Transport Surface (source-verified)

Read directly from `C:/dev/godoo-dev/godoo-py/packages/godoo-client/src/godoo/client/client.py` (NOT docs).

| Method | Signature (dict/str path) | Returns | Notes for the executor |
|--------|---------------------------|---------|------------------------|
| `create` | `create(model: str, values: dict) -> int` (also `list[dict] -> list[int]`) | new `res_id` (int) | `[CITED: client.py:519-551]` Single-dict path returns a bare int — register this in `GlobalLiveState`. |
| `write` | `write(model: str, ids: int\|list[int], values: dict) -> bool` | `True` | `[CITED: client.py:553-589]` `ids` may be a bare int (coerced to `[ids]`). Use for UPDATE and for archive (`{"active": False}`). |
| `unlink` | `unlink(model: str, ids: int\|list[int]) -> bool` | `True` | `[CITED: client.py:591-594]` Hard delete for `delete_behavior="delete"`. |
| `search_read` | `search_read(model, domain=None, *, fields=None, limit=None, order=None) -> list[dict]` | rows | `[CITED: client.py:347-392]` Used by VAL-01 assertions to read back m2m membership. |
| `ref` | `ref(xml_id: str) -> int` | `res_id` | `[CITED: client.py:466-483]` Confirms `ir.model.data` field names: queries `("module","="…),("name","="…)`, reads `res_id`. |
| `fields_get` | `fields_get(model, attributes=None) -> dict` | field meta | `[CITED: client.py:459-464]` Used transitively via `SchemaRegistry`. |

**Client lifecycle:** `async with OdooClient(OdooClientConfig(url, database, username, password)) as client:` — `__aenter__` authenticates, `__aexit__` closes the transport `[CITED: client.py:658-681]`. The Phase-3 `plan.py` already uses this exact pattern; apply mirrors it.

**Safety guard:** `OdooClient._guard` blocks non-READ ops only when a `SafetyContext` is set `[CITED: client.py:159-171]`. The testcontainers client is constructed *without* a safety context `[CITED: container.py:233, no set_safety call]`, so VAL-01 writes are not blocked. The production `apply` client (built like `plan.py`'s) likewise sets none — stateman's own SAFE-04 prompt is the safety surface, not the client guard.

### Error surface the executor must catch

From `godoo/client/errors.py` `[CITED: errors.py]`:

| Exception | Class chain | When |
|-----------|-------------|------|
| `OdooValidationError` | `OdooRpcError → OdooError → Exception` | ValidationError/UserError from Odoo (bad field, constraint) |
| `OdooMissingError` | `OdooRpcError` | record vanished mid-run |
| `OdooAccessError` | `OdooRpcError` | ACL violation |
| `OdooRpcError` | `OdooError` | generic RPC fault — has `.human_message`, `.model_name`, `.field_name`, `.constraint_name` |
| `OdooNetworkError` / `OdooTimeoutError` | `OdooRpcError` | transport failure |
| `OdooSafetyError` | `OdooError` (NOT RPC) | local guard (won't fire here, but catch defensively) |

**Executor contract:** catch the broad base. The SPEC R9 says "any exception from `client.create`/`write`/`unlink`" triggers stop-on-first-failure. Wrap each step in `try/except Exception` and re-raise as `ApplyStepError(slug=…, action=…, cause=exc)` after recording status, so the summary can render `exc.human_message` (use `str(exc)` which returns `human_message or args[0]` `[CITED: errors.py:93-94]`).

## Many2many Write Protocol (Odoo-doc-verified)

`[CITED: odoo.com/documentation/17.0|18.0|19.0/developer/reference/backend/orm.html]` — the command tuples are identical across Odoo 17/18/19:

| Tuple | Meaning | Used in Phase 4? |
|-------|---------|------------------|
| `(6, 0, [ids])` | **SET** — replace the entire relation with exactly `[ids]` | **YES — the only m2m command stateman emits** |
| `(4, id, 0)` | link (additive) | No — additive is non-declarative |
| `(3, id, 0)` | unlink (keep record) | No |
| `(0, 0, {vals})` / `(1, id, {vals})` | inline create/update (o2m) | **No — explicitly out of scope (SPEC #8, CONTEXT deferred)** |
| `(5, 0, 0)` | clear all | No |

**Why `(6, 0, [ids])` is the correct and only choice:** it is *idempotent and absolute*. A declarative tool asserts the desired full set; re-applying the identical set yields no DB change → directly satisfies CORE-06. Additive `(4,…)` would drift (re-apply re-links, and never removes). The middle element is ignored for command 6; always pass `0`.

**Serialization seam (R4):** `apply/serialize.py` converts a normalized field dict → Odoo write payload at exactly one place (the boundary before `client.create`/`client.write`). The executor never inlines the tuple. The serializer needs the field *type* to know which fields are m2m — get it from the `VersionedModelSchema` (`snapshot.models[model].fields[name].ttype == "many2many"`). Scalar mapping (Claude's-discretion D in CONTEXT): m2o → pass-through int, char/text → str, boolean → bool, m2m → `[(6, 0, [int_ids])]`. Empty m2m → `[(6, 0, [])]` (clears).

> **`[ASSUMED]` A1 — boolean/scalar pass-through shape.** The exact non-m2m serialization (whether m2o needs unwrapping, how `False`/`None` map on write) is Claude's-discretion per CONTEXT and must be pinned during planning against a live create/write round-trip. Diff already normalizes m2o to int and m2m order-insensitively (CORE-08), so the desired-side values reaching the serializer are already int/int-list — pass-through is the working hypothesis.

## GlobalLiveState — forward-reference threading (REL-05)

**Shape (locked, CONTEXT D-02):** `dict[str, int]` keyed by `ResourceNode.slug`. Build at apply start, seed from BOTH:
1. Initial `LiveState.managed` — every managed slug's existing `res_id` (`XmlIdRecord.res_id`).
2. Data-source/seam-resolved record ids (`seam_result`, keyed by `node_key`).

Then after each successful CREATE step, register `global_live_state[slug] = new_res_id` **before** the next step executes `[CITED: SPEC R3]`. The m2m serializer resolves each referenced slug → int via this one uniform map, regardless of whether the target is pre-existing-managed, data-sourced, or freshly created this run.

**Critical ordering invariant:** because the executor walks `nx.topological_generations` and within a generation does Creates→Updates→Deletes, a CREATE that another CREATE depends on must be in an *earlier* generation. The DAG already encodes this (Phase 2 `build_graph` adds edges for direct field refs with `.slug`). The CONTEXT D-01 fixture (`project.task.type.project_ids → project.project`) deliberately places the m2m target in a position where its id is registered before the referencing write — VERIFY the edge exists by asserting the project resource lands in an earlier-or-equal generation and is created first.

**`LiveState` is the read-only foundation** `[CITED: livestate.py:31-45]` (frozen dataclass). `GlobalLiveState` is a *separate mutable object* the executor owns — do not mutate the frozen `LiveState`.

## delete_behavior Enforcement (SAFE-01, SAFE-02)

`delete_behavior: Literal["delete","archive","reject"]`, default `"reject"`, carried on the frozen `PlanStep` (CONTEXT D-03). Enforcement at apply time `[CITED: SPEC R6, R13]`:

| Value | Action | Preflight |
|-------|--------|-----------|
| `delete` | `client.unlink(model, [res_id])` | none |
| `archive` | `client.write(model, [res_id], {"active": False})` | **`registry.get(model).archivable` MUST be True first** |
| `reject` | raise `DeleteRejectedError(slug)` — no Odoo call | n/a |

**Archivability gate (SC-5 / SAFE-02):** `SchemaRegistry.get(model).archivable` is already computed `[CITED: registry.py:50-52]` as `active_field is not None and bool(active_field.store)`. The executor calls this **before any Odoo mutation for the archive step**; if False, raise `ArchiveNotSupportedError(model, slug)` with zero RPC issued. The registry caches in-memory, so the check is free for models already snapshotted. The plan pipeline already extends the snapshot to cover managed-but-absent models `[CITED: plan.py step 9a]` — so the archive candidate's model is guaranteed present in the snapshot the executor receives.

> **Note for planner:** `diff()` already classifies ARCHIVE vs DELETE using the same `archivable` flag `[CITED: diff.py:26-27]`. So a step arriving with `action=ARCHIVE` was already judged archivable at plan time. The R13 preflight is therefore a *defense-in-depth re-check at apply time* (the snapshot could be stale, or `delete_behavior="archive"` could be declared on a model diff classified as DELETE). Implement it as a genuine re-check, not a redundant no-op — that is the whole point of SC-5.

## Sequential Execution + Partial Progress (CORE-05, REL-08, SAFE-05, UX-04)

**Order (locked, Phase 3 D-08):** iterate `nx.topological_generations(graph)`; within each generation, order steps Creates→Updates→Deletes/Archives, slug-sorted within each action class. This is the *identical* order `render_plan` already emits `[CITED: render.py:92-93]` — reuse the traversal, do not invent a parallel one. Delete/Archive/Reject steps have no graph node (managed-but-absent) `[CITED: render.py:88-90]`; append them after the graph walk, slug-sorted (matching how `diff()` already orders them `[CITED: diff.py:55-58]`).

**Stop-on-first-failure (R9):**
1. On any step exception → stop immediately.
2. Failing step → status `error`.
3. All remaining steps (in execution order) → status `skipped`.
4. Emit summary: committed steps (with remote ids), the error step (with `str(exc)`), skipped steps.
5. Exit non-zero per R12.

**No rollback** — structurally impossible over jsonrpc (each `execute_kw` is its own committed SQL transaction). This is a locked protocol fact `[CITED: REQUIREMENTS.md Out of Scope]`. The partial-progress report IS the recovery surface.

**Progress (R10/UX-04):** `[N/total] <action> <model> <slug> … <status>` per step via Rich `Console`, `status ∈ {ok, error, skipped}`. One line per step; non-tty falls back (Rich strips ANSI automatically when `force_terminal=False` `[CITED: render.py D-09 note]`).

**Exit-code contract (R12):**
| Code | Meaning |
|------|---------|
| 0 | all `ok` (incl. all-NoOp short-circuit) |
| 1 | internal/CLI error (config not found, env missing, eval error, cycle) |
| 3 | partial failure: ≥1 committed `ok`, then a later step errored |
| 4 | first/sole step errored; no commits |
| 5 | user declined SAFE-04 prompt |

## Idempotency (CORE-06)

A second apply of unchanged config against unchanged Odoo MUST yield an all-NoOp plan and issue zero `create`/`write`/`unlink` calls `[CITED: SPEC R7]`. This is *inherited*, not newly built: the Phase-3 `diff()` already produces NoOp for matched records, and apply simply skips NoOp steps. The executor's only idempotency obligation is **do not mutate on NoOp** — never issue a write for a `NoOp` or `REJECT` step. The `(6, 0, [ids])` SET semantics guarantee that even an erroneously-issued m2m write of the identical set is a DB no-op, but the correct design issues no call at all for NoOp.

**Apply must NOT:** call `diff()` itself in a way that re-reads — it reuses the pre-built `list[PlanStep]` from the shared pipeline `[CITED: CONTEXT code_context]`. It also must not re-fetch live state between steps (that would defeat `GlobalLiveState` and risk N+1 reads).

## VAL-01 Testcontainers Harness

`tests/conftest.py` provides a session-scoped `odoo` fixture = `TestHarness(snapshot=True)` and an `odoo_version` fixture `[CITED: conftest.py]`. `TestHarness` exposes `.client`, `.url`, `.modules` (a `ModuleManager`), and `._database` (`"test_odoo"`), with `username/password = admin/admin` `[CITED: harness.py:18-90, container.py:69]`.

**`project` module install (SPEC R11) — two viable paths:**
1. **Preferred:** a Phase-4 session fixture that constructs `TestHarness(modules=["project"], snapshot=True)`. The container installs `project` at startup and the result is snapshot-cached `[CITED: container.py:77, 261 save_snapshot after module install]`, so the cost is paid once per (version, module-set) and reused. This requires a *separate* harness instance from the no-modules `odoo` fixture, OR amending the existing fixture — planner decides, but keep it Phase-4-scoped.
2. **Alternative:** keep the existing `odoo` fixture and call `await odoo.modules.install_module("project")` in a session fixture. `install_module` is idempotent (skips if already installed) and has ir_cron retry `[CITED: module_manager.py:60-73, 129-135]`. Slower (no snapshot cache for the module) but simpler wiring.

> **Recommendation:** path 1 (snapshot-cached `modules=["project"]`) to stay under the 120s/entry budget. A live `button_immediate_install` of `project` costs 10–30s; snapshot restore avoids paying it every run.

**VANILLA-Odoo constraint (project memory):** acceptance tests run against vanilla CE — only base + the explicitly-installed `project` module exist. The D-01 fixture (`project.project` + `project.task.type` linked by m2m) is valid *only because* R11 installs `project`. Use only cross-version-stable scalar fields (`name` + known-safe scalars); AVOID version-divergent fields (`member_ids` vs `favorite_user_ids` on `project.project`) per CONTEXT D-01.

> **`[ASSUMED]` A2 — m2m field name `project.task.type.project_ids`.** CONTEXT D-01 names the m2m field `project_ids` but explicitly flags it for live-introspection verification across Odoo 17/18/19. In Odoo, `project.task.type` (stages) relates to `project.project` via a Many2many; the field has historically been `project_ids`. This MUST be confirmed during planning via `client.fields_get("project.task.type")` against each of 17/18/19 before the fixture is finalized — field names drift across versions (this is a documented project lesson, PROJECT.md). Do not hard-code without verification.

**Per-test isolation:** the existing acceptance suite uses an autouse `cleanup_xmlids` fixture that unlinks all `ir.model.data` rows under the test prefix after each test `[CITED: test_plan_import.py:66-82]`. VAL-01 mutates *real records* (creates project/stage records), not just xmlid rows — so cleanup must also unlink the created records, OR rely on test ordering within a single subtest sequence. The Go v1 VAL-01 was a *lifecycle scenario* (initial → re-apply → mid-lifecycle → delete/archive/reject → verify) run as an ordered sequence against one container; replicate that as a single ordered test or a class with sequenced subtests rather than 5 independent tests fighting over shared state.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Topological execution order | a custom DAG walk / Kahn's algo | `nx.topological_generations(graph)` | Already used by render; identical order; battle-tested |
| m2m relation write | manual `(4,id)` link loop | `(6, 0, [ids])` SET | Idempotent by construction; one call |
| xmlid bind/read | new `ir.model.data` create/search | `identity.write_xmlid` / `find_by_xmlid` (Phase 3) | Already built, idempotent upsert, model-mismatch guard |
| Archivability check | `fields_get` parsing in the executor | `SchemaRegistry.get(model).archivable` | Flag already derived (`active` store=True) |
| Odoo error → message | parsing RPC fault dicts | `str(OdooRpcError)` → `.human_message` | godoo-client already extracts + path-strips |
| Module install for tests | `odoo-bin -i` subprocess | `TestHarness(modules=["project"])` / `ModuleManager.install_module` | jsonrpc-only constraint; snapshot-cached |
| Re-running diff in apply | calling `diff()` again | reuse the pre-built `list[PlanStep]` | diff is pure; re-running risks drift + extra reads |

**Key insight:** Phase 4 is ~90% *wiring existing parts in a new order*, ~10% net-new code (`GlobalLiveState`, `serialize.py`, the execution loop, `ResourceOptions`/`_options` plumbing). Resist building new transport or new ordering logic — both already exist.

## Common Pitfalls

### Pitfall 1: Mutating the frozen LiveState instead of a separate GlobalLiveState
**What goes wrong:** trying to register new res_ids on the Phase-3 `LiveState` (a frozen dataclass) raises `FrozenInstanceError`.
**How to avoid:** `GlobalLiveState` is a NEW mutable object (`dict[str,int]` or a thin wrapper) seeded *from* `LiveState`, never `LiveState` itself.
**Warning sign:** `dataclasses.FrozenInstanceError` at the first create-register.

### Pitfall 2: Forward reference resolves to a slug, not an int, at m2m write time
**What goes wrong:** the serializer emits `[(6, 0, ["some_slug"])]` because `GlobalLiveState` wasn't updated before the dependent step ran.
**Why:** the referenced CREATE landed in the same or later generation, or registration happened after the dependent write.
**How to avoid:** register `global_live_state[slug] = new_id` *immediately* after each create returns, before advancing; assert the DAG places the m2m target in an earlier-or-equal generation and Creates run before the referencing Update/Create within a level.
**Warning sign:** `OdooValidationError` ("invalid id" / type error) on the m2m write, or a `KeyError`/slug leaking into the payload.

### Pitfall 3: Archive preflight runs AFTER an Odoo call (SC-5 violation)
**What goes wrong:** the executor writes `{"active": False}` and lets Odoo error on a non-archivable model, instead of halting first.
**How to avoid:** call `registry.get(model).archivable` and raise `ArchiveNotSupportedError` *before* any `client.*` call for that step. SC-5 requires zero mutation for that step.
**Warning sign:** test asserting "no client call" fails because a write was attempted.

### Pitfall 4: Re-fetching or re-diffing inside apply breaks idempotency/determinism
**What goes wrong:** apply re-reads live state mid-run or re-calls `diff()`, producing extra RPC and non-deterministic behavior.
**How to avoid:** consume the pre-built `list[PlanStep]` and `graph` once; the only live reads after start are the writes themselves and VAL-01's read-back assertions.
**Warning sign:** mutation-count test (R7) sees more calls than steps.

### Pitfall 5: NoOp/Reject steps issue writes
**What goes wrong:** the loop writes for every step including NoOp, defeating CORE-06.
**How to avoid:** dispatch on `PlanAction` — NoOp = skip (status `ok`, no call), Reject (collision, D-02) = halt/skip with no call, only Create/Update/Delete/Archive issue RPC.
**Warning sign:** re-apply issues `write` calls; idempotency subtest 2 fails.

### Pitfall 6: VAL-01 subtests fight over shared container state
**What goes wrong:** 5 independent tests create the same project records and collide / leak.
**How to avoid:** model VAL-01 as one ordered lifecycle (initial → re-apply → mid → delete/archive/reject → verify) sharing a prefix, with cleanup of both xmlid rows AND created records; or a `TestClass` with sequenced methods. Mirror the Go v1 scenario shape.
**Warning sign:** flaky cross-test failures depending on run order.

### Pitfall 7: Version-divergent fixture fields
**What goes wrong:** a field present on Odoo 17 `project.project` is renamed/absent on 18/19, failing the matrix.
**How to avoid:** restrict fixtures to `name` + introspection-confirmed cross-version-stable scalars; verify the m2m field name (A2) on all three versions before locking the fixture.
**Warning sign:** green on 17, red on 18/19 with "invalid field".

## Code Examples

### Executor dispatch skeleton (pattern, not literal)
```python
# Source: synthesized from plan.py pipeline + client.py signatures (source-verified)
async def _execute_step(
    client: OdooClient,
    step: PlanStep,
    gls: dict[str, int],
    snapshot: VersionedSnapshot,
    registry: SchemaRegistry,
) -> int | None:
    if step.action is PlanAction.NOOP or step.action is PlanAction.REJECT:
        return None  # no Odoo call (idempotency / collision)
    if step.action is PlanAction.CREATE:
        payload = serialize_fields(step, snapshot, gls)        # m2m -> (6,0,[ids])
        new_id = await client.create(step.model, payload)       # -> int
        gls[step.slug] = new_id                                 # register BEFORE next step
        await write_xmlid(client, step.model, new_id, *split_xmlid(step.xmlid))
        return new_id
    if step.action is PlanAction.UPDATE:
        payload = serialize_diff(step, snapshot, gls)
        await client.write(step.model, step.res_id, payload)
        return step.res_id
    if step.action is PlanAction.DELETE:
        await client.unlink(step.model, step.res_id)
        return step.res_id
    if step.action is PlanAction.ARCHIVE:
        if not (await registry.get(step.model)).archivable:     # SAFE-02 preflight, BEFORE any RPC
            raise ArchiveNotSupportedError(model=step.model, slug=step.slug)
        await client.write(step.model, step.res_id, {"active": False})
        return step.res_id
```

### m2m serialization seam
```python
# Source: Odoo ORM docs (17/18/19) — (6,0,[ids]) SET command
def serialize_fields(step, snapshot, gls) -> dict[str, Any]:
    model_schema = snapshot.models[step.model]
    out: dict[str, Any] = {}
    for name, value in desired_fields_for(step).items():
        ttype = model_schema.fields[name].ttype
        if ttype == "many2many":
            ids = [gls[v] if isinstance(v, str) else int(v) for v in value]
            out[name] = [(6, 0, ids)]      # SET — idempotent, replaces relation
        else:
            out[name] = value              # m2o int / char / bool pass-through (verify A1)
    return out
```

> **Open design point (Claude's discretion, CONTEXT):** CREATE steps need the *full* desired-fields dict, but `PlanStep` currently carries only `field_diff` (UPDATE deltas). Planner chooses: extend `PlanStep` to carry the full desired dict, or have the executor look it up from `DesiredState` by slug. Coordinate with the D-03 PlanStep extension (which already adds `delete_behavior`/`options`).

## State of the Art

| Old (Go v1) | Current (stateman Python) | Impact |
|-------------|---------------------------|--------|
| Go executor with custom ordering | `nx.topological_generations` reuse | No bespoke DAG code |
| m2m-to-data-source structurally blocked (REL-04) | `GlobalLiveState` uniform slug→int map seeded from managed + seam + creates | Forward refs resolve uniformly |
| Sidecar/implicit state | `ir.model.data` xmlid (Phase 3 `identity.py`) | Zero-footprint, two-machine convergence |
| Additive m2m risk | `(6, 0, [ids])` SET | Idempotent re-apply |

**Deprecated/not-applicable:** Odoo 15+ `Command.set(ids)` helper exists and is more readable than `(6, 0, ids)`, but it is a *server-side* Python helper not available over jsonrpc — stateman MUST send the raw tuple `[(6, 0, [ids])]` in the RPC payload. Do not import or reference `odoo.fields.Command`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Non-m2m scalar serialization is pass-through (m2o int, char str, bool) | M2M Write Protocol / serialize seam | Wrong write shape → `OdooValidationError` on create/update; pin via live round-trip in planning |
| A2 | `project.task.type` ↔ `project.project` m2m field is `project_ids` | VAL-01 Harness | Fixture fails on one/all Odoo versions; MUST `fields_get`-verify on 17/18/19 before locking fixture |

> Both assumptions are flagged in CONTEXT (D-01 "VERIFY during planning") — they are not new risks, just carried forward. Resolve both with live introspection in the first VAL-01 plan task before writing fixtures.

## Open Questions

1. **CREATE full-fields source** — `PlanStep` carries only `field_diff`; CREATE needs the full desired dict.
   - What we know: D-03 already extends `PlanStep` (adds `delete_behavior`/`options`).
   - What's unclear: extend `PlanStep` with the full dict vs executor lookup from `DesiredState`.
   - Recommendation: extend `PlanStep` (single source of truth for the executor; keeps it `DesiredState`-free as CONTEXT D-03 intends). Planner's call.

2. **VAL-01 record cleanup** — created project/stage records (not just xmlid rows) must be cleaned between the lifecycle and other tests.
   - Recommendation: model VAL-01 as one ordered lifecycle scenario; clean up both xmlid rows and created records at scenario end. Mirror Go v1 shape.

3. **Existing `odoo` fixture vs `project`-module fixture** — separate harness instance vs amend the shared one.
   - Recommendation: separate Phase-4 session fixture `TestHarness(modules=["project"], snapshot=True)`; keeps the no-modules fixture intact for Phase-3 tests and benefits from snapshot caching.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | VAL-01 acceptance (testcontainers) | ✓ (CI + dev) | per CI | `pytest -m "not integration"` skips live tests locally |
| `odoo:17.0/18.0/19.0` CE images | VAL-01 matrix | ✓ | confirmed Phase 03.1 (19.0 manifest verified) | — |
| `postgres:15-alpine` | testcontainers | ✓ | confirmed Phase 03.1 boot | — |
| `godoo-client` 0.2.0 | all mutations | ✓ | sibling editable dep | — |
| `godoo-testcontainers` 0.2.0 | harness | ✓ | sibling editable dep | — |

**Missing with no fallback:** none. **Missing with fallback:** Docker locally → integration tests skip (unit tests still run); this is the established Phase-3 pattern.

## Validation Architecture

> `nyquist_validation: true` in config — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest >=8 + pytest-asyncio (`asyncio_mode = "auto"`) |
| Config file | `pyproject.toml` (`[tool.pytest.ini_options]`) — existing |
| Quick run command | `uv run pytest -m "not integration" -q` (unit, no Docker) |
| Full suite command | `uv run pytest -q` (incl. `@pytest.mark.integration` — needs Docker) |
| VAL-01 only | `uv run pytest tests/acceptance/test_apply.py -m integration -q` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| R2/CORE-05/REL-08 | Creates→Updates→Deletes, slug tiebreak | unit | `pytest tests/unit/test_executor_order.py -x` | ❌ Wave 0 |
| R3/REL-05 | new id threaded; B.m2m = A.new_id | integration | VAL-01 cross-apply subtest | ❌ Wave 0 |
| R4/REL-06 | m2m payload shaped `[(6,0,[ids])]` | unit | `pytest tests/unit/test_serialize.py -x` | ❌ Wave 0 |
| R5/SAFE-01 | `_options` → `ResourceNode.options.delete_behavior` | unit | `pytest tests/unit/test_options_dsl.py -x` | ❌ Wave 0 |
| R6/R13/SAFE-02 | archive preflight halts before RPC | unit | `pytest tests/unit/test_delete_behavior.py -x` | ❌ Wave 0 |
| R7/CORE-06 | zero mutation calls on re-apply | unit+integration | mock-client count test + VAL-01 subtest 2 | ❌ Wave 0 |
| R8/SAFE-04 | prompt `n` aborts; `--auto-approve` skips; all-NoOp short-circuit | unit (CLI) | `pytest tests/unit/test_apply_cli.py -x` | ❌ Wave 0 |
| R9/SAFE-05 | fail step 3/5 → 1-2 committed, 4-5 skipped | unit | `pytest tests/unit/test_partial_progress.py -x` | ❌ Wave 0 |
| R10/UX-04 | `[N/total]` + status tokens in stdout | unit (CLI) | `pytest tests/unit/test_apply_progress.py -x` | ❌ Wave 0 |
| R12 | exit codes 0/1/3/4/5 | unit (CLI) | `pytest tests/unit/test_apply_exit_codes.py -x` | ❌ Wave 0 |
| R11/VAL-01 | 5 subtests, Odoo 17/18/19, ≤120s | integration | `pytest tests/acceptance/test_apply.py -m integration` | ❌ Wave 0 |
| R14 | error hierarchy + mypy strict | unit | `pytest tests/unit/test_apply_errors.py -x` + `mypy --strict` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `uv run pytest -m "not integration" -q` + `uv run mypy --strict src` + `uv run ruff check`
- **Per wave merge:** full unit suite + one local integration run on Odoo 17 (Docker)
- **Phase gate:** CI `integration` job green on 17.0/18.0/19.0; per-version VAL-01 ≤120s; `mypy --strict` + `ruff` clean

### Wave 0 Gaps
- [ ] `tests/acceptance/test_apply.py` — VAL-01 5-subtest lifecycle (R11)
- [ ] `tests/acceptance/fixtures/val01/01-initial.py`, `02-mid-lifecycle.py` (project/task.type, m2m) (R11)
- [ ] Phase-4 session fixture installing `project` module (`TestHarness(modules=["project"])`) (R11)
- [ ] `tests/unit/` files for executor order, serialize, options DSL, delete_behavior, partial progress, CLI/exit-codes, errors
- [ ] Mock/counting `OdooClient` wrapper for zero-mutation idempotency assertion (R7)
- [ ] Verify `project.task.type` m2m field name on 17/18/19 (A2) before fixture lock

*(No framework install needed — pytest + pytest-asyncio already configured.)*

## Security Domain

> `security_enforcement: true`, ASVS L1. This phase performs authenticated writes to a live Odoo instance.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Credentials from `GODOO_*` env vars ONLY — never CLI args (process listing leak). Established Phase 3 pattern `[CITED: plan.py credential block]`. |
| V3 Session Management | no | jsonrpc session managed by `OdooClient`; no stateman session surface |
| V4 Access Control | yes (delegated) | Odoo server-side ACLs enforce write permission; `OdooAccessError` surfaces denials. Stateman adds SAFE-04 human confirmation gate. |
| V5 Input Validation | yes | `ODOO_VERSION` regex-validated before int parse (existing pattern); fixture/config field values validated by Odoo on write |
| V6 Cryptography | no | No crypto in this phase; transport TLS handled by httpx in `godoo-client` |
| V7 Error Handling | yes | Odoo RPC faults are path-stripped by `godoo-client` (`_strip_paths`) before surfacing `[CITED: errors.py:14-18]` — no server filesystem paths leak into stateman output |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credentials in process args / logs | Information Disclosure | `GODOO_*` env only; never log password; `secrets-handling` rule (never read secret values) |
| Silent adoption of unmanaged records | Tampering / Repudiation | SAFE-03 (Phase 3) — xmlid collision → Reject, never silent Create/Update |
| Destructive mass-delete with no confirmation | Tampering | SAFE-04 prompt + explicit `--auto-approve`; `delete_behavior` default `reject` |
| Archive on non-archivable model corrupting intent | Tampering | SAFE-02 schema preflight before any mutation |
| Server traceback leaking host paths | Information Disclosure | `godoo-client` path-stripping; stateman surfaces `.human_message` only |
| Partial-failure ambiguity (operator unsure what committed) | Repudiation | SAFE-05 partial-progress report lists committed vs skipped with remote ids |

**No new secrets, no new auth surface, no new network listener** introduced by Phase 4. The security posture is inherited from Phase 3's env-only credential model plus the SAFE-01/02/04/05 behaviors this phase implements.

## Sources

### Primary (HIGH confidence)
- `godoo-client/.../client/client.py` — `create`/`write`/`unlink`/`search_read`/`ref`/`fields_get` signatures + lifecycle + safety guard (source-read this session)
- `godoo-client/.../client/errors.py` — exception hierarchy, path-stripping (source-read)
- `godoo-client/.../services/modules/module_manager.py` — `install_module`/`is_module_installed` idempotency + ir_cron retry (source-read)
- `godoo-testcontainers/.../harness.py`, `container.py` — `TestHarness(modules=…)`, `_database`, snapshot caching, no-safety client (source-read)
- stateman `plan.py`, `diff.py`, `livestate.py`, `identity.py`, `registry.py`, `render.py`, `plan/types.py`, `nodes.py`, `errors.py`, `conftest.py`, `test_plan_import.py` (source-read)
- Odoo ORM API docs 17.0 / 18.0 / 19.0 — m2m command tuples `(6,0,[ids])` etc. (https://www.odoo.com/documentation/17.0/developer/reference/backend/orm.html and 18.0/19.0 equivalents)
- `04-SPEC.md`, `04-CONTEXT.md`, `REQUIREMENTS.md`, `STATE.md` (locked phase contracts)

### Secondary (MEDIUM confidence)
- WebSearch corroboration of Odoo magic tuples (Medium / braincuber tutorials) — used only to cross-check the official ORM doc semantics, not as primary authority

### Tertiary (LOW confidence)
- None. Both `[ASSUMED]` items (A1 scalar serialization, A2 m2m field name) are flagged for live-introspection verification in planning, not asserted as fact.

## Metadata

**Confidence breakdown:**
- Transport surface: HIGH — every method source-verified in `client.py`
- Execution architecture: HIGH — reuses existing pipeline + DAG traversal; pattern proven in Phase 3
- m2m protocol: HIGH — official Odoo docs 17/18/19, identical semantics
- VAL-01 fixture field names: MEDIUM — `project_ids` is the working hypothesis; A2 flagged for verification
- Scalar serialization shape: MEDIUM — A1 pass-through hypothesis; pin via live round-trip

**Research date:** 2026-06-04
**Valid until:** 2026-07-04 (stable — locked deps; re-verify only if `godoo-client` minor bumps)
