# Phase 03 — Deferred Items (out-of-scope discoveries during execution)

These issues were discovered during plan 03-05 execution but live in files NOT
modified by 03-05 (they were introduced in prior waves 03-02/03-03/03-04 and are
already committed on develop). Per the SCOPE BOUNDARY rule they are logged here
rather than fixed inline. They cause `ruff check .` (the CI lint command) to fail
with 5 errors and should be addressed by a follow-up quick task before the phase
verifier runs, or folded into a cleanup commit.

## Pre-existing ruff failures (discovered 2026-05-27 during 03-05)

| File | Line | Rule | Description |
|------|------|------|-------------|
| `src/godoo_stateman/live/livestate.py` | 101 | I001 | Import block is un-sorted or un-formatted |
| `src/godoo_stateman/live/seam.py` | 30 | I001 | Import block is un-sorted or un-formatted (TYPE_CHECKING block) |
| `src/godoo_stateman/plan/types.py` | 21 | UP042 | `class PlanAction(str, Enum)` should use `enum.StrEnum` (Python 3.11+) |
| `tests/unit/test_seam.py` | 18 | F401 | `unittest.mock.call` imported but unused |
| `tests/unit/test_seam.py` | 76 | F841 | Local variable `state` assigned but never used |

**Why not fixed in 03-05:** 03-05's declared `files_modified` are only
`import_.py` and `test_plan_import.py`. These 5 issues are in unrelated prior-wave
files (zero git diff vs HEAD for them at 03-05 start). Fixing them would be a
drive-by scope expansion. The 03-05 files themselves are ruff- and mypy-clean.

**Note on UP042:** changing `(str, Enum)` to `StrEnum` is a behavioral-adjacent
change (StrEnum `__str__`/`__format__` differ subtly from `(str, Enum)`); it needs
its own verification rather than a blind autofix, hence deferral.
