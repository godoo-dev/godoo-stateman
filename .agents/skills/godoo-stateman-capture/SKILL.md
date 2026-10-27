---
name: godoo-stateman-capture
description: Capture, triage and retrieve Stateman GitHub work, incoming requests, work breakdowns and deferred observations; reconcile consequential delivery updates.
---

# Retain Stateman work

Use this checkout's AGENTS.md. The canonical work repository is
https://github.com/godoo-dev/godoo-stateman. For issue and PR operations, pass
`--repo godoo-dev/godoo-stateman` to `gh`; verify `gh repo view
godoo-dev/godoo-stateman --json nameWithOwner,url` before a write. Project-local
ignored `.mafe-si.toml` overrides inherited categories; do not fall back to an
ancestor's tracker or documentation store. Missing local config does not change
the public repository default. Authentication failure blocks only provider work;
retain a private draft with owner-paths and report the gap to Marc.

## Choose the home and authority

Retain actionable requests and open decisions early in GitHub issues. Canonical
usage, product targets and engineering explanations belong in this repository's
README and docs through [godoo-stateman-docs](../godoo-stateman-docs/SKILL.md).
Provisional designs, raw reports, private crosswalks and detailed evidence use
owner-paths outside source. Keep an issue self-contained when readers cannot
access that evidence; a private path is not a public evidence link. An explicitly
selected detailed design discussion may live in the issue body or a substantive
issue comment; do not force a duplicate document. Keep session progress here.

Public payloads include titles, bodies, comments, labels, links and attachments.
Remove private company/consumer/supplier identities, local paths, thread IDs,
credentials and raw archival source keys before any write. Keep essential
qualified meaning. For imported private sources, compute SHA256 over UTF-8
`provenance + "\n" + source_ref` with no trailing newline. Retain that original
pair and digest privately. Publish only `Source-ID: sha256:<digest>` in the body.
The complete deduplication key is repository plus that exact marker, across open
and closed issues. Distinct corrections/split outcomes get distinct stable source
identities and link the original; retries retain the same identity.

Capture does not accept, schedule or execute work, release holdings, request
credentials or grant publication authority. Attribute owner requirements and
separate optional suggestions. Record known supplier dependencies and uncertainty
locally; do not contact other agents/projects. Actual cross-project decisions go
to Marc in the current conversation. No dispatch, mailbox or periodic pickup is
implemented by this procedure.

## Find coverage, capture and retrieve

Open a supplied issue with `gh issue view NUMBER --repo godoo-dev/godoo-stateman
--json number,title,body,state,labels,assignees,url,comments`. Otherwise list both
states with `gh issue list --repo godoo-dev/godoo-stateman --state all --limit 100
--json number,title,body,state,url,labels`; paginate with `gh api --paginate
'repos/godoo-dev/godoo-stateman/issues?state=all&per_page=100'` when needed (exclude
objects with `pull_request`). Search meaning as well as exact Source-ID; inspect
relevant PRs/source before deciding a delivery is still open. Closed coverage
stays closed unless an authorized actual reopen is warranted.

Before any create or uncertain retry, search the complete marker in all retrieved
bodies, including closed records. A lost receipt requires lookup, not blind retry;
if completeness/access is uncertain, stop that write and report the limitation.
No atomic GitHub source-key uniqueness is promised: recheck immediately before
create and do not race another writer.

Use reporting-for-humans when available to compose for a fresh maintainer;
otherwise state the problem/result, evidence and limits, remaining acceptance,
decisions and next actor/action directly. New intake stays GitHub OPEN with
`Triage: untriaged` in its body (and priority when supplied); OPEN is not accepted
implementation. Preserve imported lifecycle meaning explicitly: needs-info,
deferred, in-progress or testing are body dispositions, not invented labels.
Use existing labels only for content; inspect `gh label list` first.

Write a sanitized body file outside source, then use `gh issue create --repo
godoo-dev/godoo-stateman --title 'Concrete outcome' --body-file BODYFILE`.
Read it back with the view command above, including comments, labels and assignees.
Confirm repository, state, exact identity and public privacy before returning its
URL and disposition. Do not attach a raw packet for durability.

Reuse existing coverage for the same outcome. Delivery/planning owns breakdown;
retain its outcome, checklist or linked pieces, open decisions and real
dependencies in the canonical issue. A tiny settled task needs only the short
checklist path. Separate issues are useful for independently owned outcomes;
completion of pieces does not complete integrated acceptance. Retrieve linked
remaining work when resuming. For a deferred observation, search coverage, retain
the actionable gap and qualified source, read back, then resume the original task.
A read-only request or warning without an actual observation produces no write.

## Reconcile meaningful changes

Read the current body and relevant known active parent/related summaries before
editing. Recompose current meaning with `gh issue edit NUMBER --repo
godoo-dev/godoo-stateman --body-file BODYFILE`: outcome, material decision or
blocker, remaining acceptance and next actor. Reconcile contradictory active
summaries, including decisions in linked discussions; preserve dated proposals
and closed deliveries as history. Keep useful tradeoffs and sources without
growing a run log. Routine unchanged progress requires no write. Re-read before
editing to detect concurrent changes; GitHub CLI body replacement is not a CAS.
On a detected conflict, preserve the newer body and resolve with Marc.

Use `gh issue comment NUMBER --repo godoo-dev/godoo-stateman --body-file BODYFILE`
only for a substantive selected discussion or required audit, never agent messages,
migration chatter or completion notices. Retain detailed private history outside
source. Corrections in the same open PR and separately justified post-merge work
must preserve linked remaining acceptance; no PR quota follows.

Close with `gh issue close NUMBER --repo godoo-dev/godoo-stateman --reason completed`
only on supported completion; use `--reason 'not planned'` for authorized
non-delivery dispositions, explaining them in the current body first. Never claim
problem fixed when only tracking migrated. Read every changed record back.
For an incoming owner-context request, return the project, canonical URLs,
created/updated/already-covered disposition, actual status and unresolved gaps
through that same invocation only. No acknowledgment or follow-up is sent.
