---
name: godoo-stateman-docs
description: Retrieve, author, consolidate and assess Stateman's canonical documentation, TSDoc and maintainer knowledge, including Atlas markers for Odoo behaviour. Use to answer from the docs, write a proposed contract before implementation, reconcile docs with verified behaviour, or check docs for staleness.
---

# Maintain Stateman knowledge

Work on this repository's checkout only; sibling repositories and the public
[organization README](https://github.com/godoo-dev/.github/blob/main/profile/README.md)
are optional orientation. The repository is public.

## What Stateman owns and where it lives

Stateman owns its own behaviour and how to work on it:

| Knowledge | Home |
| --- | --- |
| Onboarding, install, CLI quick start, required checks | `README.md` |
| Current API behaviour: authoring, planning, apply, recovery, cleanup, HTML and translation handling, scoped values | `docs/index.md` |
| Product target, boundaries, consumer contract and direction | `docs/stateman.md` |
| Focused guides | `docs/fixtures.md`, `docs/modules.md`, `docs/computed-fields-mis.md`, `docs/releasing.md` |
| The retained Python implementation and its trust limits | `docs/python-reference.md` |
| A caller's contract for one export: arguments, results, errors, version limits | TSDoc in `src/` |
| Why non-obvious code exists, including an Odoo workaround | A code comment next to it |
| Maintainer procedures: capture, docs, verification | `.agents/skills/` |
| Licence and predecessor notices | `NOTICE.md`, `LICENSE`, `COPYING` (preserve them) |

Pick the surface by reader: a caller's contract goes in TSDoc; usage across
several APIs, setup and examples go in README or `docs/`; maintainer procedures
go in a project skill. When one fact matters to several readers, write each
reflection by hand for its reader.

Stateman does not own Odoo server behaviour, client-library behaviour
(`godoo-ts`, `godoo-py`) or MCP conventions (`godoo-mcp-server`). Its docs may
reflect them for Stateman readers, citing the owner. Work, decisions and
relocation candidates go to [godoo-stateman-capture](../godoo-stateman-capture/SKILL.md),
which also routes findings to their owners. Working material stays in `.scratch/`.

## Atlas markers

Odoo server behaviour is owned by Atlas, as facts with executable checks. When
Stateman text or code depends on Odoo behaviour that can change between versions,
editions or modules, mark the Atlas fact it relies on:

- TSDoc: `@see atlas:<fact-id>`
- Code comment: `// atlas: <fact-id>`
- Markdown: `<!-- atlas: <fact-id> -->`
- Python docstring (reference source): `See atlas:<fact-id>.`

Fact IDs are public. Atlas fact text, verification records and paths are private: write the reflection in
Stateman's own words and never copy them. Mark only text that depends on
version-sensitive Odoo behaviour, not every mention of Odoo. A marker records a
dependency, not that the text is still correct; Stateman's own checks remain the
first signal of breakage. A marker naming an unknown fact ID is a defect to fix
here.

If the fact does not exist yet, route the observation to Atlas intake through
capture and add the marker once the fact ID exists.

## Retrieve or answer

Read a supplied reference first. Otherwise search:

```sh
rg -n 'QUERY' README.md docs src --glob '*.md' --glob '*.ts'
```

Read matches in context and follow relevant links or source symbols. Cite the
file and section, or a commit URL. Keep dates, versions, target versus available
behaviour and uncertainty. Source, offline tests, an installed tarball,
published npm bytes, disposable Odoo runs and consumer acceptance are different
facts; a release page does not prove current registry bytes. Retrieval writes
nothing.

## Author or revise

Search existing coverage and amend the canonical page rather than adding a new
one. Use `mafe-si:technical-writing` for composition. Keep proposed behaviour
labelled as proposed.

- **Before implementing** a change to a user or operator contract, write the
  smallest useful target, example or runbook on the canonical page.
- **After verification,** reconcile the affected claims with observed behaviour,
  keep unmet targets and limits, and fix or remove every existing statement the
  edit contradicts in the same change.
- Name a new page for its lasting subject, not for the change that produced it.
- An unaffected contract needs no docs edit.

Never put private consumer or company names, local paths, thread IDs, raw
source keys or Atlas fact text in this repository.

## Move or consolidate

Find incoming references first (`rg -n 'page-name|Heading text' README.md docs src .agents`).
Merge only equivalent content; keep conflicting claims distinct. Repair links
inside this repository; name out-of-repository incoming links to Marc rather
than editing other projects.

## Assess freshness

Compare claims with current source, configuration and release records. Report
what is supported, contradicted or unresolved. A correction needs edit scope.

## Check

Run `git diff --check`, confirm relative link targets and headings exist, and
list new untracked files. Docs-only changes need no product or container checks;
a changed API behaviour uses [godoo-stateman-verification](../godoo-stateman-verification/SKILL.md).
Documentation grants no release, deployment or credential authority.
