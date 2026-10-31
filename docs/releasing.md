# Release Stateman

The [v0.1.0 release](https://github.com/godoo-dev/godoo-stateman/releases/tag/v0.1.0)
was published on 25 October 2026 as public `@godoo-dev/stateman`. Its release
record reports verified registry bytes and installed API/CLI consumers from source
`9ff36580da66e3167b5ea1acdb783296b33e7738` and links the
[qualification run](https://github.com/godoo-dev/godoo-stateman/actions/runs/40235199652).
The initial bootstrap used npm owner authentication and has no GitHub provenance
attestation. These are attributed historical results; this documentation update
has not repeated registry installation or consumer acceptance. Later source
changes require their own versioned candidate and publication evidence.
Retain LGPL-3.0-only, LICENSE, COPYING, NOTICE.md and corresponding TypeScript
source in each tarball. Preserved Python remains a reference implementation.

Use `main` as the sole long-lived integration and release branch. Temporary
isolated feature branches remain supported.
Prepare package/lock versions and changelog before final candidate verification.
The manual Release workflow defaults to `publish: false`: it checks the current
remote main head, runs the complete native CI, downloads that run's tarball
and Odoo18 proof, and verifies the source, archive, consumer lock and owned cleanup.
It does not build a second package for publication.

Publishing requires a separately configured npm trusted publisher for
`godoo-dev/godoo-stateman`, workflow `release.yml`, environment `npm-release`,
and a GitHub environment with the owner's intended reviewer/branch restrictions.
Do not infer either configuration from this YAML. A fresh scoped package may need
the npm owner's first-publication/bootstrap procedure before OIDC is available.
Keep credentials in the native publishing setup, never in source or coordination scripts.

With the source integrated and those controls configured, dispatch Release from
main. Inspect its candidate/preflight before selecting `publish: true`.
Promotion rechecks source eligibility and proof, then publishes the same tested
tarball with scripts disabled and public access. An existing version is accepted
only when downloaded bytes match; collisions and registry failures stop promotion.

The native publishing job accepts `npm publish` exit success as acknowledged
upload and finishes immediately, without registry polling, waits or sleeps in
CI/CD. Successful upload may precede metadata or tarball availability while npm
processes the package; a later HTTP 404 does not invalidate that acknowledgment,
establish an absent publication or justify another upload. This differs from
`npm publish` exiting nonzero with `E404` before acknowledgment, which remains an
upload failure subject to the recovery rules below. Any separately commissioned
registry-byte or installed-consumer verification is a distinct later activity,
not a publishing-job gate; no fixed processing duration is guaranteed.

Record successful upload as completed publication and move on. Record any
separately requested registry-byte or installed API/CLI checks only when performed;
upload acknowledgment alone does not establish their results.

## Recover an original publication candidate

Use recovery only after diagnosing the original upload failure and establishing
publisher authorization. This source capability does not change npm settings or
GitHub environment policy. Do not blindly rerun the original failed job: ordinary
promotion still requires its own run/attempt identity.

Supply `recovery` JSON to the existing manual Release workflow on current `main`.
All seven fields are required; IDs and attempts are decimal strings, and hashes
are complete lowercase SHA256 values. For the original failed 0.2.0 publication,
the reviewed identity is:

```json
{
  "source": "ee5739ca5020af09c03bb0f0b1e1a8016dbcc12b",
  "runId": "41146741948",
  "attempt": "1",
  "packageArtifactId": "13021082870",
  "odooArtifactId": "13020963197",
  "archiveSha256": "d608e7e1402e46e2ad6dde58d3af99c1b67d680da944eacdb02c8b58aab239f6",
  "manifestSha256": "c3f195f0669fdbb1c56f8b515cbcb111766db377e4db7387856a68dd7ea78c17"
}
```

Save the selected JSON as `recovery.json`. After this capability is merged, an
authorized operator can request a verification-only recovery:

```sh
gh workflow run release.yml --repo godoo-dev/godoo-stateman --ref main \
  -f publish=false -f recovery="$(cat recovery.json)"
```

With no `recovery` input, Release retains the ordinary full qualification path.
Recovery skips rebuilding and Docker qualification. Instead it queries GitHub for
the exact original run/attempt and requires successful eligibility, offline,
package, Odoo18, required aggregate and preflight jobs, plus a failed publish job.
Both runs must belong to this repository's manual `release.yml` on main; the
original source must be an ancestor of the current publisher source. The current
publisher checkout must still be the remote main head. Artifacts must be unexpired,
have the selected immutable IDs, expected names, matching repository/run/source
metadata and creation times within the selected attempt's successful producer jobs.
GitHub ZIP digests are checked before extracting approved flat filenames into a
fresh directory; there is no local-file or operator-testimony fallback.

Current publisher code verifies the downloaded archive against a separate clean
checkout of the original source. The original manifest/installed proofs and
Odoo18 source, archive, consumer-lock, run/attempt and owned-cleanup bindings remain
required. Recovery does not execute the original publisher scripts. Its summary
separates the original candidate identity from the current recovery source,
run/attempt and workflow identity. Verification-only mode makes no registry write
and does not establish registry availability or authorization.

After reviewing the verification summary, an authorized operator can use the same
command with `-f publish=true`. This requests a fresh `npm-release` environment
review; the protected job independently downloads and verifies everything again
after approval. The same `release.yml`/`npm-release` trusted-publisher identity and
main release concurrency group are retained. No publication occurs merely by
merging this capability or running its local tests.

An absent registry version (HTTP 404) permits one upload of the original archive
with scripts disabled. An existing version is accepted only after exact downloaded
byte equality; different reserved bytes, unavailable metadata/archives, authentication
errors and network/server errors fail closed. An upload failure propagates without
automatic retry, even if its remote effect is unknown. Expired/deleted original
artifacts, missing jobs or unavailable GitHub evidence stop recovery. Resolve unknown
effects before a separately reviewed recovery attempt. This capability cannot repair
registry authorization. After acknowledged upload, record completed publication
without waiting for registry availability. Keep any separately requested
registry-byte or installed-consumer checks distinct from that result.

Run `node --test scripts/release.test.mjs scripts/recover-release.test.mjs` for the
no-network/no-publication controls, also included in `npm run check`. They exercise
identity/proof tampering, same-byte recovery, reservations and failure propagation.
These local simulations do not establish hosted environment enforcement, npm
provenance for an older-source archive, publisher access or registry acceptance.
The recovery provenance identifies the current publisher workflow commit; the
summary retains the distinct original archive qualification identity.

## Release finish and cleanup

After recording completed publication and any separately collected evidence,
assess completed disposable worktrees and local/remote feature branches for retirement.
Check current ownership, thread activity, process/container use, clean status and
full integration into `main`; age or patch equivalence alone does not establish
completion. Remove only authorized, clean, completed, integrated and unused
worktrees with `git worktree remove` without force, then retire their branches
when covered by the cleanup authorization. Verify registrations and remote refs
afterward.

Preserve `main`, tags, release evidence and all dirty, unique, active, pinned or
ambiguous work. Keep unresolved work recoverable and report its next decision.
This is a release-time assessment, not automatic deletion on every release.
