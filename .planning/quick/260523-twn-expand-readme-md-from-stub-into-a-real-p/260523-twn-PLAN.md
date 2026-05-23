---
phase: 260523-twn
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [README.md]
autonomous: true
requirements: [QUICK-260523-twn]

must_haves:
  truths:
    - "Reader understands the project goal in one sentence"
    - "Reader knows exactly which commands work today and which are stubs"
    - "Reader can install and run `snapshot` without guessing env vars or args"
    - "No company names or identifying details appear in the public-facing README"
  artifacts:
    - path: "README.md"
      provides: "Full project README accurate to Phase 1 state"
      contains: "snapshot command, env-var table, stub command list, LGPL-3.0-or-later"
  key_links:
    - from: "README.md env-var table"
      to: "src/godoo_stateman/cli/commands/snapshot.py lines 38-64"
      via: "manual accuracy check"
      pattern: "ODOO_URL|ODOO_DB|ODOO_DATABASE|ODOO_USER|ODOO_USERNAME|ODOO_PASSWORD|ODOO_VERSION"
---

<objective>
Expand README.md from its 21-line hatchling-required stub into a complete, accurate
project README reflecting Phase 1 state.

Purpose: PyPI and GitHub consumers need an honest, useful README before the package
is publicly discoverable. Accuracy — especially the clear distinction between the one
working command and the four stubs — is the primary quality criterion.

Output: README.md containing project description, Phase 1 status note, install
instructions, `snapshot` command reference with env-var table, a clear "not yet
implemented" section for stub commands, repo link, and license.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

Source files verified before writing this plan:
- src/godoo_stateman/cli/app.py — registered commands: plan, apply, verify, import, snapshot
- src/godoo_stateman/cli/commands/snapshot.py — sole working command; env-var reading at lines 38-64; ODOO_VERSION default "17.0" at line 59
- src/godoo_stateman/cli/commands/plan.py — stub pattern confirmed (yellow "not yet implemented" + Exit code 1)
- pyproject.toml — Python >=3.14; LGPL-3.0-or-later; version 0.1.0; uv workspace with godoo-py dev paths
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write accurate Phase 1 README.md</name>
  <files>README.md</files>
  <action>
Replace the current 21-line stub entirely with the content below. Every detail must
come from the verified source files — do not invent behavior.

Structure and required content:

1. H1 + one-liner badge line
   Title: `godoo-stateman`
   Tagline: "Terraform for Odoo — declarative Odoo state reconciliation over jsonrpc."
   Badges: PyPI version shield (https://img.shields.io/pypi/v/godoo-stateman), Python
   version shield (3.14+), License shield (LGPL-3.0-or-later). Use standard shields.io
   format pointing to pypi.org/project/godoo-stateman.

2. One-paragraph "What is it?" section (no heading, immediately after badges)
   Cover: evaluates a Python DSL describing desired Odoo state, diffs against live
   Odoo over JSON-RPC, executes creates/updates/deletes/archives in dependency order
   using `ir.model.data` as state — no sidecar file, no Odoo addon, no agent required.
   Abstract any real-world usage context to "a professional services firm" if an
   example is useful; keep it optional, not mandatory.

3. H2: "Status — Early Development"
   State clearly: this is Phase 1 of 6. Only the `snapshot` command is implemented
   today. Commands `plan`, `apply`, `verify`, and `import` are registered but print
   "not yet implemented" and exit with code 1. The schema registry, DSL parser, diff
   engine, and apply engine are planned for subsequent phases. Do not soften or omit
   this — accuracy is mandatory.

4. H2: "Requirements"
   - Python 3.14 or later (hard requirement from the jsonrpc transport dependency)
   - Access to an Odoo 17.0+ instance over HTTP/HTTPS

5. H2: "Installation"
   Production: `pip install godoo-stateman`
   Development setup block using `uv` (matches the godoo-py toolchain):
   ```bash
   git clone https://github.com/godoo-dev/godoo-stateman.git
   cd godoo-stateman
   uv sync --group dev
   ```
   Note: the dev install uses local workspace paths for godoo-py packages
   (configured in pyproject.toml via uv.sources).

6. H2: "Usage"
   H3: "`snapshot` — Capture schema from a live Odoo instance" (this is the only
   working command)

   Brief description: connects to Odoo using credentials from environment variables,
   introspects a fixed set of models (Phase 1: `project.project`, `res.partner`),
   and writes a versioned schema snapshot to the local cache.

   Command syntax:
   ```bash
   godoo-stateman snapshot <config>
   ```
   Where `<config>` is the path to a stateman config `.py` file. (In Phase 1 the
   config path is accepted but only used to establish context; model enumeration
   from config content arrives in Phase 3.)

   H4: "Environment variables"
   Render as a Markdown table with columns: Variable | Aliases | Required | Default | Description

   Rows (derived from snapshot.py lines 38-64 and 59):
   | Variable | Aliases | Required | Default | Description |
   |---|---|---|---|---|
   | `ODOO_URL` | — | Yes | — | Full URL to the Odoo instance (e.g. `https://odoo.example.com`) |
   | `ODOO_DB` | `ODOO_DATABASE` | Yes | — | Database name |
   | `ODOO_USER` | `ODOO_USERNAME` | Yes | — | Odoo login username |
   | `ODOO_PASSWORD` | — | Yes | — | Odoo login password |
   | `ODOO_VERSION` | — | No | `17.0` | Odoo major.minor version (format: `N.N`, e.g. `17.0`) |

   Credentials are read exclusively from environment variables — never passed as CLI
   arguments or stored in the config file.

   Security note (one sentence): connecting over plain HTTP to a non-local host
   causes a warning; use HTTPS in production.

   Usage example:
   ```bash
   export ODOO_URL=https://odoo.example.com
   export ODOO_DB=production
   export ODOO_USER=admin
   export ODOO_PASSWORD=...
   godoo-stateman snapshot my_config.py
   ```

   H3: "Planned commands (not yet implemented)"
   List as a simple bullet list: `plan`, `apply`, `verify`, `import`.
   State that each is registered in the CLI, prints "not yet implemented", and exits
   with code 1 until the relevant phase ships.

7. H2: "Development"
   How to run tests:
   ```bash
   uv run pytest                        # unit tests only
   uv run pytest -m integration         # requires Docker (pulls odoo:17.0 + postgres:15-alpine)
   ```
   Linting and type checking:
   ```bash
   uv run ruff check src tests
   uv run mypy src
   ```

8. H2: "Repository"
   Link: https://github.com/godoo-dev/godoo-stateman

9. H2: "License"
   LGPL-3.0-or-later. See LICENSE file.

Formatting rules:
- All headings use ATX style (#, ##, ###, ####)
- All code blocks have a language tag (bash, python, etc.)
- No HTML tags
- No emojis
- No company names, no firm names, no identifiable real-world entities per the
  confidentiality rule — abstract to "a professional services firm" if any example
  requires a usage context
- English throughout
  </action>
  <verify>
    <automated>python -c "
import re, sys
text = open('README.md').read()
checks = [
    ('snapshot command present', 'godoo-stateman snapshot' in text),
    ('ODOO_URL row', 'ODOO_URL' in text),
    ('ODOO_DB alias row', 'ODOO_DATABASE' in text),
    ('ODOO_USER alias row', 'ODOO_USERNAME' in text),
    ('ODOO_VERSION default 17.0', '17.0' in text),
    ('plan stub noted', 'not yet implemented' in text.lower() or 'planned' in text.lower()),
    ('LGPL license', 'LGPL-3.0-or-later' in text),
    ('repo link', 'github.com/godoo-dev/godoo-stateman' in text),
    ('Python 3.14', '3.14' in text),
    ('no company names', not any(x in text for x in ['BGBL', 'BLEGAL', 'BGA', 'ACM'])),
]
failed = [(name, ok) for name, ok in checks if not ok]
if failed:
    print('FAILED checks:', [n for n, _ in failed])
    sys.exit(1)
print('All checks passed')
"
    </automated>
  </verify>
  <done>README.md accurately describes Phase 1 state: snapshot command documented with full env-var table, stub commands identified as unimplemented, install and dev setup correct, no confidentiality violations, English only.</done>
</task>

</tasks>

<verification>
Run the automated check in the verify block. Additionally:
- `godoo-stateman --help` should list the same commands as the README documents
- Skim the file for any company/firm names — none should appear
</verification>

<success_criteria>
README.md is a complete, honest, accurate Phase 1 README:
- One-liner + badges at the top
- Early-development status note with explicit stub list
- `snapshot` command fully documented (syntax, env-var table with aliases and defaults)
- `plan`, `apply`, `verify`, `import` clearly marked not yet implemented
- Install (pip + uv dev), test commands, repo link, license present
- Zero company names, zero made-up behavior, English throughout
</success_criteria>

<output>
Create `.planning/quick/260523-twn-expand-readme-md-from-stub-into-a-real-p/260523-twn-SUMMARY.md` when done.
</output>
