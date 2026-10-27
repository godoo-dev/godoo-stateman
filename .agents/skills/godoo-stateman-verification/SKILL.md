---
name: godoo-stateman-verification
description: Verify Stateman's offline DSL, installed API/CLI and owned disposable Odoo reconciliation with explicit candidate hashes, durable recovery and cleanup. Use for Stateman changes and bounded verification upkeep.
---

# Verify TypeScript Stateman

Select the actual checkout and read README.md and docs/index.md. Node24+ is
required. Capture HEAD, dirty state, lock SHA256 and tool versions with evidence
outside source using owner-paths. Preserved Python is a reference implementation;
its tests do not qualify the current TypeScript package.

## Native proof path

Run `npm ci --ignore-scripts` and `npm run check`. This checks source/tests and
executes the maintained fake-RPC regressions before building. Simulation is not
live Odoo. For an installed candidate, create a fresh external artifact directory,
set `GODOO_ARTIFACT_DIR` to its absolute path and run `npm run check:package`.
Keep the same directory for later integration. A candidate manifest cannot be
overwritten: create a fresh directory for a new candidate.

The package caller packs once, records SHA256/source/lock identity, then installs
that exact tarball into an owned OS-temp consumer using runtime registry baseline
dependencies. It copies maintained acceptance fixtures outside source, typechecks
without paths aliases, drives public API/CLI creation/no-op/update/drift, durable
journal/replay refusal, full parent/child readiness, exact relation ownership, contextual company values
and offline content/children. The installed catalog fixture also checks physical
request budgets, per-company compatible batches, mixed three-language/seven-relation
read batching and fresh apply revalidation.
It rejects missing-connection commands before poison-module evaluation. Require
all commands to pass, installed file integrity and dependency-origin proof. Its
manifest says supplier qualification is false for this registry baseline. Runtime source/rights notices must remain in the tarball.
The consumer is removed in finally; artifact bytes, lock and proof remain external.

With Docker reachable, run `npm run check:odoo18` with the same artifact directory.
Missing Docker/artifact/ref/version/hash is failure, never a skipped required test.
The harness reuses the package acceptance consumer lock with npm ci, relocating
only the verified Stateman file archive path. It pulls Odoo18/Postgres15 images, creates uniquely labelled containers,
network and two volumes, binds only random loopback HTTP and disables cron workers.
It initializes synthetic base data; the scoped-value fixtures explicitly install
account and create fictional companies, accounts, taxes and shared products. It also installs mail for synthetic
mail.template HTML checks. Readiness requires HTTP login and
an authenticated observed-major read, not just a listening port.

The installed API creates a res.partner with durable receipt, checks fresh no-op,
updates it, detects manual drift and rejects a stale reviewed plan without changing
that drift. Fresh retry converges. Installed CLI subprocesses plan/apply/drift and
an independent read verify actual names and identities. Scoped fixtures exercise
product taxes (including domain-hidden links), explicit empty sets, preservation
and stale membership. Standard account.account.tax_ids checks retain fresh
company_ids domain/context metadata, display-only label behavior, empty/nonempty
sets, API/CLI zero-write repeats and preservation. Metadata/read fault adapters
exercise rejected mixed contexts, changed schema and hidden links during apply
revalidation; these are injected faults alongside real Odoo RPCs. Income properties cover unchanged A/undeclared C, changed B,
translations, explicit false, real restricted-user refusal and durable recovery
after an injected contextual RPC failure. Twelve-product/two-field company batches verify effective ORM reads, one changed
middle record, undeclared-company preservation and zero-write convergence. The same
twelve records verify identity/base/translation/membership batching, a changed
translation, and a hidden purchase-tax link on only one source in a batch.
Installed CLI saved-plan/apply/drift and repeated zero-write apply cover the scoped authoring path too. HTML checks cover source
and ca_ES/en_GB/es_ES exact reads for text and HTML, with en_US both active
and inactive, explicit default restoration after translation writes, bounded
serialization/EOF completion, fresh convergence, language update and repeat apply
with zero commits, and meaningful content/language negatives. They never render or send mail. No authoring business
payload or live environment is loaded. Require the observed18 result, exact image
and tarball identity, result and five-resource ownership/absence cleanup proofs.
The same installed candidate also qualifies the computed-field/MIS API. The harness
mounts pinned MIS Builder 18.0.1.10.0, report_xlsx and date_range test inputs, and
installs the hash-verified openupgradelib wheel only inside its owned container.
MIS installation is explicit fixture setup, never a product side effect. The host
needs `tar`, Python3 and `pdftotext` for prerequisite extraction/export assertions.
Synthetic accounting data verifies a nonstored JSON field, source drift/adoption,
same-apply query ordering, single/multi-company totals, monthly/YTD ratios with
unequal denominators, explicit posted-query filtering and the unfiltered-query
counterexample. It also checks stable child IDs, selected closure, label-only
updates, explicit native template/KPI/expression adoption, unmanaged preservation,
sub-KPI expressions, hidden styles, native accounting drilldown and real XLSX/PDF
exports. Matrices and export files remain with candidate evidence; presentation
checks inspect hidden labels, PDF column alignment and the XLSX bold property,
not general export parity. The fixture sets report.url to the container-internal
endpoint so the PDF renderer can load report assets.
The harness removes only its labelled resources, including on failure; inspect
remaining owned state if cleanup reports a failure. Never remove unrelated state.

## Later majors and supplier candidates

The engine rejects majors below18, even with a caller override. Later majors need
explicit caller opt-in and instance-specific verification. The optional
`GODOO_ENABLE_ODOO19=1 npm run check:odoo19` requires retained successful18 proof for
the SHA256 of this complete candidate manifest, including supplier identities;
never fabricate it. Legacy results without that binding require fresh18 proof. CI schedules19 only on explicit dispatch
and after18. An unexecuted19 lane is configured capability, not qualification.

For a parent-selected local supplier trial, set `GODOO_SUPPLIER_MANIFEST` to the
sealed TS manifest in both `check:package` and `check:odoo18` calls, with a fresh
artifact directory. The callers verify all three hashes and every installed shipped
file, record the selected manifest and reject mismatched package/live suppliers.
The live supplier branch installs project through planModules/applyModules, checks
cache invalidation and fresh model discovery, repeated-install no-op, upgrade and
fresh resource creation/convergence. Registry baseline results remain separate.

Parent-selected local supplier tarballs are a separate installed-consumer trial.
Verify each manifest hash/version/source, install all selected packages directly
with both client/introspection overrides, inspect npm ls/lock origins, and rerun
the affected installed public seam. Never use sibling editable/source aliases or
claim registry publication. Preserve the baseline and candidate rounds separately.

## Integration, failure and upkeep

CI test.yml requires offline, installed package and disposable18, plus requested19.
Its stable required aggregate rejects mandatory missing/skipped/cancelled/failed
results. Controlled local checks do not establish remote branch protection. Public npm release preparation is routed through docs/releasing.md and the manual
Release workflow on develop. It reuses the complete CI candidate, validates frozen
consumer locks/observed18/cleanup and never rebuilds for promotion. Run
`GODOO_ARTIFACT_DIR=... npm run release:check` after qualification; offline checks
include refusal/recovery controls. Registry publication, trusted-publisher setup and
GitHub environment enforcement require separate evidence. Retired Python
publication/docs deployment do not run.

For changes to check callers, exercise a real invalid type/test fixture in an
isolated copy and invalid command mode; verify nonzero propagation. For candidate
loading, mutate a copied manifest/hash and observe refusal before Docker resources
are created. Retain failure evidence and cleanup. Never weaken the expected plan,
receipt/dependency/security contract to make a regression pass.

When API paths, fixtures, runtime assumptions or commands change, compare these
instructions and their actual callers, repair driving/observation gaps, then rerun
the affected public interface. Route product failures through
[project capture](../godoo-stateman-capture/SKILL.md) into this repository’s GitHub issues.
Cloud/business/staging/human acceptance remains application-owned. No service,
registry, deployment or credential authority follows from this verifier.
