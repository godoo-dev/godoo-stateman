# godoo-stateman

Compose desired Odoo configuration in TypeScript, review a deterministic plan,
apply it with explicit recovery storage, and check fresh drift. The private local
package `@godoo-dev/stateman` targets Node 24+ and Odoo 17. The local version still
uses the foundation prerelease name; this work does not publish a release.

The core API and CLI are verified with fake CRUD and a fresh tarball installation.
Disposable Odoo and complete bgbl-odoo acceptance belong to the parent delivery;
these checks alone establish neither live operation nor consumer acceptance.

## Install and develop

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm pack --pack-destination /absolute/path/to/artifacts
```

Install that tarball in a separate Node 24 ESM project:

```sh
npm install /absolute/path/to/artifacts/godoo-dev-stateman-0.1.0-foundation.0.tgz
```

Released runtime dependencies are `@godoo-dev/client` 0.6.1 and
`@godoo-dev/introspection` 0.2.2. Testcontainers is development-only. The generic
addon-inspection seam exists in newer local godoo-ts source, not those published
versions: supply its structural adapter from an explicitly installed local artifact
when requesting addon checks. No sibling-relative source import is required.
The package remains private; distribution and licensing choices stay with the owner.

## Author and inspect offline

Only load trusted modules: TS/ESM and imported helpers execute with ordinary Node
filesystem, process and network privileges. The loader is not a sandbox. It collects
exported resources and arrays without calling exported helper functions.

```ts
import { children, resource } from '@godoo-dev/stateman';

export const project = resource('project.project', 'example.project', {
  name: 'Example',
  type_ids: children('project.task.type', 'project_ids', [
    resource('project.task.type', 'ready', { name: 'Ready', sequence: 1 }),
    resource('project.task.type', 'done', { name: 'Done', sequence: 2 }),
  ]),
});
```

```sh
npx stateman load resources/project.ts
npx stateman inspect resources
```

Both print offline inspection JSON without a connection. `loadResources(path)` is
the API equivalent; `inspectResources(definitions)` renders in-memory definitions.
Discovery supports `.ts`, `.mts`, `.js` and `.mjs`, skips hidden/build/vendor folders,
and visits files and exports in sorted order. Re-exports of the same object are
deduplicated within each evaluation. Separate definitions claiming the same XML ID
fail. Local child IDs become `example.project.ready`; qualified IDs stay intact.
Shared references to the same declared child retain that canonical identity.

`md`, `mdFile`, `html` and `withCss` retain the predecessor content behavior.
`mdFile` strips leading YAML frontmatter unless `stripFrontmatter: false`. Relative
content paths use the input directory or `--content-root`; use module-relative
absolute paths for content in nested modules. Rendering is not HTML sanitization.
`translated` supports scalar string fields through contextual writes and fresh
language reads. Separate language records are ordinary resources. Python assembly
is an ordinary helper producing a string; Stateman never executes that Python.

## Plan, apply and inspect fresh drift

A `StateConnection` deliberately binds a client to its current URL/database/user.
It supplies `identity()` and read-only `serverInfo()`, plus `inspectAddons()` when
addon requirements are requested. `createConnection` can wrap an already authenticated
direct `OdooClient`; pass that client's URL explicitly. It never authenticates or
changes safety settings. A connection module owns its own credential/authentication
procedure; Stateman does not choose an environment or load credential files.

```ts
import {
  apply, createConnection, drift, openRecoveryJournal, plan,
} from '@godoo-dev/stateman';

// client has already been explicitly selected and authenticated by your application.
const connection = createConnection(client, { url: selectedUrl });
const journal = await openRecoveryJournal('/absolute/private/path/recovery.json');
try {
  const reviewed = await plan('./resources', connection, { recovery: journal.receipts });
  // Review or save this concrete plan before requesting writes.
  const result = await apply(reviewed, connection, { journal });
  if (!result.ok) throw new Error('Inspect result.results, result.recovery and result.drift');
  const fresh = await drift('./resources', connection, { recovery: journal.receipts });
  console.log(fresh.converged);
} finally {
  await journal.close();
}
```

The example assumes an existing private directory and an explicitly selected client;
it is not a live deployment instruction. See the [API guide](docs/index.md) for
adoption, prerequisites, ownership and recovery details.

The CLI consumes the same API. `connection.ts` must export a `StateConnection` as
`default` or `connection`. Keep it outside a directory being scanned for resources.
`options.json` contains `PlanOptions`, such as required addons and selected XML IDs.

```sh
npx stateman plan resources --connection connection.ts --journal recovery.json --options options.json --out reviewed.json
npx stateman apply reviewed.json --connection connection.ts --journal recovery.json
npx stateman drift resources --connection connection.ts --journal recovery.json
```

`plan` exits 0 when it produces a plan. `drift` exits 0 for convergence or 2 for
changes. Errors and incomplete/failed apply exit 1. Apply reads the saved rendered
input, not newly evaluated authoring files, and rejects changes to its digest,
connection or observed state before writes. Changed source requires a new plan.
Journal changes also require re-planning with `--journal`. Initial validation is not
a transaction or a concurrent-writer lock. Keep an environment under one operator.

## Policies that affect writes

- `_ref: lookup(model, criteria)` explicitly permits adoption/configuration. Zero
  matches default to an error; pass fourth-argument `{ onMissing: 'create' }` to
  permit creation. Field lookups always require exactly one visible match.
- `ref('example.other')` refers to another managed resource. A fourth-argument
  `{ dependsOn: ['example.action'] }` declares opaque dependencies such as Python
  `env.ref()` calls. Stateman does not infer Python dependencies. A selection includes
  managed closure; missing definitions or unsupported cycles fail before writes.
- Nested M2O, declared child/inverse, same-model, list and recursive JSON references
  resolve to committed IDs. X2many links are additive. Unrelated stages, tags and
  manual records stay linked unless specific M2M links are explicitly removed.
- Legacy `removeUnmanaged` is ignored with a diagnostic; model-wide orphan policies
  are rejected. Enumerate M2M unlink IDs, or record removals plus an exact ownership
  allowlist. Other XML-ID aliases protect a record from archive/delete. Adoption
  and relation membership do not grant destructive ownership.
- Models and desired fields are checked read-only. Access-denied metadata is unknown,
  not absent. Required addons need the generic inspection adapter and a complete
  installed dependency report. Plans install nothing and call no server action.
- Managed crons are created inactive. Relevant existing active crons pause during
  changes, and activation follows successful mutations and a fresh readiness plan.
- Apply returns committed/failed/skipped results and re-reads actual state even after
  partial failure. `ok` requires a fresh empty plan. There is no whole-run rollback.

## Recovery and supported scope

Retain the recovery journal across runs and crashes. Before create, apply saves a
`pending` receipt; after the returned record ID, it saves `record-created` **before**
writing the XML ID; after identity registration it saves `complete`. The file helper
uses an exclusive lock, atomic replacement and filesystem synchronization. A stale
lock needs investigation. Other stores must make `save` durable before resolving.

Pass retained receipts into the next plan. A known created ID is adopted rather
than created again. A pending receipt without an ID blocks automatic retry: inspect
the uncertain RPC outcome, supply the verified ID or deliberately retire the receipt
only after establishing that no record was created. Losing/omitting the journal
forfeits this protection. A save failure stops further writes and returns the known
receipt so it can be retained manually. Whole-run RPC rollback is not available.

The selected replacement for legacy snapshot helpers is bounded rendered offline
fixtures, integrated by the parent delivery. Broad live clone/export/import and addon
mutation are separate workflows; this core does not supply them.

## Source and product direction

The DSL, offline loader/content and useful engine ideas derive from Marc Fargas's
[odoo-state-manager](https://github.com/marcfargas/odoo-toolbox/tree/01512004814df8887a457e5ed9d6c5769fe3b730).
The resource scheduler, policies and recovery replace unsafe predecessor behavior.
See [NOTICE.md](NOTICE.md), [LICENSE](LICENSE) and [COPYING](COPYING); corresponding
TypeScript source ships in the tarball. Python source/tests/packaging are preserved
as an incomplete prior implementation; see the [Python reference](docs/python-reference.md).
This is not a commitment to maintain parallel implementations.

The [developer API guide](docs/index.md) describes the local core. Maintainers can
consult the private [HQ target](/home/marc/dev/godoo-dev/godoo-hq/docs/stateman.md) and
[delivery roadmap](/home/marc/dev/godoo-dev/godoo-hq/docs/roadmap.md); these local links
are not installation prerequisites. Source, offline tests, package publication,
disposable Odoo verification and consumer acceptance are distinct evidence.
