# godoo-stateman

A standalone desired-state manager for Odoo: compose configuration, review a plan,
apply explicitly and verify convergence. Marc selected TypeScript delivery on
2026-10-22, with bgbl-odoo as the first consumer.

The [target contract](/home/marc/dev/godoo-dev/godoo-hq/docs/stateman.md) and
[delivery sequence](/home/marc/dev/godoo-dev/godoo-hq/docs/roadmap.md#immediate-stateman-delivery)
live in local godoo HQ. They describe intended behavior, not installed packages or
accepted runtime behavior. The proposed name is `@godoo-dev/stateman`; package
name, license and publication channel still need delivery-owner confirmation.
The first consumer fixture targets Node 24+.

## Repository orientation

The primary checkout inspected for this guide contains an incomplete Python prior
implementation under `src/godoo_stateman`, tests and Python build metadata. A
TypeScript foundation is being built independently; do not infer that a TS package
is already available from the chosen direction. Python source remains useful
reference material and has not been removed or declared fully accepted.

- [Python reference](docs/python-reference.md): source map, existing CLI behavior,
  setup and important design constraints.
- [Developer docs](docs/index.md): navigation and target boundaries.
- [AGENTS.md](AGENTS.md): current work and coordination guidance.

Stateman owns resource identity, adoption, dependency ordering and reconciliation
policy. The godoo libraries own generic RPC/client, introspection and disposable
test environments. Reuse the
[pinned predecessor TS implementation](https://github.com/marcfargas/odoo-toolbox/tree/01512004814df8887a457e5ed9d6c5769fe3b730/packages/odoo-state-manager)
with source notices and repair its safety gaps before exposing reconciliation.
Package extraction alone is not safe-apply acceptance.
