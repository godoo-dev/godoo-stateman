# Working in godoo-stateman

Read [README.md](README.md) for the package boundary and developer documentation.
Product intent and boundaries live in [docs/stateman.md](docs/stateman.md).
The public [organization README](https://github.com/godoo-dev/.github/blob/main/profile/README.md)
provides optional family orientation; normal work requires no live fetch.

Use the installed mafe-si procedures for scoped delivery. Work, open decisions
and acceptance evidence belong in this repository's
[GitHub issues](https://github.com/godoo-dev/godoo-stateman/issues), through
[godoo-stateman-capture](.agents/skills/godoo-stateman-capture/SKILL.md).
Canonical knowledge uses
[godoo-stateman-docs](.agents/skills/godoo-stateman-docs/SKILL.md).
Project-local ignored `.mafe-si.toml` explicitly overrides inherited categories;
shared HQ/tracker bindings are retired for ordinary Stateman work. Do not create
parallel planning journals here. Perficio is dormant. Historical GSD gates do not
govern current work.

Keep useful API and engineering guidance in the existing developer docs. Inspect
source before claiming an API is available, and distinguish source, tests,
publication, runtime and consumer acceptance. For a changed user contract, consult
the project docs procedure before implementation and reconcile the affected target
after verification. Documentation alone grants no release or deployment authority.

Preserve unrelated edits. Check status, branch, worktree ownership and active users
before changes; do not switch/reset the primary branch or alter another worker's
checkout. Use owner-paths for notes and evidence outside source. Report actual
cross-project dependencies or ownership conflicts to Marc in the current
conversation. Do not contact agents, coordinators, threads or mailboxes,
launch delegates, or use shared files/tracker comments as agent messages.

The selected delivery is standalone TypeScript Stateman for application consumers. The local
package supports authoring, inspection and explicit plan/apply/drift on Node 24+.
Fake CRUD and installed-package checks do not establish live or consumer acceptance. The Python
source is an incomplete prior implementation retained for reference; do not treat
its old roadmap as a mandate to continue Python delivery. Preserve its source,
tests and packaging alongside the TypeScript foundation. See the
[Python reference](docs/python-reference.md)
and the [target contract](docs/stateman.md).

For product-code changes to the TypeScript foundation, use
`npm ci --ignore-scripts`, `npm run typecheck` (including tests), `npm test`, `npm run build` and `npm pack`. Verify the public
API/CLI in an isolated tarball consumer without sibling imports. Preserve the
predecessor notices and corresponding source in NOTICE.md, LICENSE and COPYING.
Docs and routing changes use scoped skill, link and whitespace checks; they do
not require product/container reruns. The owner selected public @godoo-dev/stateman
npm distribution. Preserve inherited LGPL obligations and corresponding source; preparation does not establish publication.

Plan/apply/drift require an explicitly supplied connection. Retain fail-closed
validation for unsupported policies, stale plans, unresolved resource dependencies,
ownership/removal and recovery. Creates require durable caller-owned receipts;
never silently discard them on retry. Offline checks establish no live Odoo or full
consumer acceptance. Never weaken client safety guards or read secrets without authority.

Use the routed [Stateman verifier](.agents/skills/godoo-stateman-verification/SKILL.md)
for current API/CLI delivery. The native `check`, `check:package` and `check:odoo18`
callers distinguish simulation, isolated installed packages and owned disposable
integration. Odoo18 is the baseline;17 is unsupported. Do not claim application
business acceptance from these checks. Python publication and docs deployment remain retired. The manual npm Release
workflow uses develop and the same verified archive; see docs/releasing.md.
