# Working in godoo-stateman

Read README.md for the current standalone TypeScript foundation and supported
commands. Node 24+ is the consumer baseline. Use `npm ci --ignore-scripts`,
`npm run typecheck` (includes tests), `npm test`, `npm run build` and `npm pack`.
Check installation and the public API/CLI from an isolated tarball consumer.

Product direction is in the private HQ README at
`/home/marc/dev/godoo-dev/godoo-hq/README.md`, with `docs/stateman.md`,
`docs/roadmap.md` and `docs/libraries.md` there. This is a navigation path, not an
import or a required sibling package. Respect the current task's write boundary;
HQ/shared tracker changes require the owning thread's scope.

Preserve predecessor attribution and LGPL obligations (NOTICE.md, LICENSE,
COPYING). Python source/tests/pyproject/uv.lock and .planning are reference
material; historical Python-only/GSD guidance does not control TS delivery.

Plan/apply/drift remain fail-closed until resource-level scheduling, unambiguous
identity/adoption, recursive references, bounded ownership/removal and partial
failure recovery are implemented and verified. Passing offline checks does not
establish Odoo or consumer acceptance. Never weaken client safety guards.

Use the installed mafe-si delivery/documentation procedures and shared godoo
tracker when authorized. Keep working evidence outside docs in the task's retained
agent-work directory. Never read .env or other secrets without explicit authority.
No publication, live business writes or deployment is implied by this guidance.
