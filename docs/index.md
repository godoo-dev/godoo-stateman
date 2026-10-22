# Developing Stateman

The selected product is standalone TypeScript Stateman for bgbl-odoo. Follow the
[HQ target](/home/marc/dev/godoo-dev/godoo-hq/docs/stateman.md) for the consumer
contract and the [README](../README.md) for this checkout's actual source state.

The first useful boundary is a package/API/CLI that can be packed and installed in
a fresh consumer fixture without sibling-relative imports, load trusted TS resource
modules and preserve stable IDs and content. The subsequent plan/apply/drift
contract must handle recursive relations, explicit dependency closure, ownership,
partial failures and recovery. These remain targets until verified in the owning
implementation and consumer.

Generic transport and addon metadata belong in `@godoo-dev/client`; resource policy
belongs here. Odoo installs addon dependencies. A plan inspects prerequisites
read-only, and explicit addon operations require fresh schema before record
planning. No plan may treat inaccessible metadata as proof an addon is absent.
Testcontainers is a test dependency for Stateman, not a runtime dependency of the
installed CLI.

The [Python reference](python-reference.md) preserves the useful pipeline,
identity, schema and recovery design from the prior implementation. Its package
metadata and CLI are not the TS release contract. Use scoped offline checks for
documentation; selecting a new implementation does not authorize live Odoo writes.
