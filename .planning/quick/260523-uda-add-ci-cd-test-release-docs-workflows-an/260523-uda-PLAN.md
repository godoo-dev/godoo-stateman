---
phase: quick-260523-uda
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .python-version
  - pyproject.toml
  - uv.lock
  - .github/workflows/test.yml
  - .github/workflows/release.yml
  - .github/workflows/docs.yml
  - mkdocs.yml
  - docs/index.md
autonomous: true
requirements: []

must_haves:
  truths:
    - ".github/workflows/test.yml exists with lint, unit-tests, and integration jobs"
    - "integration job matrix covers 17.0, 18.0, 19.0 with fail-fast: false"
    - "All CI uv/pytest commands use --no-sources flag"
    - "release.yml triggers ONLY on workflow_dispatch (cannot auto-fire)"
    - "docs.yml builds mkdocs-material and deploys to GitHub Pages"
    - "mkdocs.yml and docs/index.md exist as a minimal scaffold"
    - ".python-version pins 3.14"
    - "pyproject.toml has [tool.semantic_release] config and dev deps updated"
    - "uv.lock is regenerated and committed alongside pyproject changes"
  artifacts:
    - path: ".github/workflows/test.yml"
      provides: "CI pipeline with lint, unit-tests, integration jobs"
    - path: ".github/workflows/release.yml"
      provides: "Disabled release workflow (workflow_dispatch only)"
    - path: ".github/workflows/docs.yml"
      provides: "Docs deploy workflow for GitHub Pages"
    - path: "mkdocs.yml"
      provides: "MkDocs material theme config with mkdocstrings"
    - path: "docs/index.md"
      provides: "Minimal docs landing page"
    - path: ".python-version"
      provides: "Python version pin for tooling"
    - path: "pyproject.toml"
      provides: "Updated dev deps, semantic_release config, pytest-cov"
    - path: "uv.lock"
      provides: "Regenerated lockfile matching updated deps"
  key_links:
    - from: "test.yml integration job"
      to: "conftest.py TestHarness"
      via: "ODOO_VERSION env var (read by os.environ.get('ODOO_VERSION') in container.py)"
      pattern: "ODOO_VERSION"
    - from: "test.yml all jobs"
      to: "pyproject.toml [tool.uv.sources]"
      via: "--no-sources flag bypasses local path sources"
      pattern: "--no-sources"
    - from: "release.yml"
      to: "pyproject.toml [tool.semantic_release]"
      via: "version_toml config"
      pattern: "version_toml"
    - from: "docs.yml"
      to: "mkdocs.yml + docs/index.md"
      via: "mkdocs gh-deploy"
      pattern: "mkdocs"
---

<objective>
Add GitHub Actions CI/CD, docs workflow, and mkdocs scaffold for godoo-stateman.

Purpose: Establish automated quality gates (lint, unit tests, integration tests against real Odoo) and a publishing pipeline (disabled release, live docs) mirroring godoo-py patterns but adapted to a single-package project.

Output:
- .github/workflows/test.yml — CI pipeline (lint + unit-tests + integration matrix)
- .github/workflows/release.yml — disabled release workflow (workflow_dispatch only)
- .github/workflows/docs.yml — docs deploy to GitHub Pages
- mkdocs.yml + docs/index.md — minimal MkDocs scaffold
- .python-version — pins 3.14
- pyproject.toml — updated dev deps (pytest-cov, mkdocs-material, mkdocstrings, python-semantic-release) + [tool.semantic_release] config
- uv.lock — regenerated
</objective>

<execution_context>
@/home/marc/.claude/get-shit-done/workflows/execute-plan.md
@/home/marc/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@pyproject.toml
@tests/conftest.py

<interfaces>
<!-- Key facts extracted from codebase inspection. Executor uses these directly. -->

From pyproject.toml:
- Runtime: godoo-client>=0.2.0, godoo-introspection>=0.2.0 (already pinned, PyPI-resolvable)
- Dev group: godoo-testcontainers>=0.2.0 (already pinned, PyPI-resolvable)
- [tool.uv.sources]: maps all three godoo-* to local ../godoo-py/packages/* paths
- [tool.pytest.ini_options]: integration marker already registered — no change needed
- [tool.mypy]: strict=true, python_version="3.14", disallow_untyped_defs=true
- [tool.ruff.lint]: select=["E","F","W","I","UP","B","SIM","TCH","RUF"]
- src layout: src/godoo_stateman (single package — mypy target is this path, NOT packages/*)

From tests/conftest.py:
- TestHarness(snapshot=True) — no explicit Odoo version argument
- ODOO_VERSION is read from os.environ in container.py via os.environ.get("ODOO_VERSION")
- Setting env var ODOO_VERSION in the integration job is sufficient; conftest needs NO changes

From godoo-testcontainers source:
- TestHarness accepts: env: dict[str, str] | None — but ODOO_VERSION is read directly from os.environ, not passed via env param
- The integration job must export ODOO_VERSION as a job-level env var
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update pyproject.toml dev deps and add semantic_release config; create .python-version; regenerate uv.lock</name>
  <files>pyproject.toml, .python-version, uv.lock</files>
  <action>
    Make the following changes to pyproject.toml:

    1. Add to [dependency-groups] dev group (append after existing entries):
       - "pytest-cov>=6"
       - "mkdocs-material>=9"
       - "mkdocstrings[python]>=0.27"
       - "python-semantic-release>=9"

    2. Add a new [tool.semantic_release] section at the end of pyproject.toml:

       [tool.semantic_release]
       version_toml = ["pyproject.toml:project.version"]
       commit_message = "chore(release): v{version}"
       branch = "main"
       allow_zero_version = true
       major_on_zero = false

       [tool.semantic_release.commit_parser_options]
       allowed_tags = ["feat", "fix", "chore", "docs", "style", "refactor", "perf", "test", "build", "ci"]
       minor_tags = ["feat"]
       patch_tags = ["fix", "perf"]

    Do NOT change [tool.uv.sources] — local paths stay intact for dev use.
    Do NOT change runtime dependencies or any existing tool configs.

    Create .python-version file containing exactly one line: "3.14"

    After both file edits, regenerate uv.lock by running:
      uv sync --no-sources
    This resolves from PyPI (ignores local path sources) and regenerates uv.lock in the project root. Run from the project root (C:\dev\godoo-dev\godoo-stateman). If uv is not on PATH, use: py -m uv sync --no-sources or find uv via `where uv`.
    After sync succeeds, verify uv.lock was modified (git status will show it changed or untracked).
  </action>
  <verify>
    <automated>
      python -c "import tomllib; d=tomllib.load(open('pyproject.toml','rb')); devd=' '.join(d['dependency-groups']['dev']); assert 'pytest-cov' in devd and 'mkdocs-material' in devd and 'mkdocstrings' in devd and 'python-semantic-release' in devd, f'Missing dev deps: {devd}'; sr=d['tool']['semantic_release']; assert sr['branch']=='main', 'Wrong branch'; assert sr['version_toml']==['pyproject.toml:project.version'], 'Wrong version_toml'; print('pyproject OK')"
      python -c "v=open('.python-version').read().strip(); assert v=='3.14', f'Expected 3.14 got {v}'; print('.python-version OK')"
      python -c "import os; assert os.path.exists('uv.lock'), 'uv.lock missing'; print('uv.lock exists')"
    </automated>
  </verify>
  <done>
    pyproject.toml has pytest-cov, mkdocs-material, mkdocstrings[python], python-semantic-release in dev group; [tool.semantic_release] section present with version_toml, branch=main, allow_zero_version=true; .python-version contains "3.14"; uv.lock regenerated and reflects the new deps.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create .github/workflows/test.yml</name>
  <files>.github/workflows/test.yml</files>
  <action>
    Create the directory .github/workflows/ if it doesn't exist, then write .github/workflows/test.yml with EXACTLY the following structure:

    ---
    name: Test

    on:
      push:
        branches: [main, develop]
      pull_request:
        branches: [main]

    concurrency:
      group: ${{ github.workflow }}-${{ github.ref }}
      cancel-in-progress: true

    jobs:
      lint:
        name: Lint
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
          - uses: astral-sh/setup-uv@v6
            with:
              python-version: "3.14"
          # --no-sources: [tool.uv.sources] maps godoo-* to local ../godoo-py/packages/*
          # which do not exist on CI runners. All three packages are on PyPI.
          # --no-sources makes uv resolve from the index instead of local paths.
          - name: Install dependencies
            run: uv sync --no-sources
          - name: Ruff check
            run: uv run --no-sources ruff check .
          - name: Ruff format
            run: uv run --no-sources ruff format --check .
          - name: mypy
            run: uv run --no-sources mypy src/godoo_stateman

      unit-tests:
        name: Unit Tests
        runs-on: ubuntu-latest
        needs: lint
        steps:
          - uses: actions/checkout@v4
          - uses: astral-sh/setup-uv@v6
            with:
              python-version: "3.14"
          - name: Install dependencies
            run: uv sync --no-sources
          - name: Run unit tests
            run: uv run --no-sources pytest -v --cov --cov-report=xml -m "not integration"
          - name: Upload coverage
            uses: codecov/codecov-action@v5
            with:
              files: ./coverage.xml
            env:
              CODECOV_TOKEN: ${{ secrets.CODECOV_TOKEN }}

      integration:
        name: Integration Tests (Odoo ${{ matrix.odoo_version }})
        runs-on: ubuntu-latest
        needs: [lint, unit-tests]
        timeout-minutes: 15
        strategy:
          fail-fast: false
          matrix:
            odoo_version: ["17.0", "18.0", "19.0"]
        env:
          ODOO_VERSION: ${{ matrix.odoo_version }}
        steps:
          - uses: actions/checkout@v4
          - uses: astral-sh/setup-uv@v6
            with:
              python-version: "3.14"
          - name: Install dependencies
            run: uv sync --no-sources
          - name: Run integration tests
            run: uv run --no-sources pytest tests/acceptance -v -s -m integration --log-cli-level=ERROR

    IMPORTANT: Write this as a valid YAML file. No trailing spaces. The ODOO_VERSION env var at job level ensures TestHarness picks it up via os.environ (container.py line 99: os.environ.get("ODOO_VERSION")).
  </action>
  <verify>
    <automated>
      python -c "
import yaml, sys
with open('.github/workflows/test.yml') as f:
    d = yaml.safe_load(f)
jobs = d['jobs']
assert 'lint' in jobs, 'lint job missing'
assert 'unit-tests' in jobs, 'unit-tests job missing'
assert 'integration' in jobs, 'integration job missing'
matrix = jobs['integration']['strategy']['matrix']['odoo_version']
assert set(matrix) == {'17.0', '18.0', '19.0'}, f'Wrong matrix: {matrix}'
assert jobs['integration']['strategy']['fail-fast'] == False, 'fail-fast must be false'
# Verify --no-sources used in install step
steps_text = str(jobs['integration']['steps'])
assert '--no-sources' in steps_text, 'integration job missing --no-sources'
lint_steps = str(jobs['lint']['steps'])
assert '--no-sources' in lint_steps, 'lint job missing --no-sources'
# Verify triggers
triggers = list(d['on'].keys())
assert 'push' in triggers and 'pull_request' in triggers, f'Wrong triggers: {triggers}'
print('test.yml OK')
"
    </automated>
  </verify>
  <done>
    test.yml is valid YAML with lint, unit-tests, and integration jobs; integration matrix covers 17.0/18.0/19.0 with fail-fast: false; all jobs use --no-sources; ODOO_VERSION env var set at integration job level; lint job does not need unit-tests (lint runs in parallel with unit-tests); integration needs both lint and unit-tests.
  </done>
</task>

<task type="auto">
  <name>Task 3: Create release.yml (disabled), docs.yml, mkdocs scaffold</name>
  <files>.github/workflows/release.yml, .github/workflows/docs.yml, mkdocs.yml, docs/index.md</files>
  <action>
    Create THREE files:

    === .github/workflows/release.yml ===

    Write the following content. The key constraint: the ONLY trigger is `workflow_dispatch:` — no push/pull_request/workflow_run triggers. Include a header comment block explaining how to re-enable.

    ---
    # DISABLED for Phase 1 — manual trigger only.
    #
    # This workflow publishes godoo-stateman to PyPI via Trusted Publishing (OIDC).
    # It is disabled until the package is publish-ready.
    #
    # To enable automatic releases after a successful test run, replace the `on:` block below with:
    #
    #   on:
    #     workflow_run:
    #       workflows: ["Test"]
    #       types: [completed]
    #       branches: [main]
    #
    # and update the `if:` condition on the release job accordingly:
    #   if: ${{ github.event.workflow_run.conclusion == 'success' }}
    #
    name: Release

    on:
      workflow_dispatch:

    permissions:
      contents: write
      id-token: write

    jobs:
      release:
        name: Release
        runs-on: ubuntu-latest
        environment: pypi
        steps:
          - uses: actions/checkout@v4
            with:
              fetch-depth: 0
              token: ${{ secrets.GITHUB_TOKEN }}
          - uses: astral-sh/setup-uv@v6
            with:
              python-version: "3.14"
          - name: Install dependencies
            run: uv sync --no-sources
          - name: Run semantic-release
            run: uv run --no-sources semantic-release version
            env:
              GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          - name: Build
            run: uv build
          - name: Publish to PyPI
            run: uv publish --trusted-publishing always

    === .github/workflows/docs.yml ===

    ---
    name: Docs

    on:
      push:
        branches: [main]
        paths:
          - "docs/**"
          - "mkdocs.yml"
          - "src/**"

    permissions:
      contents: write

    jobs:
      deploy:
        name: Deploy Docs
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
            with:
              fetch-depth: 0
          - uses: astral-sh/setup-uv@v6
            with:
              python-version: "3.14"
          - name: Install dependencies
            run: uv sync --no-sources
          - name: Deploy docs
            run: uv run --no-sources mkdocs gh-deploy --force

    === mkdocs.yml ===

    Write a valid mkdocs.yml in the project root:

    site_name: godoo-stateman
    site_description: Terraform for Odoo — declarative Odoo state reconciliation over jsonrpc
    site_url: https://marcfargas.github.io/godoo-stateman/
    repo_url: https://github.com/marcfargas/godoo-stateman
    repo_name: marcfargas/godoo-stateman

    theme:
      name: material
      palette:
        - scheme: default
          toggle:
            icon: material/brightness-7
            name: Switch to dark mode
        - scheme: slate
          toggle:
            icon: material/brightness-4
            name: Switch to light mode
      features:
        - navigation.instant
        - navigation.sections
        - toc.integrate

    plugins:
      - search
      - mkdocstrings:
          handlers:
            python:
              options:
                show_source: true
                docstring_style: google

    nav:
      - Home: index.md
      - API Reference: api/

    === docs/index.md ===

    Create the docs/ directory, then write docs/index.md:

    # godoo-stateman

    **Terraform for Odoo** — declarative, idempotent Odoo state reconciliation over JSON-RPC.

    godoo-stateman evaluates a Python DSL describing desired Odoo state, diffs it against
    a live Odoo instance, and executes a plan of creates/updates/deletes/archives in
    dependency order — without an agent, addon, or sidecar state file.

    ## Installation

    ```bash
    pip install godoo-stateman
    ```

    ## Quick Start

    See the [README](https://github.com/marcfargas/godoo-stateman) for usage examples.

    ## Requirements

    - Python 3.14+
    - Odoo 17+ (Community Edition)
    - Network access to Odoo JSON-RPC endpoint
  </action>
  <verify>
    <automated>
      python -c "
import yaml, sys

# Validate release.yml
with open('.github/workflows/release.yml') as f:
    content = f.read()
    d = yaml.safe_load(content)
on_triggers = list(d['on'].keys()) if isinstance(d['on'], dict) else [d['on']]
assert on_triggers == ['workflow_dispatch'], f'release.yml must have ONLY workflow_dispatch, got: {on_triggers}'
assert 'DISABLED' in content, 'release.yml missing DISABLED header comment'
assert 'workflow_run' in content, 'release.yml missing commented workflow_run re-enable instructions'
assert 'uv publish' in content, 'release.yml missing uv publish step'
assert 'semantic-release version' in content, 'release.yml missing semantic-release step'
print('release.yml OK')

# Validate docs.yml
with open('.github/workflows/docs.yml') as f:
    d2 = yaml.safe_load(f)
assert 'push' in d2['on'], 'docs.yml missing push trigger'
assert 'main' in d2['on']['push']['branches'], 'docs.yml not triggered on main'
assert 'mkdocs gh-deploy' in str(d2['jobs']), 'docs.yml missing mkdocs gh-deploy'
print('docs.yml OK')

# Validate mkdocs.yml
with open('mkdocs.yml') as f:
    d3 = yaml.safe_load(f)
assert d3['theme']['name'] == 'material', 'mkdocs not using material theme'
assert 'mkdocstrings' in str(d3.get('plugins', [])), 'mkdocs missing mkdocstrings plugin'
print('mkdocs.yml OK')

# Validate docs/index.md
import os
assert os.path.exists('docs/index.md'), 'docs/index.md missing'
print('docs/index.md OK')
"
    </automated>
  </verify>
  <done>
    release.yml is valid YAML with ONLY workflow_dispatch trigger, header comment explaining re-enable, semantic-release + uv publish steps intact; docs.yml triggers on push to main for docs/src/mkdocs changes and runs mkdocs gh-deploy; mkdocs.yml uses material theme with mkdocstrings plugin; docs/index.md exists with project description.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| GitHub Actions → PyPI | release.yml publishes via OIDC — no stored secrets |
| GitHub Actions → Odoo container | Integration tests spin up local Docker, no external network trust needed |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-ci-01 | Tampering | release.yml workflow_dispatch | mitigate | workflow_dispatch only — cannot auto-fire; reviewer must approve manual trigger |
| T-ci-02 | Information Disclosure | CODECOV_TOKEN | accept | Token is write-only for coverage upload; no source code access granted |
| T-ci-03 | Elevation of Privilege | OIDC publish to PyPI | mitigate | Scoped to `pypi` environment; environment protection rules enforced in GitHub |
| T-ci-SC | Tampering | New dev deps (pytest-cov, mkdocs-material, mkdocstrings, python-semantic-release) | accept | All four are well-established PyPI packages with long track records; uv.lock pins exact versions |
</threat_model>

<verification>
After all three tasks complete, verify end-to-end CI readiness:

1. All workflow files parse as valid YAML (covered in per-task verify steps).
2. release.yml has EXACTLY one trigger key — workflow_dispatch:
   `python -c "import yaml; d=yaml.safe_load(open('.github/workflows/release.yml')); assert list(d['on'].keys())==['workflow_dispatch']"`
3. integration matrix covers all three versions:
   `python -c "import yaml; d=yaml.safe_load(open('.github/workflows/test.yml')); m=d['jobs']['integration']['strategy']['matrix']['odoo_version']; assert set(m)=={'17.0','18.0','19.0'}"`
4. --no-sources present in test.yml (all jobs):
   `grep -c "\-\-no-sources" .github/workflows/test.yml`
   (should be >= 6: install + ruff check + ruff format + mypy + unit-tests install + integration install)
5. .python-version pins 3.14:
   `python -c "assert open('.python-version').read().strip()=='3.14'"`
6. uv.lock exists and is not empty:
   `python -c "import os; s=os.stat('uv.lock'); assert s.st_size>1000"`
7. pyproject.toml has [tool.semantic_release]:
   `python -c "import tomllib; d=tomllib.load(open('pyproject.toml','rb')); assert 'semantic_release' in d['tool']"`
</verification>

<success_criteria>
- All four CI/CD files exist and pass YAML parse: test.yml, release.yml, docs.yml, mkdocs.yml
- test.yml: lint (runs independently), unit-tests (needs lint), integration (needs lint + unit-tests)
- integration matrix: 17.0, 18.0, 19.0 with fail-fast: false and per-job timeout of 15 min
- All CI commands use --no-sources flag
- ODOO_VERSION env var set at integration job level (wires to container.py os.environ.get)
- release.yml: workflow_dispatch trigger ONLY; DISABLED header comment present; workflow_run re-enable instructions in comment; semantic-release + uv publish steps present
- docs.yml: push to main trigger; mkdocs gh-deploy step present
- mkdocs.yml: material theme; mkdocstrings[python] plugin
- docs/index.md: exists with project description
- .python-version: "3.14"
- pyproject.toml: 4 new dev deps added; [tool.semantic_release] config present; existing configs unchanged
- uv.lock: regenerated and committed alongside pyproject.toml
- No changes to [tool.uv.sources] (local paths preserved for dev)
- No changes to tests/conftest.py (ODOO_VERSION picked up via os.environ automatically)
</success_criteria>

<output>
When complete, create `.planning/quick/260523-uda-add-ci-cd-test-release-docs-workflows-an/260523-uda-SUMMARY.md`
</output>
