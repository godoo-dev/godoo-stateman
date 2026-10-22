# godoo-stateman

The TypeScript foundation for composing and inspecting desired Odoo configuration.
Marc selected standalone TypeScript delivery on 2026-10-22, with bgbl-odoo as the
first consumer. The proposed local package is `@godoo-dev/stateman`, targeting Node 24+.
It loads trusted TS/ESM modules, exported arrays and nested resources offline.

**This foundation does not reconcile Odoo.** `plan`, `apply` and `drift` throw;
the CLI also rejects verify/snapshot/export/import. Lookup/adoption, schema and
prerequisite validation, resource scheduling, ownership/removal and recovery are
future work. Offline output is neither an apply order nor a reviewed plan.

## Develop and install locally

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm pack --pack-destination /absolute/path/to/artifacts
```

In a separate Node 24 ESM project, install the resulting artifact:

```sh
npm install /absolute/path/to/artifacts/godoo-dev-stateman-0.1.0-foundation.0.tgz
```

No sibling checkout is needed. Runtime dependencies are `@godoo-dev/client`
0.6.1 and `@godoo-dev/introspection` 0.2.2; `@godoo-dev/testcontainers` 0.1.6 is
development-only. Versions are pinned to available registry artifacts; the older
local source manifest versions are not available from npm. The package is private
to prevent accidental publication. Package naming, distribution and broader
licensing decisions remain with the owner.

## Author and inspect

Modules execute with ordinary Node filesystem, process and network privileges.
Only load trusted code. The loader does not call exported helper functions, but
module initialization and imported helpers execute normally. It is not a sandbox.

Create `resources/project.ts`:

```ts
import { resource, children } from '@godoo-dev/stateman';

export const project = resource('project.project', 'example.project', {
  name: 'Example project',
  type_ids: children('project.task.type', 'project_ids', [
    resource('project.task.type', 'ready', { name: 'Ready', sequence: 1 }),
    resource('project.task.type', 'done', { name: 'Done', sequence: 2 }),
  ]),
});
```

```sh
npx stateman inspect resources
npx stateman load resources/project.ts
```

Both commands print JSON with `kind: "offline-inspection"`, resources, policies,
files and diagnostics. Errors return a nonzero exit status. The CLI itself never
creates a client, reads credentials, connects to Odoo or executes Python.

Programmatic use:

```ts
import { loadResources } from '@godoo-dev/stateman';
const inspection = await loadResources('./resources');
console.log(inspection.resources.map(resource => resource.externalId));
```

`evaluate(path)` returns raw exported resources/policies and evaluated files.
`normalizeResources(resources)` gives recursively flattened declarations with
symbolic relation references. `loadResources(path, { contentRoot?, readFile? })`
combines evaluation, normalization and content rendering. `createSchemaContext`
accepts an existing godoo client and constructs an introspector without RPC calls;
it does not validate a target or authenticate.

## Identity and composition

Discovery supports ESM `.ts`, `.mts`, `.js` and `.mjs` files. Files and exports are
visited in sorted order. Directory discovery skips hidden folders, symlinks,
`node_modules`, `dist`, `build` and declaration files. Exported nested arrays are
collected; plain objects/functions are helpers. Re-exporting the same definition
object within a run is deduplicated. Each evaluation has its own module cache.

Normalized roots require qualified IDs such as `bgbl.example_project`. Local
child IDs become `bgbl.example_project.ready`; already qualified IDs stay intact.
A child declared through `children()` keeps one canonical identity and inverse
scope when the same definition object is reused in other relations or re-exported.
Qualified global definitions also retain one identity. Distinct definitions claiming
the same ID and conflicting ownership declarations fail. Without an explicit child
declaration, a local inline resource must have one unambiguous parent.
An unnamed scalar inline resource derives its ID from its field name. List
members need explicit IDs, so reordering never changes their identity. Collisions,
child-model mismatches and cyclic nested objects fail visibly. Resource arrays,
objects, empty children and lookup arrays retain their symbolic relations.
Output resources are sorted by identity, **not dependency or execution order**.

`lookup()` and `_ref` remain declarations: no record is selected or adopted.
`children()` retains inverse-field/parent scope for future schema-aware handling.
Legacy `removeUnmanaged` and model policies are preserved for inspection only;
they authorize no deletion. Ordinary resource reference markers are data, not
proof that a target exists or that a dependency graph is valid.

## Content

`md`, `mdFile`, `html` and `withCss` retain the predecessor's Markdown/CSS behavior.
`mdFile` strips leading YAML frontmatter by default; set `stripFrontmatter: false`
to retain it. Relative Markdown/CSS paths use the input directory (or input file's
directory); pass `--content-root <directory>` or the API's `contentRoot` to override.
Use an absolute module-relative file path when content belongs to a nested module.
Rendering is not HTML sanitization; `checkSanitization` supplies heuristics only.

`translated` extracts direct-field language entries for inspection; it does not
apply translations. Separate language resources work as ordinary resource arrays.
Consumer helpers may assemble Python by reading a prelude and body and concatenating
`prelude + '\n' + body`; this produces a string and never executes it.

The sanitized corpus in `tests/fixtures/consumer/resources` covers project/stages,
an inactive cron with nested action, category/tag/M2M references, language arrays,
Markdown/frontmatter and Python assembly. It contains no consumer business code.
It deliberately replaces live snapshot use for these offline checks; no consumer
snapshot migration or full consumer acceptance is claimed.

## Source and product direction

The DSL, loader approach and content transforms are adapted from Marc Fargas's
[odoo-state-manager](https://github.com/marcfargas/odoo-toolbox/tree/01512004814df8887a457e5ed9d6c5769fe3b730/packages/odoo-state-manager).
See [NOTICE.md](NOTICE.md), [LICENSE](LICENSE) and [COPYING](COPYING) for source
attribution and LGPL/GPL terms. Corresponding TS source ships in the local tarball.
The predecessor's unsafe reconciliation engine is not included.

Python source, tests and packaging remain in place as an incomplete prior
implementation. The [Python reference](docs/python-reference.md) preserves its
source map, existing CLI behavior and design constraints; it is not a commitment
to finish or publish a parallel Python product.

See the [developer docs](docs/index.md) and [AGENTS.md](AGENTS.md) for repository
navigation and work guidance. Product targets and remaining acceptance belong to
the local private [HQ target contract](/home/marc/dev/godoo-dev/godoo-hq/docs/stateman.md)
and [delivery sequence](/home/marc/dev/godoo-dev/godoo-hq/docs/roadmap.md#immediate-stateman-delivery).
These local paths are for maintainers, not installation prerequisites. Local
package installability does not establish registry publication or safe
reconciliation acceptance.
