---
phase: 02-dsl-eval-pure-pipeline
reviewed: 2026-05-26T21:00:00Z
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
  warning: 0
  info: 1
  total: 1
status: passed
---

# Phase 02: Code Review Report — Convergence Re-Review

**Reviewed:** 2026-05-26T21:00:00Z
**Depth:** deep
**Files Reviewed:** 13
**Status:** passed (zero blocker/warning findings; one info nit)

## Summary

Convergence re-review after remediation of all issues from the prior pass. All
previously-reported findings are confirmed resolved. The pure-pipeline (eval →
normalize → graph) is correct, internally consistent, and fully tested at 55/55
passing.

**Verified fixes:**

- **WR-01** (encoding): `eval_config()` now reads with `encoding="utf-8"` at
  `eval.py:205`. Confirmed fixed.
- **WR-02** (duplicate slugs): `eval_config()` runs a `seen_slugs` uniqueness
  check over the full flat resource list after `_flatten()` (`eval.py:234-241`),
  raising `DslEvalError` on collision. Covered by three tests:
  `test_duplicate_slug_top_level_raises`, `test_duplicate_slug_children_raises`,
  and `test_distinct_slugs_pass`. Confirmed fixed.
- **IN-01** (pytest import): `import pytest` is at the top of `test_deferred.py`
  (line 9), consistent with all other test files. Confirmed fixed.
- **IN-02** (_flatten comment): The comment at `eval.py:144-148` now explicitly
  distinguishes the original pre-rebuild parent from the rebuilt parent and
  documents the Phase 3 obligation. Confirmed fixed.

**Cross-module analysis (deep pass) — no new issues:**

- `_flatten()` identity-tracking via `id()` is correct: the `child_node_ids` set
  tracks the exact Python objects appended to the collector at call time; the
  promoted copies are fresh `ResourceNode` instances with new identities.
- The post-condition ChildrenWrapper guard in `_flatten()` (lines 171-177) catches
  nested children correctly: promoted child nodes inherit the original child's
  `fields` dict (including any nested `ChildrenWrapper`), which will be found in
  the `flat` iteration and raise `ValueError` with a clear message before
  `DesiredState` is constructed.
- `resolve()` deduplication via `frozenset(deps)` is correct and harmless
  (repeated slugs yield a single DAG edge, which `nx.DiGraph.add_edge` handles
  idempotently).
- `build_graph()` cycle detection uses `except nx.NetworkXNoCycle` (not a
  `None`-check) — correct per Pitfall 1.
- `normalize()` with `snapshot=None` returns the input state unchanged via
  identity (`return state`), verified by `test_snapshot_none_returns_unchanged`.
- `_normalize_value()` boolean carve-out is correct: `ttype == "boolean"` returns
  `value` unchanged before the scalar `False → None` rule, preserving
  `active=False` as the archive intent.
- `plan.py` stub catches only `DslEvalError` — `CycleError` and `normalize()` are
  not called in the stub; this is correct scope for Phase 2 and no gap exists here.
- `DesiredState.config_parameters` is `tuple[dict[str, str], ...]` — individual
  dicts are mutable but the tuple prevents append; this matches the documented
  caveat and is not a defect.

## Structural Findings (fallow)

No structural pre-pass was provided for this review.

## Narrative Findings (AI reviewer)

## Info

### IN-01: Test helper `_write_config` writes without explicit encoding on Windows

**File:** `tests/unit/dsl/test_eval.py:27`
**Issue:** The `_write_config` helper calls `config_path.write_text(content)` without
`encoding="utf-8"`. On this development machine the default encoding is `cp1252`.
`eval_config()` reads with `encoding="utf-8"`. For all current test strings (pure
ASCII), both encodings are byte-identical, so no test failure occurs today. However,
if a future test adds non-ASCII characters to a config string (e.g., a name in a
non-Latin script), `write_text` would encode it as cp1252 and `eval_config` would
misread it as UTF-8 — producing a `UnicodeDecodeError` or garbled content that only
manifests on Windows, not on CI (which typically runs on Linux where the default
is UTF-8).

**Fix:**
```python
config_path.write_text(content, encoding="utf-8")
```

---

_Reviewed: 2026-05-26T21:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
