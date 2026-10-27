---
name: godoo-stateman-docs
description: Retrieve, author, consolidate and assess Stateman canonical docs; prepare proposed user contracts before implementation and reconcile verified behavior afterward.
---

# Maintain Stateman documentation

Select this repository's actual Git root and read AGENTS.md and README.md. Local
ignored `.mafe-si.toml` supplies project categories; inherited HQ/tracker bindings
do not own this project's knowledge. Operate on this checkout without sibling
repositories or fetching the organization profile. The public
[organization README](https://github.com/godoo-dev/.github/blob/main/profile/README.md)
is optional family orientation, not an operational prerequisite.

README.md owns onboarding/navigation; docs/index.md owns current API behavior;
docs/stateman.md owns product targets, boundaries and direction; docs/fixtures.md,
docs/modules.md, docs/releasing.md and docs/python-reference.md own their focused
guides. Work and decisions awaiting implementation use
[godoo-stateman-capture](../godoo-stateman-capture/SKILL.md) for the distinct work
item only. Raw/private evidence and provisional packets follow owner-paths outside
source, with no parallel planning journal in docs.

## Retrieve or assess

Read a supplied reference first. Otherwise run `rg -n 'QUERY' README.md docs`,
read matches in context and follow relevant public links/source symbols. Cite the
actual file/section or commit URL. Preserve source dates, versions, target versus
available behavior and unresolved uncertainty. Read-only retrieval/freshness
requests write neither content nor configuration and create no issue.

Compare current claims against relevant source/configuration or release evidence.
Source, offline tests, installed artifacts, published bytes, disposable Odoo and
consumer business acceptance are different facts. A historical report stays
attributed; a release page does not independently prove current registry bytes.
Explain inaccessible evidence rather than inventing stronger proof.

## Author, move or reconcile

Search existing coverage and amend the canonical page. Use technical-writing for
composition when available; otherwise write for the reader's task with concrete
behavior, prerequisites and examples. Keep proposed behavior explicitly proposed.
Before implementing an affected user/operator contract, prepare the smallest
useful target/example/runbook here. After verification, reconcile impacted claims
with observed behavior and retain unmet targets and limits. An unaffected
reader contract requires no gratuitous docs edit.

For a move or consolidation, search filenames/headings with `rg`, inspect incoming
links, combine equivalent material and preserve meaningful differences. Repair
in-scope navigation and references. Identify out-of-scope incoming links for Marc;
do not edit siblings or require their availability. Do not copy private consumer
identities, local evidence paths, thread IDs or raw archival source keys into this
public repository. Keep required qualified meaning self-contained.

Read final files back; check relative file targets and headings, `git diff --check`
and new untracked files explicitly. Run only checks proportionate to the change.
For changed API behavior use the existing verifier; docs/routing alone needs no
product/container suite. Review affected delivery entrypoints and capture/docs
links, and report remaining inaccessible relationships or unverified behavior.
Documentation writes grant no release, deployment, runtime or credential authority.
