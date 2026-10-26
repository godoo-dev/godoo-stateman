# Stateman developer API

The local TypeScript core on Node 24+ provides offline loading plus read-only
planning, explicit apply and fresh drift. See the [README](../README.md) for install
and CLI commands. Odoo 18 is the default and required acceptance baseline. Majors
below18 are unsupported even with `odooMajorVersions`; later majors require explicit
caller opt-in and instance-specific verification after18. The native checks separate
offline simulation, isolated installed packages and owned disposable integration.
They do not certify application business workflows or deployed instances.

## Entry points

```ts
plan(input: StateInput, connection: StateConnection, options?: PlanOptions): Promise<Plan>
apply(reviewed: Plan, connection: StateConnection, options?: ApplyOptions): Promise<ApplyResult>
drift(input: StateInput, connection: StateConnection, options?: PlanOptions): Promise<{converged: boolean, plan: Plan}>
```

`StateInput` accepts a trusted module path, rendered `Inspection`, or an array of
`ResourceDefinition`. `loadResources` and `inspectResources` render content through
the same offline pipeline. A plan stores the complete rendered inspection and
serializable options. Apply does not re-execute trusted input modules.

`StateClient` is structural: `searchRead`, `call`, `create`, `write`, `unlink`, with
the released godoo-client argument shapes. `StateConnection` adds fresh `identity()`
returning `{url,database,uid}`, `serverInfo()` returning `{version}`, and optionally
`inspectAddons(names,{context})`. Identity must describe the same authenticated
client; URLs are canonicalized without userinfo/query/fragment or trailing slash.
`createConnection(client,{url,serverInfo?,inspectAddons?})` binds an existing direct
client. The old client has no public config getter, so callers must supply its
actual URL. The default server-version adapter uses the read-only web endpoint.
It neither authenticates nor sets/disables a safety context.

`createSchemaContext(client)` retains the introspection seam without RPC calls.
The planner uses fresh `fields_get`, not a previously cached schema. Transport,
authentication and unexpected RPC errors propagate; denied schema access produces
`METADATA_INACCESSIBLE` with its original cause. A hidden field is unavailable or
restricted, not proof that an addon is absent. Reads establish no write permission.

## Authoring identity and dependencies

```ts
import { resource, lookup, ref } from '@godoo-dev/stateman';

const action = resource('ir.actions.server', 'example.action', {
  name: 'Action', state: 'code', code: "project = env.ref('example.project')",
}, { dependsOn: ['example.project'] });
const project = resource('project.project', 'example.project', {
  _ref: lookup('project.project', { name: 'Example' }), name: 'Example',
}, { onMissing: 'create' });
const cron = resource('ir.cron', 'example.cron', {
  name: 'Cron', active: true, ir_actions_server_id: ref('example.action'),
}, { dependsOn: ['example.project'] });
```

XML ID is authoritative; `_ref` is an adoption fallback only when that XML ID is
absent. The default missing-adoption policy is `error`; `create` must be explicit.
Adoption can configure an existing module/manual record and add your XML-ID alias;
it does not grant destructive ownership. Duplicate matches, model mismatches, stale
XML IDs and two managed identities claiming one record are errors. Field lookups
always require one match. Record-rule visibility remains a limitation of remote
reads. No zero match is interpreted as proof of global absence.

`ref()` must target a managed definition in the supplied complete set. Use a lookup
for an external existing record. `dependsOn` also names managed definitions; opaque
Python references are not inferred. `select` expands through all these edges and
parent scope. Missing closure reports the missing ID. Unsupported cycles report a
resource path before writes. Same-model dependencies work when acyclic.

The resource DAG orders creation, including required inverse M2O fields. Explicit
dependencies wait for deferred relation, translation and unlink work too, including
through unchanged intermediate resources. Full readiness includes desired managed
children even when the parent relation is already linked or only parent scalars
change. Child inverses need parent identity; an explicit full-readiness cycle
rejects before writes. Parent x2many/child inverse edges are staged as creation
followed by links. `children`
scopes adoption to the actual parent; if that parent is new, it never falls back
to a global name lookup. JSON/list refs resolve recursively. X2many authoring uses
lists of numeric IDs/lookups/refs, not arbitrary command tuples. Use `exact()`
for explicit M2M ownership within a validated company visibility scope (below). Numeric relation
IDs are checked for visible target records. Field metadata validates relation
models. Ordinary lists use positive links to preserve unrelated/manual records.

## Planning and prerequisites

`Plan` contains `target`, complete `input`/`options`, selected `resources`, resource
`order`, concrete existing `bindings`, fresh `schema`, read `observations`, concrete
`operations`, diagnostics and a SHA-256 `digest`. Newly created targets remain named
symbolic references until their earlier create commits. Operations never use an
unspecified record target or model-wide deletion placeholder.

`PlanOptions` supports `select`, `requiredAddons`, `odooMajorVersions`, `context`,
`recovery`, `owned`, `removals`, `unlink` and content-loading options. Read context
sets `active_test:false`; language/company context remains part of the plan.
`readFile` and `contentRoot` affect initial rendering and are excluded from stored
options because the rendered input is already captured.

Required addons use a structural adapter compatible with godoo-ts
`inspectModulePrerequisites`: `{modules,closureComplete,diagnostics}`. Every requested
addon and its visible closure must report installed; inaccessible, missing,
transitional, unknown or incomplete metadata blocks planning. The released 0.6.1
client has no new inspection export, so inject an adapter from an explicitly
selected newer local artifact. No fake publication or source-relative dependency
is assumed. An empty `requiredAddons` checks models/fields but asserts no addon
closure. Source availability, catalog freshness, unfiltered visibility and
Python/system prerequisites remain unknown even with complete registered edges.
No module refresh/install/upgrade or action execution occurs in this core.

## Apply and failure handling

Apply checks the saved digest, re-plans the complete saved intent and compares
all observations/operations against the reviewed plan before writing. Changed
schema, bindings, lookup results, record values, server version or connection
require a new reviewed plan. The initial check cannot exclude concurrent writers
or provide a whole-run transaction. Each mutation also checks current connection
identity; XML-ID registration rechecks for a concurrent identity collision.

```ts
const result = await apply(reviewed, connection, { journal, stopOnError: true });
if (!result.ok) {
  // Retain result.recovery; inspect original structured result.results[].error.
  // Some RPCs may already have committed even when an operation failed.
}
```

Results report `committed`, `failed`, `skipped` counts, per-operation results,
retained receipts and a fresh `drift` plan or `verificationError`. `ok` requires
no failure/skip and an empty fresh plan. False write/unlink returns are failures.
Safety errors remain original structured errors in API results; no guard override
is requested. `stopOnError:false` allows independent work but skips failed
execution dependencies and all activation following failures. An operation marked
`partial` may have committed an earlier RPC; no rollback is promised.

Managed crons are initially inactive. Existing running managed crons pause before changes, including when the requested
final state is disabled. Omitted `active` preserves the observed state on success;
new crons without it remain inactive. Failures leave paused crons inactive. Activation is final, after mutation success and a fresh plan
confirms dependency readiness. Server-action code is configuration only.

## Recovery journal

Creates require `journal.save(RecoveryReceipt)`. The caller must durably persist
before resolving each save. Receipts are keyed by connection/XML ID and include
model, target, reviewed create intent digest, state and optional record ID.

1. `pending` is saved before the create RPC. A crash/timeout may leave its outcome
   uncertain; retry blocks until investigated.
2. `record-created` with the returned ID is saved before the XML-ID write or any
   further mutation. Identity-write failure preserves that ID for adoption.
3. `complete` follows identity registration. Keep it across failed/finished runs.

Pass all retained receipts as `PlanOptions.recovery` on retry. They are checked
against target/model/XML ID, and recovered record existence is re-read. A pending
receipt without an ID never authorizes another create. After investigating an
uncertain outcome, supply the verified ID or deliberately retire the receipt only
when no record was created. Losing or omitting receipts forfeits this protection.
A journal save failure halts progress; return receipts can preserve a known ID
that was not durably saved.

`openRecoveryJournal(absolutePath)` returns `{receipts,save,close}` using a private
file, exclusive `.lock`, atomic rename and file/directory fsync. The directory must
exist. Hold it throughout apply; investigate stale locks rather than expiring them.
`readRecoveryJournal(path)` reads without writing. CLI apply compares retained
receipts with the reviewed plan and refuses stale journal replay.
The lock coordinates only cooperating users of that journal, not the Odoo server.

## Explicit cleanup

```ts
const owned = [{ externalId: 'example.obsolete', model: 'project.project', id: 123 }];
const reviewed = await plan(currentResources, connection, {
  owned,
  removals: [{ ...owned[0], action: 'archive' }],
  unlink: [{ externalId: 'example.project', field: 'type_ids', ids: [456] }],
});
```

IDs above are illustrative; enumerate the actual reviewed environment IDs.
Archive/delete requires exact equality with `owned` and the current XML-ID/model/
record binding. Other visible XML-ID aliases protect the record even if an allowlist
claims it. Archive requires a boolean `active` field. A removal cannot target a
desired selected resource. Unlink removes only enumerated M2M links and never the
target record. O2M unlink is refused because inverse cascade behavior can delete.
Desired links cannot simultaneously be unlinked. Broad model orphan policies fail;
legacy `removeUnmanaged` emits an ignored diagnostic and authorizes nothing.
Alias visibility is limited by permissions/record rules; no global ownership proof
is claimed from relation membership or a successful read.

## Fixtures and development

The parent delivery owns bounded rendered offline fixtures and the Python CLI/file
interop path. Broad live export/import is outside this core. Source, tests and
packaging for the incomplete prior Python implementation remain unchanged; see
[Python reference](python-reference.md). The tarball includes TS corresponding
source and source notices. Run the README checks, then verify the installed API/
CLI independently of sibling imports. Full consumer/disposable Odoo evidence is
separate from source typechecks and fake-CRUD acceptance.

## Reusable state and addon stages

See [portable fixtures and seeding](fixtures.md) and [explicit addon stages](modules.md).
These compose the same planning/recovery engine with explicitly selected targets.

## Exact relation sets and company-dependent values

These additions are source behavior for the next candidate; they are not part of
published 0.1.0. Qualify artifacts with the native installed-package and disposable
Odoo 18 checks before use.

`exact([targets])` opts one M2M field into exact membership across an explicitly
supplied `context.allowed_company_ids` containing all companies authorized for the
connection user. Other companies remain outside that owned scope. Planning must
reject restricted visibility it cannot establish, including unrecognized target
record rules and field context overrides. Apply reviews
concrete positive links and enumerated unlinks; it never deletes shared targets.
Ordinary lists remain additive and `exact([])` declares an empty owned set.

`companyValues([{ company: lookup('res.company', { name: 'Company A' }), value }])`
declares effective values of a company-dependent field on one resource. Companies
must already exist and be authorized; relation values can refer to newly created
managed resources. Each company is selected first in `allowed_company_ids`, while
retaining the base visibility context. Omitted companies remain unmanaged;
`false` is an explicit effective false value, not removal of an Odoo fallback.
Translated company-dependent fields and nested company/exact markers are rejected.
Ordinary translated fields can coexist on the same resource. Company observations
and scoped mutations participate in the reviewed digest and readiness graph.


```ts
import { companyValues, exact, lookup, ref, resource } from '@godoo-dev/stateman';

const service = resource('product.template', 'example.service', {
  name: 'Shared service',
  taxes_id: exact([lookup('account.tax', { name: 'Example sale tax' })]),
  property_account_income_id: companyValues([
    { company: lookup('res.company', { name: 'Company A' }), value: ref('example.incomeA') },
    { company: lookup('res.company', { name: 'Company B' }), value: ref('example.incomeB') },
  ]),
});
```

Include the managed account definitions in the same input. The example requires
those company/tax identities to exist and be unambiguous and accessible. Supply
`context: { allowed_company_ids: [/* every authorized company ID */], lang: 'en_US' }`
to `plan`. This visibility list is the owned exact-set scope; ordinary field
translations retain its company order, while each company-value operation moves
its declared company to the first position. Base custom context keys are retained.
Do not use competing `force_company` or `company_id` context keys with these markers.

Exact sets support writable stored M2M fields, including explicit empty intent,
lookup/managed/numeric targets and targets created earlier in the same plan.
Membership is owned across all authorized companies and shared targets;
visible target records whose ordinary `company_id` lies outside that scope remain
unmanaged. Company subsets are refused, as are field context overrides,
unsupported company partitions, incomplete relation
reads and arbitrary target read rules. The audit requires read access to the
user's company authorization, companies and `ir.rule`. Recognized rules are empty,
constant true, and `company_id in company_ids` or `company_id parent_of company_ids`
predicates, optionally including shared (`company_id = False`) records. Other rules are rejected even
when their group might not apply to this user. This is intentionally conservative.

The planner audits at most 10,000 visible target records and uses numeric-ID M2M
membership searches to discover links hidden by relation-field read filtering.
Field domains limit candidate presentation/ordinary reads, not the owned membership
asserted by `exact()`; its plan includes those otherwise hidden links.
Larger target universes fail before writes. These Odoo 18 checks establish the
supported standard ORM scope, not completeness for custom model/search overrides.
The reviewed observations include the audit universe and rules, so changes to
these also require a fresh plan. Exact removals become enumerated `[3,id,0]`
unlink operations following additions; reviewing/applying that plan authorizes
only those links. They never authorize target archive/delete. Do not combine
`exact()` and `PlanOptions.unlink` for the same field.

Company values support non-translated writable scalar fields whose fresh metadata
reports `company_dependent`, including many2one references. Companies must already
exist and be authorized; new companies need a separate earlier stage. Duplicate
company entries, malformed or nested markers, company-dependent translations,
x2many/JSON company values, and creating a resource with a required company-value
field are refused. A translated ordinary field may coexist on the same resource.
Without a base company list, each declared value uses that company alone; an
explicit base list must be authorized and include every declared company.

Values describe Odoo's **effective** per-company read, including its fallback;
they do not assert that an explicit JSONB override exists. If the fallback already
matches, there is no write. `false` requests an effective false for relation,
boolean and string/date fields; numeric fields require a number (use `0`, not
`false`). `null` and removing an override to resume a fallback are unsupported.
Omitted companies preserve their overrides and effective values. Contextual writes
are deferred until resource identity and referenced resources are ready. Every
operation shows `companyId`, record/XML ID, field, effective `before` value,
desired `values` and full context; fresh
company reads participate in stale checks. Partial failure uses the same retained
create receipts and ordinary re-plan/review/retry path.
