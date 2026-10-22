# Developing Stateman

The selected product is standalone TypeScript Stateman for bgbl-odoo. Follow the
[HQ target](/home/marc/dev/godoo-dev/godoo-hq/docs/stateman.md) for the consumer
contract and the [README](../README.md) for the supported API, CLI, installation
and authoring examples.

The local private `@godoo-dev/stateman` package supports offline `load` and
`inspect` through its API and CLI on Node 24+. It can be packed and installed in an
isolated consumer without sibling imports, load trusted TS/ESM exports and arrays,
and preserve canonical child identities and rendered content. The README gives
the runnable setup and a project/stages example. Modules execute with ordinary
Node privileges; only load trusted code.

Plan/apply/drift fail closed before loading input modules or touching supplied
clients. The subsequent reconciliation contract must handle recursive relations,
explicit dependency closure, identity/adoption, ownership, partial failures and
recovery. No prerequisite adapter is implemented yet. These remain targets until
verified in the owning implementation and consumer.

Generic transport and addon metadata belong in `@godoo-dev/client`; resource policy
belongs here. Odoo installs addon dependencies. A plan inspects prerequisites
read-only, and explicit addon operations require fresh schema before record
planning. No plan may treat inaccessible metadata as proof an addon is absent.
Testcontainers is a test dependency for Stateman, not a runtime dependency of the
installed CLI.

The package includes the predecessor's corresponding TS source, source notices
and LGPL/GPL texts. Package naming, distribution and publication remain owner
choices; private local installation is not a registry release.

The [Python reference](python-reference.md) preserves the useful pipeline,
identity, schema and recovery design from the prior implementation. Its package
metadata and CLI are not the TS release contract. Use scoped offline checks for
documentation; selecting a new implementation does not authorize live Odoo writes.
