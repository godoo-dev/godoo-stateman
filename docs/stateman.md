# Stateman

Deliver a standalone TypeScript state manager for Odoo: compose desired state,
review changes, apply them safely and verify convergence. Marc selected TS delivery
on 2026-10-22. This is the target contract;
implementation and acceptance remain with the owning projects.

This repository owns this target and the direction below. The
[organization README](https://github.com/godoo-dev/.github/blob/main/profile/README.md)
provides optional family orientation.
The package lives in godoo-stateman and uses the godoo TS libraries. The standalone
package uses `@godoo-dev/stateman`, with a CLI and programmatic API for loading,
planning, applying and fresh drift. Marc selected public npm distribution as
`@godoo-dev/stateman`. Each release must retain the predecessor's LGPL notices
and corresponding source.
The [0.1.0 public release](https://github.com/godoo-dev/godoo-stateman/releases/tag/v0.1.0)
was published on 25 October 2026. Its release record reports verified npm bytes
and installed API/CLI consumers; the documentation relocation has not independently repeated
registry or consumer verification.
The package fixture targets Node 24+; this does not
require raising the existing libraries' runtime floor.

Odoo 18 is the baseline and default target. Reject Odoo 17 as unsupported; qualify
later majors only after the Odoo 18 lifecycle passes. Keep addon/custom-schema
and deployment-specific acceptance with the consuming application.

Build on the [predecessor TS state manager](https://github.com/marcfargas/odoo-toolbox/tree/01512004814df8887a457e5ed9d6c5769fe3b730/packages/odoo-state-manager),
as Marc directed. Reuse its useful DSL, content handling, engine primitives and
tests, adapting their older client imports to the godoo libraries and preserving
source notices. Correct unsafe identity, dependency and removal behavior before
exposing reconciliation; package extraction alone does not establish safe apply.

## Available package

The [package README](../README.md) documents the standalone
package and API/CLI for load, inspect, plan, apply and fresh drift. Trusted TS
exports, arrays and helpers compose resources; declared children keep canonical
identities when referenced elsewhere. Markdown/frontmatter and assembled Python
content are rendered without executing Odoo actions.

Local source provides deterministic resource plans, explicit adoption and dependency
closure, addon/model/field preflight, stale-plan rejection, scoped cleanup, final
cron activation and durable create recovery. Required acceptance covers installed
packages on disposable Odoo 18: create → no-op → update → fresh drift, nested
relations, protected aliases, rejected writes and non-duplicating recovery.
The repository and its public release/PR records retain source-bound results; target
coverage alone does not establish a passing run or publication.

The historical release account identifies `@godoo-dev/stateman@0.1.0` with
`@godoo-dev/client@0.7.0` and `@godoo-dev/introspection@0.2.3` suppliers and reports
registry hashes and fresh installed API/CLI, fixture, recovery and dependency
readiness checks passing. These reported checks are distinct from the repository
lock baseline and from any fresh consumer verification. Use exact tarballs and dependency-resolution recipes when
qualifying later unpublished candidates. Publication, hosted operation and consumer
acceptance remain separate facts. The consumer still owns migration, explicit
Python dependencies,
removal scopes, business tests, staging and CI/CD.

Remote reads are limited by record rules. Apply is not a transaction or a lock
against concurrent writers. Retain recovery receipts across retries; uncertain
creates without a returned ID block blind retries. Synthetic acceptance does not
certify third-party custom behavior or other Odoo majors.

## First consumer contract

- **Authoring:** load exported resources and arrays from trusted TS modules;
  distinguish definitions from helpers and preserve ordinary file composition.
  Keep stable application namespaces and deterministic identities for nested children.
- **Identity:** resolve XML IDs and explicit lookup/adoption without ambiguity.
  Validate model/record matches, reject collisions and protect unowned records.
  A zero-match lookup follows an explicit create-or-error policy.
- **Relations:** support nested many2one resources, child/inverse relations,
  same-model references and references inside M2M lists. Resolve newly created
  targets recursively and expose unsupported cycles before any writes.
- **Dependency closure:** order actual resources, including explicit dependencies
  for Python `env.ref()` calls and cross-directory automation. Do not claim to infer
  arbitrary Python dependencies. A selected subset includes required managed
  dependencies or reports exactly what is missing.
- **Plan:** show deterministic, reviewable changes and concrete mutation targets.
  Check Odoo version, required installed addons, models, fields and external
  prerequisites through read-only operations. Missing metadata access is an
  explicit diagnostic, not proof an addon is absent. Plans do not install addons
  or execute server actions. Trusted TS authoring is executable code, not a sandbox.
- **Apply and drift:** apply the reviewed intent against the selected environment,
  detect stale assumptions, report committed/failed/skipped work and return a
  failure outcome for rejected or incomplete work. Re-read actual state after apply;
  no-op reapply and a fresh converged plan are observable results.
- **Ownership/removal:** distinguish removing a relation from deleting its target.
  Shared stages and manually maintained configuration stay protected. Removal policies
  enumerate actual owned IDs; the old `removeUnmanaged` flag grants no blanket
  deletion authority. Specify explicit ownership when XML ID identity alone is
  insufficient. Do not promise whole-run RPC rollback; identity-write failure after
  record creation needs a recoverable result that prevents blind duplicate creates.
- **Content:** preserve Markdown/frontmatter rendering, category/tag relations,
  separate language records, and assembled Python payloads with their shared
  prelude. Python assembly can remain an ordinary consumer helper. Configuring an
  action does not execute it; cron activation must follow dependency readiness.
- **Portable use:** install from a fresh checkout using supported package artifacts,
  typecheck consumer tests and run supported load/plan/apply/drift entrypoints
  without sibling-relative CLI paths.

Consumer snapshot helpers require a bounded decision in the first delivery:
replace their live-export smoke path with scoped offline fixtures. The
fixture interface serializes rendered desired resources and symbolic relations,
with explicit namespace scope, field exclusions and resource/depth bounds. Import
validates the fixture before using the ordinary plan/apply path; seeding reports
the resulting XML-ID-to-record mapping and fresh convergence. It does not copy live
database IDs or export staging data. The consumer owns replacing its old
`exportData`/`importData` helper and numeric source-ID expectations with this path.
Live snapshot/export remains a separately selected workflow.

## Dependency ownership

| Layer | Contract and owner |
| --- | --- |
| Package dependencies | Stateman uses `@godoo-dev/client` and introspection at runtime; testcontainers is test-only for Stateman. Keep the client independent of Stateman. |
| Generic Odoo operations | godoo-ts owns transport/CRUD, safety errors and module metadata/lifecycle primitives; see [godoo-ts](https://github.com/godoo-dev/godoo-ts). Existing raw APIs can support early development. |
| Resource graph and policy | Stateman owns desired-state composition, adoption/ownership, resource ordering, plan/apply/drift and recovery. |
| Addon prerequisites | Odoo owns addon dependency installation. The client exposes facts/results; Stateman presents the prerequisite or module plan and refreshes schema after approved changes. |
| Consumer operation | The application owns its resource migration, business tests, connections, CI/CD and controlled production validation. Customer infrastructure is outside godoo. |

## Beyond the first consumer

Use [explicit addon stages](modules.md) with dependency
previews and fresh introspection before record planning. Compose reusable TS seeds
and [bounded portable fixtures](fixtures.md) from the same resource model. Keep ordinary test
data helpers in testcontainers; applications that need declarative state can call
Stateman after container readiness, without making the client or testcontainers
depend on it. The Python interface is a subprocess call to the installed
CLI with a reviewed fixture/configuration file and checked exit status. Python
does not evaluate TS modules or embed a second engine; this interface does not
promise parity with the retained Python implementation.

The [computed-field and MIS helpers](computed-fields-mis.md) lower database-defined
fields, report templates and single/multi-company instances to the ordinary resource
graph. Disposable fixtures qualify their native configuration and synthetic report
results; application reports, business coherence logic and resource cleanup remain
consumer work. Broad cloning,
field-translation helpers and automatic addon removal remain separate scope
choices; none is a prerequisite for the first consumer contract.

## Direction and acceptance boundaries

The standalone TypeScript delivery was selected on 22 October 2026. The foundation
is implemented; this target does not restart completed supplier delivery. The
Python source, tests and packaging remain a preserved reference, with no mandate
for parallel delivery. Current usage is documented in the [API guide](index.md).

Native verification distinguishes source simulation, an exact archived package
installed without sibling imports, and owned disposable Odoo 18. Keep source,
lock, artifact hashes, observed versions and cleanup proof attributable to the
candidate; later-major qualification follows 18 for the same candidate. The
[verifier](../.agents/skills/godoo-stateman-verification/SKILL.md) owns the concrete
commands. The CI `required` aggregate rejects missing/failed mandatory results;
workflow wiring alone does not establish remote enforcement.

Each release retains its own version and the LGPL notices/corresponding source.
The [native release procedure](releasing.md) promotes the same tested archive;
partial publication resumes only missing objects, accepts existing versions only
when bytes match, and stops collisions. Documentation grants no publication or
deployment authority. Application resource migration, custom addons, business
acceptance, connections, staging and CI/CD remain application-owned. Supplier
completion does not close consumer acceptance or transfer existing holdings.

Known supplier follow-ups belong in this repository's
[issues](https://github.com/godoo-dev/godoo-stateman/issues). The
[planning RPC-growth report](https://github.com/godoo-dev/godoo-stateman/issues/5)
remains untriaged: its interrupted timing is a lower bound, and no measured
baseline or performance fix is established. Private deployment
records, business data and original historical evidence stay outside public docs.

## Relation ownership and company values

The [verified implementation](https://github.com/godoo-dev/godoo-stateman/pull/3)
adds `exact()` M2M membership while preserving the additive default, and
`companyValues()` effective values of company-dependent fields on one resource
identity. Exact sets require a validated complete authorized-company
visibility scope and enumerated relation-only removals. Company values select each
existing authorized company independently; omitted companies stay unmanaged.
Both contracts retain reviewed plans, stale observations, dependency ordering and
durable create recovery. Isolated installed API/CLI checks and synthetic disposable
Odoo 18 product-tax/accounting checks passed, including zero-write repeat and
owned cleanup. The combined candidate also retains the accepted public
`equivalentHtml` helper, bounded HTML storage convergence and authored-default
restoration after contextual translations with inactive base language. Regression
checks cover both contributions in one installed archive, including exact
multilingual HTML/text reads and a shared-resource simulation with scoped values.
This combined delivery supersedes the earlier candidate that omitted the accepted
HTML/translation contribution. The owning candidate's API guide defines the supported context,
metadata and effective-value/fallback boundaries. Domain-hidden relation links
are identified and refused before writes. These additions are merged into
Stateman `develop` at `27096b3`; hosted offline, package, disposable Odoo 18 and
required checks passed. They remain unpublished; the published 0.1.0 baseline is unchanged. The merged PR
retains the public delivery account; private historical evidence
is not a normal-use prerequisite. The subsequent
[standard accounting context correction](https://github.com/godoo-dev/godoo-stateman/pull/4)
is also merged; neither merge alone claims later package publication or application
business acceptance.
