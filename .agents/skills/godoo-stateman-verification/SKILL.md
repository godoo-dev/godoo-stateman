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
Keep the same directory for later integration.

The package caller packs once, records SHA256/source/lock identity, then installs
that exact tarball into an owned OS-temp consumer using runtime registry baseline
dependencies. It copies maintained acceptance fixtures outside source, typechecks
without paths aliases, drives public API/CLI creation/no-op/update/drift, durable
journal/replay refusal, full parent/child readiness and offline content/children.
It rejects missing-connection commands before poison-module evaluation. Require
all commands to pass, installed file integrity and dependency-origin proof. Its
manifest explicitly says supplier qualification is false; this does not test
unreleased sibling APIs. Runtime source/rights notices must remain in the tarball.
The consumer is removed in finally; artifact bytes, lock and proof remain external.

With Docker reachable, run `npm run check:odoo18` with the same artifact directory.
Missing Docker/artifact/ref/version/hash is failure, never a skipped required test.
The harness pulls Odoo18/Postgres15 images, creates uniquely labelled containers,
network and two volumes, binds only random loopback HTTP and disables cron workers.
It initializes only synthetic base-addon data. Readiness requires HTTP login and
an authenticated observed-major read, not just a listening port.

The installed API creates a res.partner with durable receipt, checks fresh no-op,
updates it, detects manual drift and rejects a stale reviewed plan without changing
that drift. Fresh retry converges. Installed CLI subprocesses plan/apply/drift and
an independent read verify actual names and identities. No authoring business
payload or live environment is loaded. Require the observed18 result, exact image
and tarball identity, result and five-resource ownership/absence cleanup proofs.
The harness removes only its labelled resources, including on failure; inspect
remaining owned state if cleanup reports a failure. Never remove unrelated state.

## Later majors and supplier candidates

The engine rejects majors below18, even with a caller override. Later majors need
explicit caller opt-in and instance-specific verification. The optional
`GODOO_ENABLE_ODOO19=1 npm run check:odoo19` requires retained successful18 proof for
this same candidate; never fabricate it. CI schedules19 only on explicit dispatch
and after18. An unexecuted19 lane is configured capability, not qualification.

Parent-selected local supplier tarballs are a separate installed-consumer trial.
Verify each manifest hash/version/source, install all selected packages directly
with both client/introspection overrides, inspect npm ls/lock origins, and rerun
the affected installed public seam. Never use sibling editable/source aliases or
claim registry publication. Preserve the baseline and candidate rounds separately.

## Integration, failure and upkeep

CI test.yml requires offline, installed package and disposable18, plus requested19.
Its stable required aggregate rejects mandatory missing/skipped/cancelled/failed
results. Controlled local checks do not establish remote branch protection. npm
stays private, and retired Python publication/docs deployment do not run.

For changes to check callers, exercise a real invalid type/test fixture in an
isolated copy and invalid command mode; verify nonzero propagation. For candidate
loading, mutate a copied manifest/hash and observe refusal before Docker resources
are created. Retain failure evidence and cleanup. Never weaken the expected plan,
receipt/dependency/security contract to make a regression pass.

When API paths, fixtures, runtime assumptions or commands change, compare these
instructions and their actual callers, repair driving/observation gaps, then rerun
the affected public interface. Route product failures through the shared tracker.
Cloud/business/staging/human acceptance remains application-owned. No service,
registry, deployment or credential authority follows from this verifier.
