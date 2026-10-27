# Release Stateman

The [v0.1.0 release](https://github.com/godoo-dev/godoo-stateman/releases/tag/v0.1.0)
was published on 25 October 2026 as public `@godoo-dev/stateman`. Its release
record reports verified registry bytes and installed API/CLI consumers from source
`9ff36580da66e3167b5ea1acdb783296b33e7738` and links the
[qualification run](https://github.com/godoo-dev/godoo-stateman/actions/runs/40235199652).
The initial bootstrap used npm owner authentication and has no GitHub provenance
attestation. These are attributed historical results; this documentation update
has not repeated registry installation or consumer acceptance. Later develop
changes require their own versioned candidate and publication evidence.
Retain LGPL-3.0-only, LICENSE, COPYING, NOTICE.md and corresponding TypeScript
source in each tarball. Preserved Python remains a reference implementation.

Use the existing `develop` line; this repository has no `main` release line.
Prepare package/lock versions and changelog before final candidate verification.
The manual Release workflow defaults to `publish: false`: it checks the current
remote develop head, runs the complete native CI, downloads that run's tarball
and Odoo18 proof, and verifies the source, archive, consumer lock and owned cleanup.
It does not build a second package for publication.

Publishing requires a separately configured npm trusted publisher for
`godoo-dev/godoo-stateman`, workflow `release.yml`, environment `npm-release`,
and a GitHub environment with the owner's intended reviewer/branch restrictions.
Do not infer either configuration from this YAML. A fresh scoped package may need
the npm owner's first-publication/bootstrap procedure before OIDC is available.
Keep credentials in the native publishing setup, never in source or coordination scripts.

With the source integrated and those controls configured, dispatch Release from
develop. Inspect its candidate/preflight before selecting `publish: true`.
Promotion rechecks source eligibility and proof, then publishes the same tested
tarball with scripts disabled and public access. An existing version is accepted
only when downloaded bytes match; collisions and registry failures stop promotion.
After upload, verify registry bytes, install in a fresh consumer and run API/CLI
acceptance before recording the release complete. Local checks and a dry run do
not establish publisher access or registry-consumer acceptance.
