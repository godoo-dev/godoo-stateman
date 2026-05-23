---
phase: quick-260523-uda
plan: 01
subsystem: ci-cd
tags: [ci, github-actions, docs, mkdocs, semantic-release, uv]
dependency_graph:
  requires: []
  provides: [ci-pipeline, docs-deploy, release-workflow, mkdocs-scaffold]
  affects: [pyproject.toml, uv.lock]
tech_stack:
  added: [pytest-cov>=6, mkdocs-material>=9, mkdocstrings[python]>=0.27, python-semantic-release>=9]
  patterns: [github-actions, uv-no-sources, oidc-publish, mkdocstrings]
key_files:
  created:
    - .github/workflows/test.yml
    - .github/workflows/release.yml
    - .github/workflows/docs.yml
    - mkdocs.yml
    - docs/index.md
    - .python-version
  modified:
    - pyproject.toml
    - uv.lock
decisions:
  - "uv sync --no-sources (without --locked) used in CI — the committed uv.lock uses editable local sources, so --locked is incompatible with --no-sources; CI re-resolves from PyPI on each run, which is acceptable"
  - "release.yml is workflow_dispatch-only (DISABLED) until package is publish-ready; re-enable instructions documented in the file header comment"
  - "ODOO_VERSION injected as job-level env var in integration job — godoo-testcontainers reads it via os.environ.get() in container.py, no conftest changes needed"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-23"
  tasks_completed: 3
  files_changed: 8
---

# Quick Task 260523-uda: Add CI/CD, Test, Release, and Docs Workflows

One-liner: GitHub Actions CI pipeline (lint + unit-tests + integration matrix 17/18/19), disabled release workflow with OIDC PyPI publish, MkDocs material docs scaffold, plus four new dev deps and semantic-release config.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Update pyproject.toml dev deps + semantic_release config; create .python-version; regenerate uv.lock | 3a8bc7a | pyproject.toml, .python-version, uv.lock |
| 2 | Create .github/workflows/test.yml | e6d766f | .github/workflows/test.yml |
| 3 | Create release.yml, docs.yml, mkdocs scaffold | ef0cee6 | .github/workflows/release.yml, .github/workflows/docs.yml, mkdocs.yml, docs/index.md |

## Key Decisions

### uv --no-sources Interaction with uv.lock

The committed `uv.lock` uses editable local source entries for godoo-* packages (`editable = "../godoo-py/packages/..."`) because `[tool.uv.sources]` redirects them during local dev. On CI, `uv sync --no-sources` re-resolves these from PyPI instead of local paths — but because the lockfile has local source entries, `--locked` and `--frozen` are incompatible with `--no-sources` (uv errors with "lockfile needs to be updated"). The CI workflow uses plain `uv sync --no-sources` (no `--locked`), which re-resolves on each run. This is intentional and correct — PyPI versions (godoo-client 0.2.0, godoo-introspection 0.2.0, godoo-testcontainers 0.2.0) match the pinned constraints.

Both modes verified locally:
- `uv sync --no-sources` — resolves godoo-* from PyPI at 0.2.0 (CI mode)
- `uv sync` — restores local editable sources from ../godoo-py/packages/* (dev mode)

### release.yml Disabled by Design

The release workflow uses `workflow_dispatch:` as the sole trigger. No push/tag/workflow_run trigger is active. The file header includes commented instructions for re-enabling automatic releases after a successful test run. The `pypi` environment protection rules in GitHub Settings must be configured before the first manual trigger.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None beyond what the plan's threat model already covers (T-ci-01 through T-ci-SC all mitigated as designed).

## Self-Check

- [x] .python-version exists and contains "3.14"
- [x] pyproject.toml has all 4 new dev deps and [tool.semantic_release]
- [x] uv.lock regenerated (140174 bytes)
- [x] .github/workflows/test.yml — valid YAML, lint/unit-tests/integration jobs, matrix 17.0/18.0/19.0, fail-fast:false, all jobs use --no-sources
- [x] .github/workflows/release.yml — valid YAML, workflow_dispatch only, DISABLED comment, workflow_run re-enable instructions
- [x] .github/workflows/docs.yml — valid YAML, push to main trigger, mkdocs gh-deploy step
- [x] mkdocs.yml — valid YAML, material theme, mkdocstrings plugin
- [x] docs/index.md — exists with project description
- [x] uv.lock committed in same commit as pyproject.toml (lockfile discipline)
- [x] [tool.uv.sources] unchanged (local dev paths preserved)
- [x] tests/conftest.py unchanged (ODOO_VERSION picked up via os.environ automatically)

## Self-Check: PASSED
