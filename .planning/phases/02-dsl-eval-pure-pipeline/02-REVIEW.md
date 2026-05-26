---
phase: 02-dsl-eval-pure-pipeline
reviewed: 2026-05-26T00:00:00Z
depth: deep
files_reviewed: 11
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
  blocker: 2
  major: 4
  minor: 4
  nit: 2
  total: 12
status: issues_found
---

# Phase 02: DSL Eval + Pure Pipeline — Code Review Report

**Reviewed:** 2026-05-26
**Depth:** deep (cross-file, runtime-verified escape probes)
**Files Reviewed:** 13 (11 src + 2 test files cross-checked; 4 test files in scope)
**Status:** issues_found
**Tests:** 46 passed, 0 failed

---

## Summary

The pipeline architecture is sound: frozen Pydantic models, clean separation of eval/normalize/graph stages, zero Odoo I/O, NetworkX cycle detection implemented correctly (catches `NetworkXNoCycle`, not a `None`-check), and boolean `False` preservation in normalize is correct. Mypy strict and ruff pass cleanly.

Two blockers were found and runtime-verified:

1. The `exec()` sandbox allows a full escape to `os.system` via `getattr` + `__subclasses__()` traversal. The sandbox is not meaningfully effective once `getattr` is in the allowlist.
2. `plan.py` always exits with code `1` regardless of success or failure — the stub is broken for any caller that checks exit codes.

Four major issues exist: the underscore-to-dot substitution silently produces wrong model names for all 3-part Odoo models (`sale.order.line`, `account.move.line`, `product.template.attribute.value`, etc.), `children()` silently drops unrecognized items, `sorted()` on m2x fields can crash with `TypeError` on mixed-type lists, and the module extraction uses a `or`-idiom that creates a dead fallback branch.

---

## BLOCKER Issues

### BL-01: exec() sandbox escape via getattr + \_\_subclasses\_\_() traversal

**File:** `src/godoo_stateman/dsl/eval.py:50-84`

**Issue:** `getattr` is in `_SAFE_BUILTINS`. Any Python object's `__mro__` chain leads to `object`, whose `__subclasses__()` returns all live subclasses. Their `__init__.__globals__` dicts contain a reference to the real `__builtins__` module/dict, which carries `__import__`. This chain was runtime-verified to reach `os.system`:

```python
# This runs inside the exec() sandbox and succeeds:
_subs = getattr(getattr(list, '__mro__')[1], '__subclasses__')()
for _cls in _subs:
    _g = getattr(getattr(_cls, '__init__', None), '__globals__', None)
    if _g and isinstance(_g.get('__builtins__'), dict) and '__import__' in _g['__builtins__']:
        _os = _g['__builtins__']['__import__']('os')
        escaped = getattr(_os, 'system')
        break
```

The sandbox docstring claims "Missing keys such as `__import__`, `open`, `eval`, and `exec` are absent — any config attempting to call them receives a `NameError`." This is false: they are reachable via the object graph.

**Context:** The CLAUDE.md design document states "config author is a trusted party," which mitigates the risk significantly. However the sandbox comment actively misleads anyone reviewing or auditing the code. If this surface ever changes scope (e.g. accepting configs from less-trusted sources), the false safety claim is a liability.

**Fix options (pick one based on actual threat model):**

Option A — Remove `getattr`, `hasattr`, and `isinstance` from `_SAFE_BUILTINS` and update the docstring to accurately state the limitation. This breaks some DSL expressiveness but restores the "no I/O" claim.

Option B — Keep `getattr` but update the docstring to accurately describe the trust boundary: "This sandbox is not a security barrier against malicious configs. It only prevents accidental use of common I/O functions by trusted authors."

Option C — Add `__builtins__: {}` to the exec globals AND set `__globals__` to a frozen dict on any callables in the namespace. This is the approach RestrictedPython takes; complex to maintain.

The minimum acceptable fix is **Option B** — replace the misleading comment before the docstring claim causes a false security assumption downstream:

```python
#: NOTE: This is NOT a security sandbox against malicious config authors.
#: ``getattr`` in the allowlist enables full object-graph traversal to
#: reach the real builtins. This allowlist only prevents *accidental* use
#: of I/O functions by trusted DSL authors (see CLAUDE.md trusted-author
#: constraint). Do not expand scope to untrusted input without a full
#: sandbox solution (e.g. a subprocess with no imports + seccomp).
_SAFE_BUILTINS: dict[str, object] = {
    ...
}
```

---

### BL-02: plan.py always exits with code 1 regardless of success

**File:** `src/godoo_stateman/cli/commands/plan.py:32`

**Issue:** Line 32 unconditionally raises `typer.Exit(code=1)` after printing a successful evaluation summary. Any caller or CI script that checks the exit code of `godoo-stateman plan` will treat a successful evaluation as a failure.

```python
console.print("[yellow]Full plan output: Phase 3[/yellow]")
raise typer.Exit(code=1)   # <-- BUG: should be code=0 for success
```

**Fix:**

```python
console.print("[yellow]Full plan output: Phase 3[/yellow]")
raise typer.Exit(code=0)
```

---

## MAJOR Issues

### MA-01: ResourceProxy and DataProxy produce wrong model names for all 3-segment Odoo models

**File:** `src/godoo_stateman/dsl/context.py:123, 158`

**Issue:** `model_name.replace("_", ".", 1)` substitutes only the first underscore, so any Odoo model with three or more name segments is silently silently mis-translated:

| DSL expression | Produced model | Correct model |
|---|---|---|
| `resource.sale_order_line(...)` | `"sale.order_line"` | `"sale.order.line"` |
| `resource.account_move_line(...)` | `"account.move_line"` | `"account.move.line"` |
| `resource.product_template_attribute_value(...)` | `"product.template_attribute_value"` | `"product.template.attribute.value"` |

No error is raised. The wrong model name silently propagates into `ResourceNode.model`, which is then used in schema lookups, xmlid construction, and Odoo API calls in later phases. The bug only manifests at plan/apply time as a cryptic Odoo error.

The `children()` helper docstring already uses `"sale.order.line"` as its example of a 3-part model name (context.py:210), confirming this is a real intended use case — but it must be passed as the string argument to `children()`, not via `resource.sale_order_line`.

**Fix:** Replace `replace("_", ".", 1)` with a full replacement, or document the constraint as a hard limitation with a clear user-facing error:

```python
# Option A — full replacement (DSL authors use underscores throughout):
model = model_name.replace("_", ".")

# Option B — keep 1-replacement but validate and raise:
model = model_name.replace("_", ".", 1)
if "_" in model:
    raise ValueError(
        f"Model '{model_name}' cannot be expressed via attribute access — "
        f"use resource['sale.order.line']('slug', ...) for 3-segment models"
    )
```

Option A is simpler but changes the translation convention. Option B keeps backwards compatibility and surfaces the error immediately. Either requires updating the D-03 documentation.

---

### MA-02: sorted() call on many2many/one2many fields crashes with TypeError on mixed-type content

**File:** `src/godoo_stateman/dsl/normalize.py:48`

**Issue:** `sorted(list(value))` is called unconditionally for all `many2many` and `one2many` fields. If the DSL author mixes types in the list (e.g. `category_ids = [3, "ref_string", 1]`) or passes resource proxy objects as elements, `sorted()` raises `TypeError: '<' not supported between instances of 'str' and 'int'`. This is an unhandled exception that bubbles out of `normalize()` as an internal crash with no user-facing context about which field or resource caused the failure.

```python
return sorted(list(value))   # crashes if items are not mutually comparable
```

**Fix:**

```python
try:
    return sorted(list(value))
except TypeError as exc:
    raise ValueError(
        f"Field value for a many2many/one2many field contains non-sortable items: "
        f"{value!r}"
    ) from exc
```

A better long-term fix is to validate that m2x list items are integers at this stage, but the immediate fix is a wrapped error with context.

---

### MA-03: children() silently drops unrecognized items — data loss with no diagnostic

**File:** `src/godoo_stateman/dsl/context.py:217-222`

**Issue:** The `else: silently skip` branch in `children()` means that if a DSL author passes any non-`_ResourceBuilder`/non-`ResourceNode` item in `children_list` (e.g. a `DataSourceNode`, a plain dict, or a `None`), it is silently dropped from the output with no error or warning. The resulting `ChildrenWrapper` will have fewer children than declared, and the discrepancy is not surfaced until much later (if at all).

```python
for item in children_list:
    if isinstance(item, _ResourceBuilder):
        resolved.append(item._node)
    elif isinstance(item, ResourceNode):
        resolved.append(item)
    # else: silently skip unrecognized items (defensive)
```

**Fix:** Replace the silent skip with an explicit error:

```python
    else:
        raise TypeError(
            f"children() received an unexpected item type {type(item).__name__!r}. "
            f"Each child must be a resource call result "
            f"(e.g. resource.sale_order_line('slug', ...))."
        )
```

---

### MA-04: module extraction uses 'or'-idiom that masks falsy-module values and is partly dead code

**File:** `src/godoo_stateman/dsl/eval.py:191`

**Issue:** `exec_locals.get("module") or exec_globals.get("module")` uses Python's truthiness short-circuit. If `module` is set to any falsy non-None value in `exec_locals` (e.g. `module = 0` or `module = False`), the `or` falls through to `exec_globals`, which never has a `"module"` key (since `dsl_ns` does not include one). The `exec_globals` fallback is therefore dead code in practice — it can never return a useful value.

More importantly, a DSL author who accidentally writes `module = 0` gets `MissingModuleError` with the message "must declare: module = `<name>`" when they *did* declare it — just with a wrong type. The error message is confusing in that case.

The `or`-idiom also creates a latent risk: if `dsl_ns` ever acquires a key named `"module"` in the future, the fallback would silently pick it up for any config with `module = 0`.

**Fix:**

```python
# Check exec_locals first (module-level assignments go there with separate globals/locals).
# exec_globals fallback is preserved for completeness (see Pitfall 2 in module docstring)
# but in practice dsl_ns has no 'module' key so it always returns None.
_module_locals = exec_locals.get("module")
_module_globals = exec_globals.get("module")
module: object = _module_locals if _module_locals is not None else _module_globals
if not isinstance(module, str) or not module:
    raise MissingModuleError(
        f'Config file {path} must declare: module = "<name>" (got {module!r})'
    )
```

This uses `is not None` instead of truthiness, provides a clearer error message with the actual value, and the intent of the two-dict lookup is preserved without the `or`-masking.

---

## MINOR Issues

### MI-01: test_restricted_builtins_blocks_import accepts ImportError but documents NameError

**File:** `tests/unit/dsl/test_eval.py:128-129`

**Issue:** The test comment says "import statement uses `__import__` under the hood; absent from `_SAFE_BUILTINS`" and implies a `NameError`. On Python 3.14 (the target runtime, verified), `import os` inside `exec()` with no `__import__` raises `ImportError: __import__ not found`, not `NameError`. The test correctly accepts both via `pytest.raises((NameError, ImportError))`, but the comment is inaccurate and could mislead a future maintainer who tries to tighten the `except` clause.

**Fix:** Update the comment to reflect the actual runtime behavior:

```python
# On CPython 3.14, 'import os' inside exec() with __import__ absent raises
# ImportError ("__import__ not found"), not NameError. Both are accepted defensively.
with pytest.raises((NameError, ImportError)):
    eval_config(path)
```

---

### MI-02: _ResourceBuilder._RESERVED frozenset does not protect all private attributes

**File:** `src/godoo_stateman/dsl/context.py:68`

**Issue:** `_RESERVED = frozenset({"_node", "_fields"})`. Other dunder and private attributes (`__class__`, `__dict__`, `__enter__`, `__exit__`) are not in `_RESERVED`, so `r.__class__ = SomeClass` from a DSL config would route through `__setattr__` and be written to `_fields` instead of raising an error (Python allows writing `__class__` as a regular key to a dict). This is not exploitable under the trusted-author constraint but is inconsistent with the stated intent of the guard.

**Fix:** Either expand `_RESERVED` to protect dunder names, or add a check in `__setattr__`:

```python
def __setattr__(self, name: str, value: Any) -> None:
    if name in _ResourceBuilder._RESERVED or name.startswith("__"):
        object.__setattr__(self, name, value)
    else:
        self._fields[name] = value
```

---

### MI-03: many2one normalization silently passes through non-2-element tuples/lists

**File:** `src/godoo_stateman/dsl/normalize.py:54-55`

**Issue:** The `many2one` branch handles `(id, name)` tuples but only when `len(value) == 2`. A DSL author who writes `parent_id = (42,)` (single-element tuple) or `parent_id = [42, "Name", "extra"]` (3-element list) gets a silent passthrough. The diff stage in Phase 3 will then compare a tuple/list against an integer from Odoo, producing a spurious diff on every run.

```python
if isinstance(value, (list, tuple)) and len(value) == 2:
    return int(value[0])
return value   # silent passthrough for wrong-length sequences
```

**Fix:**

```python
if isinstance(value, (list, tuple)):
    if len(value) == 2:
        return int(value[0])
    raise ValueError(
        f"many2one field value must be an int or a 2-element (id, name) sequence, "
        f"got {len(value)}-element {type(value).__name__}: {value!r}"
    )
return value
```

---

### MI-04: config_parameters allows silent duplicate keys

**File:** `src/godoo_stateman/dsl/context.py:178`

**Issue:** `ConfigParameterProxy.__setitem__` appends a new dict entry each time. If a DSL author sets the same key twice:

```python
mail.config["web.base.url"] = "https://staging.example.com"
mail.config["web.base.url"] = "https://prod.example.com"
```

Both entries appear in `config_parameters` with the same key and different values. No error is raised. The apply stage will receive two conflicting instructions for the same `ir.config_parameter` key, and behavior depends on whichever the apply loop processes last — non-deterministic if iteration order is not guaranteed.

**Fix:** Validate uniqueness at set time:

```python
def __setitem__(self, key: str, value: str) -> None:
    existing_keys = {entry["key"] for entry in self._collector.config_parameters}
    if key in existing_keys:
        raise ValueError(
            f"Duplicate config_parameter key {key!r}. "
            f"Each key may only be set once per config file."
        )
    self._collector.config_parameters.append({"key": key, "value": value})
```

---

## NIT Issues

### NI-01: ResourceNode.fields and DataSourceNode.selector are mutable dicts in frozen dataclasses

**File:** `src/godoo_stateman/dsl/types/nodes.py:27, 41`

**Issue:** `@dataclass(frozen=True)` prevents attribute reassignment but does not prevent mutation of the dict contents. The `ResourceNode` docstring acknowledges this: "Mutation of the dict contents is possible but undocumented behaviour; callers should treat the dict as logically immutable." The same is true for `DesiredState.config_parameters: tuple[dict[str, str], ...]` — each inner dict is mutable.

This is documented and accepted, but `normalize.py` already creates new dicts via `dataclasses.replace(node, fields=normalized_fields)` rather than mutating in place, which is the correct pattern. Consider adding a `__post_init__` that wraps `fields` in `types.MappingProxyType` for a deeper immutability guarantee, or leave as-is if the documentation is considered sufficient.

**Fix (optional):** No action required if the documented convention is enforced by code review. If desired:

```python
from types import MappingProxyType

@dataclass(frozen=True)
class ResourceNode:
    ...
    def __post_init__(self) -> None:
        # Wrap fields in a read-only proxy. Callers must use dataclasses.replace().
        object.__setattr__(self, "fields", MappingProxyType(self.fields))
```

Note: This would break `_ResourceBuilder.__init__` which holds a mutable reference to `node.fields` and writes to it via `self._fields[name] = value`. The builder pattern would need refactoring.

---

### NI-02: test_eval_purity_no_odoo_calls patches a module that may not be installed

**File:** `tests/unit/dsl/test_eval.py:221`

**Issue:** `patch("godoo.client.client.OdooClient", side_effect=_fail_on_odoo)` will succeed even if `godoo-client` is not installed, because `unittest.mock.patch` creates the attribute path if needed. However, if `godoo-client` is not installed and `eval_config` never imports from it, the patch is a no-op that tests nothing. The test correctly verifies the result is correct, but the guard itself may be hollow in environments where `godoo-client` is not a dev dependency.

**Fix:** Add an import guard to ensure the patch target exists:

```python
try:
    import godoo.client.client  # noqa: F401
    _GODOO_CLIENT_AVAILABLE = True
except ImportError:
    _GODOO_CLIENT_AVAILABLE = False

# In the test:
if _GODOO_CLIENT_AVAILABLE:
    with patch("godoo.client.client.OdooClient", side_effect=_fail_on_odoo):
        state = eval_config(path)
else:
    state = eval_config(path)  # still verifies purity via result check
```

---

## Findings Summary Table

| ID | Severity | File | Line | Issue |
|----|----------|------|------|-------|
| BL-01 | BLOCKER | `dsl/eval.py` | 50-84 | exec() sandbox escapable via getattr+__subclasses__; docstring claims are false |
| BL-02 | BLOCKER | `cli/commands/plan.py` | 32 | Always exits with code 1, even on success |
| MA-01 | MAJOR | `dsl/context.py` | 123, 158 | 3-segment Odoo models silently mis-translated (sale.order.line → sale.order_line) |
| MA-02 | MAJOR | `dsl/normalize.py` | 48 | sorted() on m2x field crashes with TypeError on mixed-type lists |
| MA-03 | MAJOR | `dsl/context.py` | 217-222 | children() silently drops unrecognized items — data loss, no diagnostic |
| MA-04 | MAJOR | `dsl/eval.py` | 191 | 'or'-idiom in module extraction masks falsy values; exec_globals fallback is dead code |
| MI-01 | MINOR | `tests/unit/dsl/test_eval.py` | 128 | Test comment says NameError; Python 3.14 raises ImportError for blocked import |
| MI-02 | MINOR | `dsl/context.py` | 68 | _RESERVED does not guard dunder names in __setattr__ |
| MI-03 | MINOR | `dsl/normalize.py` | 54-55 | Non-2-element many2one sequences pass through silently; cause spurious diff |
| MI-04 | MINOR | `dsl/context.py` | 178 | config_parameters allows duplicate keys with no error |
| NI-01 | NIT | `dsl/types/nodes.py` | 27, 41 | Mutable dicts inside frozen dataclasses — documented but not enforced |
| NI-02 | NIT | `tests/unit/dsl/test_eval.py` | 221 | Purity guard patch may be hollow if godoo-client not installed |

---

## What Is Correct

The following areas were specifically scrutinized and found correct:

- **Cycle detection** (`graph.py:108-117`): `nx.find_cycle()` is correctly wrapped in `try/except nx.NetworkXNoCycle`. The `None`-check pitfall documented in RESEARCH.md is not present.
- **Boolean False preservation** (`normalize.py:57-61`): `ttype == "boolean"` is correctly exempted from the `False → None` scalar rule. The A1 decision is correctly implemented and tested.
- **exec locals/globals split** (`eval.py:186-191`): The Pitfall 2 note is addressed — `exec_locals` is checked before `exec_globals` (see MA-04 for the `or`-idiom concern, which is correctness-adjacent, not a crash).
- **`_flatten` dedup logic** (`eval.py:113-119`): `id(child)` tracking is correct within a single `eval_config()` call where no GC reclaim occurs. Prefixed child copies get fresh `ResourceNode` objects with different IDs, preventing false dedup.
- **Purity invariant** (`eval.py:158-204`): No Odoo I/O in the entire DSL pipeline. All proxy objects are in-process with no async.
- **NetworkX DAG topology** (`graph.py:85-103`): Three edge sources (parent_slug, Deferred.deps, direct .slug refs) are all correctly wired. The duplicate parent→child edge from `inverse_field` (a `ResourceNode` in child.fields that has a `.slug`) is benign since NetworkX deduplicates edges.
- **`from __future__ import annotations`**: Present in all source files.
- **Mypy strict + ruff**: Clean on all reviewed files.

---

_Reviewed: 2026-05-26_
_Reviewer: Claude (gsd-code-reviewer), depth=deep_
_Commit range: 5faf39f..HEAD (23 commits)_
