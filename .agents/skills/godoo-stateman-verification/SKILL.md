---
name: godoo-stateman-verification
description: Check a Stateman change with its native commands, from the offline check to the installed-package and disposable Odoo 18 tiers. Use when changing Stateman's TypeScript source, tests, check callers, CI or release scripts.
---

# Verify a Stateman change

Stateman is a TypeScript package for Node 24 or later. The Python source under
`src/godoo_stateman` is a retained reference implementation; its tests do not
check the TypeScript package and CI does not run them.

## Default check

```sh
npm ci --ignore-scripts
npm run check
```

`npm run check` runs the release-script tests, `tsc --noEmit` over source and
tests, the Vitest suite against a fake Odoo RPC client, and the build. Its exit
status is the result. Fake-RPC tests are simulation, not live Odoo.

Focused commands while iterating:

```sh
npm run typecheck
npx vitest run tests/translation-ordering.test.ts
npm run build
```

CI (`.github/workflows/test.yml`, GitHub-hosted `ubuntu-latest`) runs
`npm run check:ci` on every pull request to `main` and every push to `main`: the
source checks above and the package tier below in one `package` job, building
once through `npm pack` and failing if the checkout is dirty afterwards. The Odoo 18 tier follows.
The `required` job fails unless each mandatory
job succeeded. Let CI run the full set on the PR; run the slow tiers locally
only when the trigger below applies and you need the answer before CI.

There is no lint, formatter or complexity rule yet; adding one awaits an owner
decision in [issue #27](https://github.com/godoo-dev/godoo-stateman/issues/27).
Until then, keep new functions small and do not add suppressions.

Changes to docs or skills alone need only `git diff --check` and a link check,
not the product or container tiers.

## Installed package tier

Run when a change touches the public API, CLI, package contents, `exports`,
dependencies or the check callers:

```sh
export GODOO_ARTIFACT_DIR="$(mktemp -d -t stateman-candidate-XXXXXX)"
npm run check:package
```

The artifact directory must be outside the checkout and must not already hold
a manifest; without the variable the caller creates a temporary one, but the
Odoo tier then has no directory to reuse.

It packs the tarball once into `GODOO_ARTIFACT_DIR`, installs it into a
temporary consumer outside the checkout without path aliases, and drives the
public API and CLI through create, no-op, update, drift, journal recovery and
missing-connection refusal. The consumer is removed when it finishes; the
artifact directory keeps the tarball for the Odoo tier. Remove it afterwards.

## Disposable Odoo 18 tier

Run when a change touches planning, apply, drift, recovery, relation or
company-value handling, HTML or translation comparison, MIS support, or the
Odoo harness. Needs Docker, `tar`, Python 3 and `pdftotext`, and the same
`GODOO_ARTIFACT_DIR` as the package tier (it fails without it):

```sh
npm run check:odoo18
```

It starts uniquely labelled Odoo 18 and Postgres 15 containers (images pinned by
digest in `scripts/images/*.Dockerfile`, updated by Dependabot), a network and
two volumes on random loopback ports with cron workers disabled, installs the
tarball from the package tier and runs the installed API and CLI against
synthetic data (partners, accounting and taxes, mail templates, MIS Builder
reports). It removes only its own labelled resources, also on failure; if it
reports a cleanup failure, remove the labelled leftovers it names and nothing
else. A missing prerequisite fails the run; it is never a skip.

Odoo 18 is the supported baseline; majors below 18 are rejected. Odoo 19 is
opt-in: `GODOO_ENABLE_ODOO19=1 npm run check:odoo19` after a passing Odoo 18
run of the same tarball, and in CI only through a manual dispatch with
`odoo19: true`. An unexecuted 19 lane is not support.

## Unreleased supplier packages

To trial unreleased `@godoo-dev/client` or `@godoo-dev/introspection` tarballs,
set `GODOO_SUPPLIER_MANIFEST` to the supplier manifest for both
`check:package` and `check:odoo18`, with a fresh artifact directory. The callers
install the supplied tarballs directly with dependency overrides. Keep these
results separate from the registry baseline; a trial is not publication.

## Changing the check callers

When editing `scripts/check.mjs`, `scripts/package-check.mjs`, `scripts/odoo18.mjs`
or the workflows, confirm a failing type error or test makes the caller exit
nonzero, and that an invalid mode prints usage. Never weaken an expected plan,
receipt, dependency or safety assertion to make a test pass; fix the product
code or raise it with Marc.

## Release

Releases use the manual `release.yml` workflow on `main`, which reuses the CI
tarball rather than rebuilding; see `docs/releasing.md`. `npm run release:check`
validates a qualified artifact directory. Running checks grants no publication,
deployment or credential authority.

## Product invariants

Plan, apply and drift take an explicitly supplied connection; Stateman never
selects an environment, authenticates or reads credentials. Keep the fail-closed
validation for unsupported policies, stale plans, unresolved dependencies,
ownership and removal, and recovery. Creates keep durable caller-owned receipts;
a retry never discards them. Do not weaken client safety guards.

## Scope limits

These tiers check Stateman against synthetic data on disposable Odoo. They do
not establish a live environment, an application's business acceptance or
custom addons. Route product failures through
[godoo-stateman-capture](../godoo-stateman-capture/SKILL.md).
