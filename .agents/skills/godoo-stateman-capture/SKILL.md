---
name: godoo-stateman-capture
description: Capture, triage and retrieve Stateman work in its GitHub issues, including incoming requests, work breakdowns and deferred observations, and route knowledge Stateman does not own to its owner. Use when work, a decision or a finding about Stateman or its Odoo dependencies needs a home.
---

# Capture Stateman work

Stateman's work records are the public GitHub issues of
`godoo-dev/godoo-stateman`. Pass `--repo godoo-dev/godoo-stateman` to every `gh`
call. The project's ignored local `.mafe-si.toml` names this tracker; inherited
HQ or shared-tracker bindings do not apply to ordinary Stateman work. If `gh` is
not authenticated, keep a draft in `.scratch/` and tell Marc.

## Decide whether to write

Create, update, reuse or make no write:

- **Create** when an outcome needs follow-through later, a decision is open, or
  Marc asks for a record. Work finished in the conversation or an open PR needs
  no separate issue; a merge, a passing check or a handback is no trigger.
- **Update** when a reader-facing fact changes: outcome, acceptance, needed
  decision, blocker or next actor.
- **Reuse** existing coverage for the same outcome, open or closed. Closed
  coverage stays closed unless the outcome was not actually delivered.
- **No write** for read-only requests, routine progress and session history.

Saving a record does not accept, schedule or execute the work, and grants no
release, credential or publication authority.

## Route each kind of knowledge to its owner

Every claim has one canonical home; other places reflect it in their own words
and point at the owner. Classify a finding before retaining it.

| Kind | Owner and destination |
| --- | --- |
| Stateman requests, decisions, remaining work | This repository's issues (this skill) |
| Stateman behaviour: DSL, plan/apply/drift, recovery, policies, CLI | This repository's docs, through [godoo-stateman-docs](../godoo-stateman-docs/SKILL.md) |
| How to work on Stateman: check, release, capture | This repository's `.agents/skills/` |
| What the Odoo server does, by version, edition and module | Atlas, as a fact with an executable check (see below) |
| `@godoo-dev/client` or `@godoo-dev/introspection` behaviour | The `godoo-ts` project |
| Python client libraries | The `godoo-py` project |
| How an agent should use an MCP tool | The `godoo-mcp-server` project |
| Decisions spanning several Godoo components | Marc, for the Godoo HQ project |

Atlas holds only claims about Odoo itself. Stateman behaviour, client-library
behaviour and MCP conventions are never Atlas facts, even when they were learned
while checking Odoo.

**Odoo behaviour learned during Stateman work** (an observed serialization,
domain, access or version difference that Stateman code or docs rely on):

1. Send it to Atlas intake through `mafe-si:coordinate-projects`: a fresh
   invocation in the Atlas project runs Atlas's own capture. Give the Odoo
   version and edition, modules, the observation, how it was observed and what
   Stateman relies on. Do not write into Atlas's records from this session. If
   the host cannot bind the Atlas project, tell Marc.
2. Atlas returns a fact ID. Then add Stateman's reflection, in Stateman's words,
   with an `atlas:<fact-id>` marker, through
   [godoo-stateman-docs](../godoo-stateman-docs/SKILL.md).
3. If the reflection is needed before the fact exists, open a Stateman issue
   that names the pending marker so it is not forgotten.

Findings for another Godoo project follow the same route: an independent intake
in that project through `mafe-si:coordinate-projects`, never a write into its
tracker from here. A proposal sends nothing. Cross-project decisions go to Marc
in the current conversation.

Existing knowledge that sits in the wrong home is a relocation candidate. Until
Marc starts the relocation, capture it as an issue that names the claim, its
current location and its owner; do not move it.

## Public content

The repository and its issues are public. Titles, bodies, comments, labels and
links must not contain private company, consumer or supplier names, local paths,
thread IDs, credentials, private repository paths or Atlas fact text. Atlas fact
IDs are public and may be cited. A private source is summarized in the issue so
the issue stands alone.

For imported private sources, publish only `Source-ID: sha256:<digest>` in the
body, where the digest is SHA-256 over UTF-8 `provenance + "\n" + source_ref`
with no trailing newline. The deduplication key is the repository plus that
marker, across open and closed issues; retries reuse the same identity.

## Find existing coverage

```sh
gh issue view NUMBER --repo godoo-dev/godoo-stateman --json number,title,body,state,labels,url,comments
gh issue list --repo godoo-dev/godoo-stateman --state all --limit 100 --json number,title,body,state,url,labels
gh issue list --repo godoo-dev/godoo-stateman --state all --search 'WORDS in:title,body'
```

Search meaning as well as exact words or a Source-ID. Check relevant PRs and
source before deciding a delivery is still open. Follow an explicit reference
first and only the links the task needs; do not scan the whole backlog.

## Create or update

Compose with `mafe-si:reporting-for-humans`: the problem or outcome, what is
known and its limits, remaining acceptance, open decisions and the next actor.
Keep the body current and short; link supporting material rather than copying it.

New intake stays open with `Triage: untriaged` in the body (and a priority when
one was supplied); open is not accepted. States such as needs-info, deferred or
in-progress are written in the body, not invented labels. Use only existing
labels (`gh label list --repo godoo-dev/godoo-stateman`).

Run `mafe-si:pre-post` before each create, edit, comment or close, and post
through its reviewed-posting helper with `"repo": "github.com/godoo-dev/godoo-stateman"`.
Write once; read the record only if the tool reported an error, because the
write may have succeeded.

- **Breakdowns:** keep a checklist or links to child issues in the parent issue.
  A separate issue needs its own outcome or owner; finishing the pieces does not
  finish the integrated acceptance.
- **Deferred observations:** search coverage, record the actionable gap briefly,
  then return to the task.
- **Updates:** rewrite the body to say what holds now; keep decisions and
  active scope, drop resolved detours. Comment only when the change needs
  someone's attention.
- **Close** with `--reason completed` only on supported completion, or
  `--reason "not planned"` for an authorized non-delivery explained in the body.

## Incoming requests

A fresh intake invocation from another session runs this skill. Keep the
original request, its source identity and authority limits; treat coordinator
suggestions as suggestions. Search coverage, then return the issue URLs, whether
each was created, updated or already covered, and any gaps. Intake does not
start implementation.
