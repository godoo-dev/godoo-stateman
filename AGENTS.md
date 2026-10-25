# Working in godoo-stateman

Read [README.md](README.md) for the package boundary and developer documentation.
Product intent is maintained in the local [godoo HQ README](/home/marc/dev/godoo-dev/godoo-hq/README.md)
and its linked targets. This absolute local route also works from linked worktrees;
it is not a prerequisite for users installing these libraries independently.

Use the installed mafe-si procedures for scoped delivery and coordination. Work,
open decisions and acceptance evidence belong in the locally bound
`~~project tracker`. Resolve its command/root from local mafe-si guidance rather
than hardcoding them in tracked docs. Read the tracker agent guidance before
unfamiliar operations; use explicit `--root` and `--json` and inspect warnings.
Do not create parallel planning journals here. Perficio is dormant. Historical
GSD phase/adoption/report-back gates do not govern current work.

Keep useful API and engineering guidance in the existing developer docs. Inspect
source before claiming an API is available, and distinguish source, tests,
publication, runtime and consumer acceptance. For a changed user contract, consult
HQ's docs procedure before implementation and reconcile the affected target after
verification. Documentation alone grants no release or deployment authority.

Preserve unrelated edits. Check status, branch, worktree ownership and active users
before changes; do not switch/reset the primary branch or alter another worker's
checkout. Use owner-paths for notes and evidence outside source. For a new
cross-project introduction or shared-resource contention, follow
`/home/marc/dev/marc-hq/fleet/AGENTS.md` through coordinate-projects. Established
exchanges and independent authorized work continue directly.

The selected delivery is standalone TypeScript Stateman for application consumers. The local
package supports authoring, inspection and explicit plan/apply/drift on Node 24+.
Fake CRUD and installed-package checks do not establish live or consumer acceptance. The Python
source is an incomplete prior implementation retained for reference; do not treat
its old roadmap as a mandate to continue Python delivery. Preserve its source,
tests and packaging alongside the TypeScript foundation. See the
[Python reference](docs/python-reference.md)
and the [target contract](/home/marc/dev/godoo-dev/godoo-hq/docs/stateman.md).

For the TypeScript foundation, use `npm ci --ignore-scripts`, `npm run typecheck`
(including tests), `npm test`, `npm run build` and `npm pack`. Verify the public
API/CLI in an isolated tarball consumer without sibling imports. Preserve the
predecessor notices and corresponding source in NOTICE.md, LICENSE and COPYING.
The owner selected public @godoo-dev/stateman npm distribution. Preserve inherited
LGPL obligations and corresponding source; preparation does not establish publication.

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
