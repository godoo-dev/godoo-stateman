# Apply an explicit addon stage

Addon installation and upgrade change the schema used by resource planning.
Keep them separate from record reconciliation. The local interfaces are:

```ts
const stageConnection = {
  identity: connection.identity,
  modules: client.modules,
  invalidateSchema: () => introspector.clearCache(),
};
const preview = await planModules(stageConnection, [
  { name: 'project', action: 'install' },
]);
// Review preview.requests, preview.prerequisites and target before mutation.
const outcome = await applyModules(preview, stageConnection);
if (!outcome.ok) throw new Error('Addon stage incomplete; inspect outcome.results');
// Discard every earlier resource plan, then make and review a fresh plan.
const records = await plan(desired, connection, { requiredAddons: ['project'] });
```

The adapter uses the published client 0.8.0 lifecycle API, adopted by the Stateman
0.2.0 candidate, including its verified postconditions and catalog revision. Odoo
installs dependencies and may update its registry, catalog and dependent addons
during an upgrade. Preview is limited to visible
registered addon facts; it does not prove filesystem/external prerequisites or
enumerate every internal upgrade effect.

Preview is read-only. Apply checks the target and fresh visible preview before
dispatch, then calls only the explicitly selected install/upgrade methods. The
client enforces fresh installed postconditions and bounded classified lock retry.
Whenever its catalog revision changes, schema invalidation runs in `finally`,
including ambiguous failures. A failed lifecycle operation or invalidation makes
the stage unsuccessful and skips remaining requests. Results preserve the original
error. No whole-stage rollback, automatic removal or concurrent-writer lock is
promised. Recover the actual addon state and produce fresh previews/plans after
failure; do not reuse a previous resource plan.

The module-stage seam uses the published client lifecycle API. Supplier
qualification remains separate from the required Stateman resource18 lane.
Resource reconciliation checks do not establish addon-stage, managed-addon or
application staging acceptance.
