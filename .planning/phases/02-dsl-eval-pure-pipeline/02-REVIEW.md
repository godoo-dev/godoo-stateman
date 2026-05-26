---
phase: 02-dsl-eval-pure-pipeline
reviewed: 2026-05-26T12:00:00Z
depth: deep
files_reviewed: 13
files_reviewed_list:
  - src/godoo_stateman/dsl/context.py
  - src/godoo_stateman/dsl/eval.py
  - src/godoo_stateman/dsl/normalize.py
  - src/godoo_stateman/dsl/graph.py
  - src/godoo_stateman/dsl/types/desired.py
  - src/godoo_stateman/dsl/types/nodes.py
  - src/godoo_stateman/dsl/types/deferred.py
  - src/godoo_stateman/errors.py
  - src/godoo_stateman/cli/commands/plan.py
  - tests/unit/dsl/test_eval.py
  - tests/unit/dsl/test_normalize.py
  - tests/unit/dsl/test_graph.py
  - tests/unit/dsl/test_deferred.py
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: passed
---

# Phase 02: Code Review Report (Re-Review)

**Reviewed:** 2026-05-26T12:00:00Z
**Depth:** deep (cross-file, call-chain traced)
**Files Reviewed:** 13
**Status:** passed — no new blockers found; all previously fixed issues confirmed resolved

## Summary

This re-review confirms the three targeted fixes from the prior round are correct and complete:

- **BL-02 (plan.py exit code):** `raise typer.Exit(code=0)` is present on the success path at `plan.py:32`. Confirmed fixed.
- **BL-01 (eval.py sandbox documentation):** Both the module-level docstring and the inline `_SAFE_BUILTINS` block comment now accurately describe the trust boundary, name the `getattr` escape vector explicitly, and refer to CLAUDE.md for the trusted-author constraint. No false security claims remain. Confirmed fixed; treated as informational only going forward.
- **MA-01 (model name translation):** Both `ResourceProxy.__getattr__` (`context.py:127`) and `DataProxy.__getattr__` (`context.py:164`) now use `model_name.replace("_", ".")` (full replacement, no count limit). `test_three_segment_model_name` covers `sale.order.line` and `account.move.line`. Confirmed fixed.

Open-by-design issues from the prior review (MA-02 sorted() TypeError on mixed m2x lists, MA-03 children() silent drop, MA-04 module-extraction dead fallback branch) are acknowledged and not re-raised. They remain in the prior review document for reference.

The deep cross-file pass found two new warnings and four informational items. None block shipping.

---

## Warnings

### WR-01: `eval.py:202` — `or` operator in module extraction produces a misleading error for wrong-typed module values

**File:** `src/godoo_stateman/dsl/eval.py:202`

**Issue:** The module extraction reads:
```python
module: object = exec_locals.get("module") or exec_globals.get("module")
```
The `or` short-circuits on any falsy value, not only `None`. If a DSL author writes `module = 0` or `module = False`, `exec_locals.get("module")` returns a falsy non-`None` value, which causes the `or` to fall through to `exec_globals.get("module")`. Since `exec_globals` never contains a `"module"` key (nothing in `dsl_ns` or `_SAFE_BUILTINS` defines one), the fallback always returns `None`. The subsequent check `not isinstance(module, str) or not module` then raises `MissingModuleError` saying "Config file X must declare: module = `<name>`" — but the variable *was* declared, just with the wrong type. The error message is misleading and makes the bug harder to diagnose.

This does not cause silent data corruption — `MissingModuleError` is always raised. The `exec_globals` fallback is also dead code in practice, as noted in the prior review (MA-04).

**Fix:** Replace the truthiness short-circuit with an explicit `None` check:
```python
module_raw: object = exec_locals.get("module")
if module_raw is None:
    module_raw = exec_globals.get("module")
if not isinstance(module_raw, str) or not module_raw:
    raise MissingModuleError(
        f'Config file {path} must declare: module = "<name>" (got {type(module_raw).__name__}: {module_raw!r})'
    )
module: str = module_raw
```
This preserves the Pitfall-2 two-dict lookup without the falsy-value masking, and the error message includes the actual value to aid debugging.

---

### WR-02: `context.py:70` — `_ResourceBuilder._RESERVED` does not guard underscore-prefixed field names; typos inject bogus keys into `ResourceNode.fields`

**File:** `src/godoo_stateman/dsl/context.py:70`

**Issue:** `_RESERVED = frozenset({"_node", "_fields"})` only protects the two private instance attributes that `_ResourceBuilder` actually owns. Any other name not in the set routes through `__setattr__` to `self._fields[name] = value`. This includes:

- `r._RESERVED = "x"` — writes `{"_RESERVED": "x"}` into `node.fields` (bogus Odoo field)
- `r._name = "Acme"` (typo for `r.name`) — writes `{"_name": "Acme"}` into `node.fields` silently

These are injected into `ResourceNode.fields` and propagate into `DesiredState`. At plan/apply time the diff stage will attempt to reconcile `_name` or `_RESERVED` against the live Odoo schema, producing a cryptic field-not-found error with no indication that the cause was a typo at DSL-authoring time.

Under the trusted-author constraint this is not a security issue, but it silently corrupts plan data on any underscore typo.

**Fix:** Reject names starting with `_` in `__setattr__`, since no valid Odoo field name begins with an underscore:
```python
def __setattr__(self, name: str, value: Any) -> None:
    if name in _ResourceBuilder._RESERVED:
        object.__setattr__(self, name, value)
    elif name.startswith("_"):
        raise AttributeError(
            f"Cannot assign {name!r} on ResourceBuilder — "
            "Odoo field names do not start with '_'. "
            "Did you mean to write without the leading underscore?"
        )
    else:
        self._fields[name] = value
```

---

## Info

### IN-01: `eval.py:103` — `_flatten()` does not handle nested `ChildrenWrapper` (children-of-children); violates the DesiredState invariant silently

**File:** `src/godoo_stateman/dsl/eval.py:103`

**Issue:** `_flatten()` performs a single-pass expansion of `ChildrenWrapper` values found directly in a parent node's fields. It does not recurse into the promoted child nodes to check whether their fields also contain `ChildrenWrapper` instances. If a DSL author nests `children()` calls (a child itself has a `children()` field), the inner `ChildrenWrapper` survives into `DesiredState.resources[n].fields`, violating the invariant in `nodes.py:57` ("DesiredState must never hold ChildrenWrapper values"). No error is raised; the corruption is discovered only when the diff stage tries to introspect field values.

There is no test asserting that nested `children()` calls either work correctly or raise a clear error.

**Fix (minimal — assert the invariant at the end of `_flatten()`):**
```python
# After building flat[], enforce the post-condition:
for node in flat:
    for fname, fval in node.fields.items():
        if isinstance(fval, ChildrenWrapper):
            raise ValueError(
                f"ChildrenWrapper survived flattening in {node.slug}.{fname}. "
                "Nested children() calls (children of children) are not supported."
            )
return flat
```
This converts the silent corruption into a clear, early error until recursive expansion is implemented.

---

### IN-02: `context.py:207` — `children()` does not apply underscore-to-dot normalisation to `child_model`; inconsistent with `ResourceProxy` sugar

**File:** `src/godoo_stateman/dsl/context.py:207`

**Issue:** `ResourceProxy.__getattr__` automatically translates `resource.sale_order_line` to model `"sale.order.line"` (DSL sugar). The `children()` helper accepts `child_model` as a raw string and does not apply the same translation. A DSL author writing:
```python
o.lines = children("sale_order_line", "order_id", [...])
```
gets `child_model="sale_order_line"` stored verbatim in the `ChildrenWrapper`. The promoted child nodes then receive `model="sale_order_line"`, which does not match any Odoo schema key. The `normalize()` stage silently passes through all child fields (unknown-model path), and the apply stage will fail with an Odoo model-not-found error.

The docstring says `child_model` should be a "dotted" name (`"sale.order.line"`), which is correct but relies on the author knowing to use a different convention than the one used for all other resource references.

**Fix:** Mirror `ResourceProxy` inside `children()`:
```python
def children(
    child_model: str, inverse_field: str, children_list: list[Any]
) -> ChildrenWrapper:
    child_model = child_model.replace("_", ".")  # mirror ResourceProxy sugar
    ...
```

---

### IN-03: `graph.py:91` — no comment explains why `list[str]` field values (post-flatten slug lists) are intentionally not traversed for edges

**File:** `src/godoo_stateman/dsl/graph.py:91`

**Issue:** After `_flatten()`, a parent's child-list field becomes `list[str]` of slug strings (e.g., `["order1.line1"]`). When `build_graph()` iterates `resource.fields.values()`, these lists are silently skipped: not a `Deferred`, `hasattr(list_val, "slug")` is `False`. This is correct — parent-to-child edges are covered by the `parent_slug` path (source A). However there is no comment explaining this design decision. A future maintainer adding a new reference type (e.g., a `FieldRef` object with a `.slug`, stored inside a list) might not realise that only *direct* field values are inspected, not items *within* iterable field values.

**Fix (documentation only):** Add a brief comment after the `elif hasattr(...)` block:
```python
# NOTE: list[str] values (post-flatten parent→child slug lists) are NOT
# traversed here. Parent→child edges are covered by source A (parent_slug).
# Only direct field-value references produce edges in sources B and C.
```

---

### IN-04: `test_eval.py:246` — purity test uses a string-path patch that would silently succeed if `godoo.client.client` path changes

**File:** `tests/unit/dsl/test_eval.py:246`

**Issue:** `patch("godoo.client.client.OdooClient", side_effect=_fail_on_odoo)` uses a string target path. If the `godoo-client` package restructures its import tree (e.g., `OdooClient` moves to `godoo.client._client`), the `patch()` call silently creates a new attribute at the old path rather than raising. The test continues to pass while providing no actual guard — `eval_config()` could import and call `OdooClient` at the new path undetected.

**Fix:** Either import the target symbol first (ImportError = broken guard, caught immediately) or add `create=False` with an import assertion:
```python
import godoo.client.client as _godoo_client_mod  # ImportError here = guard is broken

with patch.object(_godoo_client_mod, "OdooClient", side_effect=_fail_on_odoo):
    state = eval_config(path)
```
`patch.object` targets the live module object, so it will raise `AttributeError` if `OdooClient` is absent — making any future refactor immediately visible.

---

_Reviewed: 2026-05-26T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
