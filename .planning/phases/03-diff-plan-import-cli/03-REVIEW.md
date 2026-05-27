---
phase: 03-diff-plan-import-cli
reviewed: 2026-05-27T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/godoo_stateman/cli/commands/import_.py
  - src/godoo_stateman/cli/commands/plan.py
  - src/godoo_stateman/diff.py
  - src/godoo_stateman/dsl/eval.py
  - src/godoo_stateman/dsl/normalize.py
  - src/godoo_stateman/dsl/types/desired.py
  - src/godoo_stateman/errors.py
  - src/godoo_stateman/live/livestate.py
  - src/godoo_stateman/live/seam.py
  - src/godoo_stateman/plan/render.py
  - src/godoo_stateman/plan/types.py
  - tests/acceptance/test_plan_import.py
findings:
  critical: 3
  warning: 4
  info: 2
  total: 9
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-05-27T00:00:00Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Reviewed the full diff/plan/import CLI pipeline introduced in Phase 3. The overall structure is sound — the pure/sync/I/O-free invariant on `diff()` holds, credentials never appear in logs, frozen Pydantic models are used correctly, and `search_read` calls consistently pass explicit `fields=` and `order=`. The SAFE-03 collision check is correctly implemented in `import_.py`.

Three blockers were identified:

1. `render_plan` silently drops Delete, Archive, and Reject plan steps — they are absent from the dependency graph and never emitted to output.
2. Resources with a `xmlid_module` override are always diffed as CREATE because `LiveState.fetch` only loads the top-level `xmlid_prefix` namespace.
3. A `Deferred` whose `deps` key is not present in `seam_result` raises a bare `KeyError` that surfaces as an opaque "Unexpected error" rather than a `LiveStateFetchError`.

---

## Critical Issues

### CR-01: Delete / Archive / Reject steps are silently dropped from `render_plan` output

**File:** `src/godoo_stateman/plan/render.py:88`

**Issue:** `render_plan` drives output exclusively via `nx.topological_generations(graph)`. The `graph` is built from `build_graph(state)` which operates only on `state.resources` and `state.data_sources`. Managed-but-absent slugs (Delete/Archive candidates from Pass 2 of `diff()`) and REJECT steps have no node in this graph, so they are never yielded by `topological_generations` and are never printed. The `plan_steps_by_slug` dict contains them, but nothing ever looks them up. A user running `godoo plan` against an Odoo instance with managed records removed from the config would see **zero output** for those records — silently missing Delete/Archive/Reject intent.

The `noop_count` summary line also does not surface these steps.

**Fix:** Emit any plan step whose slug is absent from the graph after the topological loop. Delete/Archive/Reject have no ordering constraints relative to desired-state resources, so appending them sorted at the end is correct and deterministic (SC-2).

```python
# After the topological_generations loop:
graph_slugs: set[str] = set(graph.nodes)
unordered_steps = sorted(
    (s for s in plan_steps if s.slug not in graph_slugs),
    key=lambda s: s.slug,
)
for step in unordered_steps:
    if step.action == PlanAction.NOOP and not verbose:
        continue
    symbol = ACTION_SYMBOLS[step.action]
    style = ACTION_STYLES[step.action]
    header = Text()
    header.append("  ")
    header.append(symbol, style=style)
    header.append(f" {step.slug}  [{step.model}]")
    console.print(header)
```

---

### CR-02: Resources with `xmlid_module` override are always classified CREATE

**File:** `src/godoo_stateman/diff.py:84-87`

**Issue:** `diff()` correctly computes `effective_prefix = resource.xmlid_module or state.xmlid_prefix` to build the full `xmlid` string (line 85). But on line 87, `record = live_state.managed.get(resource.slug)` looks up the slug in the `managed` dict, which was fetched in `LiveState.fetch` using only `xmlid_prefix` as the module filter. If a resource declares `xmlid_module="other_module"`, `ir.model.data` row for `other_module.slug` is not included in `managed`, so `record is None` and diff always returns CREATE — regardless of whether the binding already exists in Odoo. This silently ignores the per-resource xmlid override for the managed-set lookup.

**Fix:** `LiveState.fetch` must accept and scan the union of all effective prefixes. Alternatively, diff must issue a targeted `find_by_xmlid` lookup for overridden slugs. The simplest surgical fix is to pass the set of effective prefixes into `fetch`:

```python
# In plan.py, before LiveState.fetch:
effective_prefixes: set[str] = {state.xmlid_prefix}
for r in state.resources:
    if r.xmlid_module:
        effective_prefixes.add(r.xmlid_module)

live_state = await LiveState.fetch(
    client, effective_prefixes, desired_fields_by_model
)
```

And in `LiveState.fetch`, filter `ir.model.data` with `[("module", "in", sorted(effective_prefixes))]`, keying `managed` on `(module, name)` tuples or using `f"{module}.{name}"` as the key. The diff lookup must then use `effective_prefix` to key the managed dict rather than the bare slug.

---

### CR-03: `KeyError` from unregistered Deferred dep surfaces as opaque "Unexpected error"

**File:** `src/godoo_stateman/live/seam.py:113`

**Issue:** `resolve_deferred` iterates `sorted(fval.deps)` and fetches each dep from `seam_result` with `seam_result[dep]`. If a `Deferred` references a `node_key` that was not registered via `data.*()` in the DSL (or whose `DataSourceNode` was removed from `state.data_sources` after the resource was built), `seam_result[dep]` raises a bare `KeyError`. This propagates up through `plan.py`'s `except Exception` handler as `"Unexpected error: <key>"` — giving the operator no hint that the problem is a broken data-source reference.

The `resolve_data_sources` error path (`LiveStateFetchError`) is already well-defined; this case deserves the same treatment.

**Fix:**
```python
# In resolve_deferred, replace:
resolved_args = [seam_result[dep] for dep in sorted(fval.deps)]

# With:
from godoo_stateman.errors import LiveStateFetchError
resolved_args = []
for dep in sorted(fval.deps):
    if dep not in seam_result:
        raise LiveStateFetchError(
            f"Resource {resource.slug!r} field {fname!r}: Deferred references "
            f"data-source key {dep!r} which was not resolved. "
            "Check that the DataSourceNode is declared in the config."
        )
    resolved_args.append(seam_result[dep])
```

---

## Warnings

### WR-01: `inverse_field` on child nodes holds a `ResourceNode` object, causing incorrect diff for child resources

**File:** `src/godoo_stateman/dsl/eval.py:149`

**Issue:** `_flatten` sets `child_fields = {**child.fields, fval.inverse_field: parent}` where `parent` is the original pre-rebuild `ResourceNode`. When `diff()` processes the child resource, `_normalize_value(parent_node, schema_field.ttype)` is called with a `ResourceNode` as the value. For a `many2one` field (the typical type of an inverse/parent field), the normalize branch checks `isinstance(value, (list, tuple))` — a `ResourceNode` is neither, so it falls through to `return value`, preserving the `ResourceNode` object. Comparing this against the live int value (`live_val = live_fields.get(fname)`) produces `ResourceNode != int` → always a spurious UPDATE for every child resource.

The comment at line 148 acknowledges the issue ("The apply stage (Phase 3) must handle ResourceNode-valued inverse_fields") but the diff stage runs before apply and is affected today.

**Fix:** In `_flatten`, after computing the rebuilt parent, resolve `inverse_field` to the parent's slug string or defer it to a `Deferred` so `_normalize_value` receives an int-compatible value. At minimum, do not pass the `ResourceNode` object into `child_fields` — use the slug string and let the apply stage do the ID lookup:

```python
# Replace:
child_fields = {**child.fields, fval.inverse_field: parent}
# With (slug string placeholder; apply stage resolves slug → res_id):
child_fields = {**child.fields, fval.inverse_field: parent.slug}
```

This requires the diff stage to skip comparison of slug-valued fields (which won't match live int values) — a pre-existing gap that needs addressing in the apply phase design, but using the slug string is at least non-crashing and removes the false UPDATE signal.

---

### WR-02: `OdooValidationError` from `write_xmlid` is not caught by `import_.py`'s `StatemanError` handler

**File:** `src/godoo_stateman/cli/commands/import_.py:113-118`

**Issue:** `write_xmlid` (in `identity.py:115`) raises `OdooValidationError` when the existing `ir.model.data` row points to a different model than the one being imported. `OdooValidationError` is a `godoo.client.errors` class, not a subclass of `StatemanError`. The `import_` command's `except StatemanError` block (line 113) does not catch it. It falls through to `except Exception` (line 116), which prints `"Unexpected error: ..."` — the "Unexpected error" label is misleading for what is actually a deterministic, foreseeable model-mismatch condition.

This can only occur if `--force` is combined with a model-mismatch case that somehow bypasses the collision check (which currently checks `res_id` only, not `model`) — but it still deserves a clean error message.

**Fix:** Either add `OdooValidationError` to the caught exception types, or make `write_xmlid` raise a `StatemanError` subclass on model mismatch. The latter is cleaner since `identity.py` already imports from `godoo.client.errors` directly:

```python
# In import_.py:
from godoo.client.errors import OdooValidationError

except (StatemanError, OdooValidationError) as exc:
    console.print(f"[red]{exc}[/red]")
    return 1
```

---

### WR-03: `_normalize_value` silently passes through unrecognized `many2one` values

**File:** `src/godoo_stateman/dsl/normalize.py:62`

**Issue:** In the `many2one` branch, after handling `False/None` and `(id, name)` tuple/list, the fallback is `return value`. If a DSL author writes `country_id = "Belgium"` (a string) or passes any non-int scalar, `_normalize_value` returns the string unchanged. The diff stage then compares the string against a live integer ID, always producing a false UPDATE. No validation error is raised, no warning is emitted.

**Fix:** Add an explicit guard for the expected int case and raise `ValueError` for other types:

```python
elif ttype == "many2one":
    if value is False or value is None:
        return None
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return int(value[0])
    if isinstance(value, int):
        return value
    raise ValueError(
        f"many2one field value must be an int ID, (id, name) tuple, False, or None; "
        f"got {type(value).__name__!r}: {value!r}"
    )
```

---

### WR-04: `cleanup_xmlids` fixture is not `autouse=True` despite docstring saying so

**File:** `tests/acceptance/test_plan_import.py:67`

**Issue:** The `cleanup_xmlids` fixture docstring says "Autouse-style cleanup" but it is NOT decorated with `autouse=True`. It is a regular fixture that tests must explicitly request. Any test that accidentally omits `cleanup_xmlids` from its parameter list will leave `ir.model.data` rows under `TEST_PREFIX` that leak into subsequent tests. `test_plan_shows_create_for_new_resource` and `test_plan_shows_noop_after_create` (and others) would be affected by stale state from a prior failed run.

Furthermore, `test_plan_is_deterministic`, `test_plan_reject_on_xmlid_collision`, `test_plan_lists_managed_set`, `test_datasource_resolves_at_plan_time`, and `test_datasource_m2o_resolved_in_resource` all accept `cleanup_xmlids` but only some of them write to `ir.model.data`. The fixture cleanup is correct for those that write, but the current approach relies on every test remembering to request it.

**Fix:** Mark the fixture `autouse=True` within the module and remove the explicit parameter from test signatures, or at minimum add a clear comment warning that omitting the fixture parameter leads to state leakage.

```python
@pytest.fixture(autouse=True)
async def cleanup_xmlids(odoo: object) -> AsyncIterator[Any]:
    ...
```

---

## Info

### IN-01: `_SAFE_BUILTINS` includes `getattr` which enables full `__builtins__` escape

**File:** `src/godoo_stateman/dsl/eval.py:83`

**Issue:** The module docstring and inline comment already acknowledge this: with `getattr` in the allowlist, a determined DSL author can traverse `object.__subclasses__()` to reach `__import__` and arbitrary I/O. The code is correct to document this and limit the guard to "accidental" I/O prevention. No change needed unless the trust boundary changes. Flagging for visibility to reinforce the boundary is documented.

**Fix:** No action required unless untrusted config inputs are ever accepted. If that scope changes, `getattr` must be removed from `_SAFE_BUILTINS` and the DSL namespace should expose only typed proxy accessors — `exec()` replaced by a proper AST-walking evaluator or subprocess+seccomp sandbox.

---

### IN-02: `config_parameters` on `DesiredState` uses `tuple[dict[str, str], ...]` — dicts are mutable inside a frozen model

**File:** `src/godoo_stateman/dsl/types/desired.py:28`

**Issue:** `DesiredState` is a frozen Pydantic model, but `config_parameters: tuple[dict[str, str], ...]` holds mutable dicts. Pydantic `frozen=True` only prevents attribute rebinding (you cannot do `state.config_parameters = ...`), but the dicts inside the tuple can still be mutated (`state.config_parameters[0]["key"] = "evil"`). This is the same known limitation as `ResourceNode.fields` but is worth flagging because config parameters are user-supplied values.

In practice there are no pipeline stages that mutate `config_parameters` today, so this is a latent risk rather than an active bug.

**Fix:** Change to `tuple[tuple[tuple[str, str], ...], ...]` or use a frozen dataclass/Pydantic model for each parameter entry. Alternatively, use `FrozenSet` or document the immutability contract explicitly next to the field declaration.

---

_Reviewed: 2026-05-27T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
