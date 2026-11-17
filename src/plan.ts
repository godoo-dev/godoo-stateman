import { inspectResources, loadResources } from './inspect.js';
import type { Inspection, InspectedResource } from './inspect.js';
import { isLookupRef } from './dsl/types.js';
import { isCompanyValues, isExact } from './dsl/scoped-values.js';
import { validateExactScope } from './relation-scope.js';
import { assertId, copy, digest, domain, equal, fail, identity, record, sortGraph, walkRefs, xmlid } from './state-utils.js';
import { StateError } from './state-types.js';
import { readIdentities, readMembership, readRecords } from './plan-reads.js';
import { protectMis } from './mis-guards.js';
import { protectComputedFields } from './computed-fields.js';
import type { MembershipProbe, RecordRead } from './plan-reads.js';
import { companyContext, createPlanContext } from './plan-context.js';
import type { PlanContext } from './plan-context.js';
import { buildOperations } from './plan-operations.js';
import type { PlanState } from './plan-operations.js';
import { exactKey, fieldEqual, multiple, normalized, sortedIds, translationKey } from './plan-values.js';
import type { Plan, PlanOptions, Row, StateConnection, StateInput, StoredPlanOptions } from './state-types.js';

const systemFields = new Set(['id', 'create_uid', 'write_uid', 'create_date', 'write_date', '__last_update']);
const companyValueTypes = ['many2one', 'char', 'text', 'html', 'boolean', 'integer', 'float', 'monetary', 'selection', 'date', 'datetime'];

/** Read-only planning. Every observation relevant to mutations is included in the digest. */
export async function plan(input: StateInput, connection: StateConnection, options: PlanOptions = {}): Promise<Plan> {
  const complete = await renderedInput(input, options);
  // File paths/diagnostics are provenance, not assumptions about the selected environment.
  complete.resources.sort((a, b) => a.externalId.localeCompare(b.externalId));
  const { contentRoot: _root, readFile: _reader, ...serializable } = options;
  const stored: StoredPlanOptions = copy(serializable);
  const context: Row = { ...stored.context, active_test: false };
  const diagnostics = ['Read access does not establish write permission. RPC writes retain client safety guards.',
    'Target identity and observed state are revalidated before apply; this is not a transaction or concurrent-writer lock.',
    'Addon source availability, external prerequisites, catalog freshness and unfiltered visibility remain unknown.'];
  if (complete.policies.some(p => p.removeOrphans || p.archiveOrphans)) fail('BROAD_REMOVAL_UNSUPPORTED', 'Model-wide removal is unsupported; enumerate owned removals');
  const all = indexResources(complete, diagnostics);
  const selected = selectionClosure(all, stored);
  const resources = [...selected].sort().map(id => all.get(id)!);
  const target = identity(await connection.identity());
  const observations: Plan['observations'] = [];
  const major = await checkServer(connection, stored, observations);
  const ctx = createPlanContext({ connection, complete, stored, context, observations, diagnostics, all, selected, target, major });
  await checkAddons(ctx);
  ctx.identities = await readIdentities(resources.map(resource => resource.externalId), ctx.search);
  for (const resource of resources) await validateResource(ctx, resource);
  const desired = withInverses(ctx, resources);
  const state = await observe(ctx, resources, desired);
  const operations = await buildOperations(ctx, state);
  return sealed(ctx, resources, state.order, operations);
}

export async function drift(input: StateInput, connection: StateConnection, options: PlanOptions = {}): Promise<{ converged: boolean; plan: Plan }> {
  const fresh = await plan(input, connection, options);
  return { converged: fresh.operations.length === 0, plan: fresh };
}

async function renderedInput(input: StateInput, options: PlanOptions): Promise<Inspection> {
  const loaded = typeof input === 'string' ? await loadResources(input, options)
    : Array.isArray(input) ? await inspectResources(input, options) : input as Inspection;
  if (!record(loaded) || loaded.kind !== 'offline-inspection' || !Array.isArray(loaded.resources) || !Array.isArray(loaded.policies)) fail('INVALID_INPUT', 'Expected a rendered Inspection or resource definitions');
  return copy(loaded);
}

function indexResources(complete: Inspection, diagnostics: string[]): Map<string, InspectedResource> {
  const all = new Map<string, InspectedResource>();
  for (const resource of complete.resources) {
    xmlid(resource.externalId);
    if (!resource.model || !record(resource.values)) fail('INVALID_RESOURCE', `Malformed resource ${resource.externalId}`);
    if (all.has(resource.externalId)) fail('IDENTITY_COLLISION', `Duplicate XML ID ${resource.externalId}`);
    if (resource.options?.onMissing && !['create', 'error'].includes(resource.options.onMissing)) fail('INVALID_POLICY', `Invalid onMissing for ${resource.externalId}`);
    all.set(resource.externalId, resource);
    if (resource.removeUnmanaged && Object.values(resource.removeUnmanaged).some(Boolean)) diagnostics.push(`${resource.externalId}: legacy removeUnmanaged ignored; no relation or record removal authorized.`);
    if (resource.model === 'ir.module.module') fail('MODULE_MUTATION_UNSUPPORTED', 'Addon changes need a separate approved module stage and fresh record planning');
  }
  return all;
}

// Selection closure follows every reference, parent scope and explicit dependency.
function selectionClosure(all: Map<string, InspectedResource>, stored: StoredPlanOptions): Set<string> {
  const selected = new Set<string>();
  function include(id: string, from: string): void {
    if (selected.has(id)) return;
    const resource = all.get(id);
    if (!resource) fail('MISSING_DEPENDENCY', `${from} needs missing managed resource ${id}; load the complete resource set`);
    selected.add(id);
    walkRefs(resource.values, target => include(target, id));
    for (const target of resource.options?.dependsOn ?? []) include(target, id);
    if (resource.parentScope?.parentExternalId) include(resource.parentScope.parentExternalId, id);
  }
  for (const id of stored.select ?? [...all.keys()]) include(id, 'selection');
  return selected;
}

async function checkServer(connection: StateConnection, stored: StoredPlanOptions, observations: Plan['observations']): Promise<number> {
  const server = await connection.serverInfo();
  if (!server || typeof server.version !== 'string') fail('VERSION_UNKNOWN', 'Read-only server adapter did not provide an Odoo version');
  const major = Number(server.version.match(/^(\d+)/)?.[1]);
  if (major < 18 || !(stored.odooMajorVersions ?? [18]).includes(major)) fail('VERSION_UNSUPPORTED', `Odoo ${server.version} is outside the explicit supported major versions`);
  observations.push({ kind: 'server', key: 'version', value: copy(server) });
  return major;
}

async function checkAddons(ctx: PlanContext): Promise<void> {
  const addons = [...new Set(ctx.stored.requiredAddons ?? [])].sort();
  if (!addons.length) {
    ctx.diagnostics.push('No addon requirements were supplied; model/field schema is checked, but no addon closure is asserted.');
    return;
  }
  if (!ctx.connection.inspectAddons) fail('ADDON_INSPECTION_UNAVAILABLE', 'Required addons need the generic read-only inspectAddons adapter; installed client 0.6.1 does not include the new seam');
  const report = await ctx.connection.inspectAddons(addons, { context: ctx.context });
  ctx.observations.push({ kind: 'addons', key: addons.join(','), value: copy(report) });
  if (!report.closureComplete || report.modules.some(m => m.status !== 'installed') || addons.some(name => !report.modules.some(m => m.name === name))) {
    throw new StateError('ADDON_PREREQUISITES', `Addon prerequisites not established: ${report.modules.map(m => `${m.name}:${m.status}`).join(', ')}; ${report.diagnostics.map(d => `${d.code}: ${d.message}`).join('; ')}`);
  }
}

async function validateResource(ctx: PlanContext, resource: InspectedResource): Promise<void> {
  const meta = await ctx.fields(resource.model);
  if (resource.model === 'ir.cron') {
    if (meta.active?.type !== 'boolean') fail('FIELD_UNAVAILABLE', `${resource.externalId}: cron active metadata is unavailable or restricted`);
    if ('active' in resource.values && typeof resource.values.active !== 'boolean') fail('INVALID_CRON_POLICY', `${resource.externalId}: cron active must be an explicit boolean or omitted to preserve its observed state`);
  }
  for (const name of Object.keys(resource.values)) await validateValue(ctx, resource, name);
  for (const entry of resource.translations?.entries ?? []) if (meta[entry.field]?.company_dependent) fail('COMPANY_VALUE_UNSUPPORTED', `${resource.externalId}.${entry.field}: translations of company-dependent fields are unsupported`);
  for (const entry of resource.translations?.entries ?? []) if (meta[entry.field]?.type === 'reference') fail('REFERENCE_TRANSLATION_UNSUPPORTED', `${resource.externalId}.${entry.field}: Reference fields do not support contextual translations`);
}

async function validateValue(ctx: PlanContext, resource: InspectedResource, name: string): Promise<void> {
  const meta = await ctx.fields(resource.model);
  if (systemFields.has(name)) fail('SYSTEM_FIELD', `${resource.externalId}.${name} is not a managed field`);
  if (!meta[name] || name.startsWith('x_')) await ctx.validateDomain(resource.model, [[name]]);
  const raw = resource.values[name], field = meta[name];
  if (isCompanyValues(raw)) {
    if (!field.company_dependent || field.translate || field.readonly || !companyValueTypes.includes(field.type)) fail('COMPANY_VALUE_UNSUPPORTED', `${resource.externalId}.${name}: companyValues() requires a writable non-translated scalar company-dependent field`);
    if (!Array.isArray(raw.entries) || !raw.entries.length || raw.entries.some(entry => !record(entry) || !('company' in entry) || !('value' in entry))) fail('COMPANY_VALUE_INVALID', `${resource.externalId}.${name}: expected explicit company/value entries`);
    if ('force_company' in ctx.context || 'company_id' in ctx.context) fail('COMPANY_CONTEXT', 'companyValues() uses allowed_company_ids; competing company context keys are unsupported');
  }
  // Scoped markers only have meaning as direct field values. Never pass a
  // nested marker to Odoo as an ordinary JSON value.
  function nested(value: unknown, root = false): void {
    if (!root && (isCompanyValues(value) || isExact(value))) fail('SCOPED_VALUE_UNSUPPORTED', `${resource.externalId}.${name}: scoped markers must be direct fields and cannot nest`);
    if (Array.isArray(value)) value.forEach(item => nested(item));
    else if (record(value)) Object.values(value).forEach(item => nested(item));
  }
  nested(raw, true);
}

// Inverse fields are metadata-backed; no generic ownership is inferred from them.
function withInverses(ctx: PlanContext, resources: InspectedResource[]): Map<string, Row> {
  const desired = new Map(resources.map(resource => [resource.externalId, copy(resource.values)]));
  for (const resource of resources) {
    const scope = resource.parentScope;
    if (!scope?.inverseField || !scope.parentExternalId) continue;
    const parent = ctx.all.get(scope.parentExternalId)!;
    const field = ctx.schema[resource.model][scope.inverseField];
    if (!field || field.relation !== parent.model || !['many2one', 'many2many'].includes(field.type)) fail('INVALID_INVERSE', `${resource.externalId}.${scope.inverseField} must relate to ${parent.model} through M2O or M2M`);
    const values = desired.get(resource.externalId)!;
    if (scope.inverseField in values) fail('INVERSE_CONFLICT', `${resource.externalId}: children inverse ${scope.inverseField} is declared twice`);
    values[scope.inverseField] = field.type === 'many2one' ? { __type: 'resourceRef', externalId: parent.externalId } : [{ __type: 'resourceRef', externalId: parent.externalId }];
  }
  return desired;
}

async function observe(ctx: PlanContext, resources: InspectedResource[], desired: Map<string, Row>): Promise<PlanState> {
  const { creationGraph, readinessGraph } = dependencyGraphs(ctx, resources, desired);
  const order = sortGraph(creationGraph);
  const binder = new Binder(ctx, receiptsFor(ctx));
  for (const resource of resources) await binder.bind(resource);
  const { actual, needsAdoption } = binder;
  await protectComputedFields(resources, ctx.bindings, ctx.search, ctx.fields, ctx.resolveValue);
  await protectMis(resources, ctx.bindings, ctx.search, ctx.resolveValue, ctx.diagnostics);
  const baseReads: RecordRead[] = resources.filter(resource => ctx.bindings[resource.externalId]).map(resource => ({
    key: resource.externalId, label: resource.externalId, model: resource.model, id: ctx.bindings[resource.externalId],
    names: [...Object.keys(desired.get(resource.externalId)!).filter(name => !isCompanyValues(desired.get(resource.externalId)![name])), ...(resource.model === 'ir.cron' ? ['active'] : [])],
  }));
  for (const [id, row] of await readRecords(baseReads, ctx.search)) actual.set(id, row);
  // Establish the complete exact-ownership scope before narrower company reads.
  // Field-specific checks remain separate; only identical physical reads share.
  for (const resource of resources) for (const [name, raw] of Object.entries(desired.get(resource.externalId)!)) {
    if (isExact(raw)) await validateExactScope(ctx.schema[resource.model][name], ctx.context, ctx.target.uid, ctx.search, { externalId: resource.externalId, model: resource.model, field: name, major: ctx.major });
  }
  const effective = await readCompanyValues(ctx, resources, desired);
  const exactState = await auditExact(ctx, resources, desired, actual);
  const translations = await readTranslations(ctx, resources, desired);
  return { resources, desired, order, creationGraph, readinessGraph, actual, needsAdoption, effective, exactState, translations };
}

function dependencyGraphs(ctx: PlanContext, resources: InspectedResource[], desired: Map<string, Row>): Pick<PlanState, 'creationGraph' | 'readinessGraph'> {
  // Creation omits parent-to-child relation edges. Full readiness retains every
  // desired reference, with implicit child inverses requiring only identity.
  const creationGraph = new Map<string, Set<string>>();
  const readinessGraph = new Map<string, Set<string>>();
  for (const resource of resources) {
    const deps = new Set(resource.options?.dependsOn ?? []);
    const readinessDeps = new Set(deps);
    for (const [name, value] of Object.entries(desired.get(resource.externalId)!)) {
      const meta = ctx.schema[resource.model][name];
      walkRefs(value, id => {
        readinessDeps.add(id);
        const child = ctx.all.get(id);
        // Parent's declared x2many children are linked after creation. The inverse
        // edge orders child after parent without fabricating a resource cycle.
        if (multiple(meta) && child?.parentScope?.parentExternalId === resource.externalId && child.parentScope.inverseField) return;
        deps.add(id);
      });
    }
    creationGraph.set(resource.externalId, deps);
    readinessGraph.set(resource.externalId, readinessDeps);
  }
  return { creationGraph, readinessGraph };
}

type Receipt = NonNullable<PlanOptions['recovery']>[number];
function receiptsFor(ctx: PlanContext): Map<string, Receipt> {
  const receipts = new Map<string, Receipt>();
  for (const receipt of ctx.stored.recovery ?? []) {
    if (receipt.version !== 1 || !equal(identity(receipt.target), ctx.target)) fail('RECOVERY_TARGET', 'Recovery receipt belongs to a different connection');
    if (receipts.has(receipt.externalId)) fail('RECOVERY_COLLISION', `Duplicate recovery receipt for ${receipt.externalId}`);
    receipts.set(receipt.externalId, receipt);
  }
  return receipts;
}

// Identity resolution follows parent scope even when relation scheduling points
// in the other direction. This never falls back to an unscoped child lookup.
class Binder {
  readonly actual = new Map<string, Row>();
  readonly needsAdoption = new Set<string>();
  private readonly claims = new Map<string, string>();
  private readonly resolving = new Set<string>();
  constructor(private readonly ctx: PlanContext, private readonly receipts: Map<string, Receipt>) {}

  async bind(resource: InspectedResource): Promise<void> {
    const id = resource.externalId;
    if (this.actual.has(id)) return;
    if (this.resolving.has(id)) fail('SCOPE_CYCLE', `Cyclic parent scope for ${id}`);
    this.resolving.add(id);
    let parentId: number | undefined;
    if (resource.parentScope?.inverseField && resource.parentScope.parentExternalId) {
      await this.bind(this.ctx.all.get(resource.parentScope.parentExternalId)!);
      parentId = this.ctx.bindings[resource.parentScope.parentExternalId];
    }
    let resolved = await this.boundRecord(resource);
    resolved = this.recovered(resource, resolved);
    if (!resolved && resource.ref) resolved = await this.adopted(resource, parentId);
    if (resolved) this.claim(resource, resolved);
    this.actual.set(id, {});
    this.resolving.delete(id);
  }
  private async boundRecord(resource: InspectedResource): Promise<number | undefined> {
    const binding = await this.ctx.imd(resource.externalId);
    if (!binding) return undefined;
    if (binding.model !== resource.model) fail('IDENTITY_COLLISION', `${resource.externalId} points to ${String(binding.model)}, expected ${resource.model}`);
    assertId(binding.res_id, `XML ID ${resource.externalId}`);
    return binding.res_id;
  }
  private recovered(resource: InspectedResource, resolved: number | undefined): number | undefined {
    const id = resource.externalId, receipt = this.receipts.get(id);
    if (!receipt) return resolved;
    if (receipt.model !== resource.model) fail('RECOVERY_COLLISION', `Recovery model mismatch for ${id}`);
    if (!receipt.id) fail('RECOVERY_REQUIRED', `Uncertain create for ${id}; investigate pending receipt before retrying. Supply the verified record ID or establish that no record was created.`);
    assertId(receipt.id, `Recovery ${id}`);
    if (resolved && resolved !== receipt.id) fail('RECOVERY_COLLISION', `XML ID ${id} conflicts with recovered record ${receipt.id}`);
    if (resolved) return resolved;
    this.needsAdoption.add(id);
    return receipt.id;
  }
  private async adopted(resource: InspectedResource, parentId: number | undefined): Promise<number | undefined> {
    const id = resource.externalId;
    if (!isLookupRef(resource.ref) || resource.ref.model !== resource.model) fail('LOOKUP_MODEL', `${id}: adoption lookup model must equal ${resource.model}`);
    const scoped = resource.parentScope?.inverseField;
    const criteria = domain(resource.ref.domain);
    await this.ctx.validateDomain(resource.model, criteria);
    const rows = scoped && !parentId ? [] : await this.ctx.search(resource.model, [...criteria, ...(scoped ? [[scoped, '=', parentId]] : [])], [], 2);
    if (rows.length > 1) fail('AMBIGUOUS_LOOKUP', `Adoption lookup for ${id} matched multiple records`);
    if (rows.length) { this.needsAdoption.add(id); return rows[0].id as number; }
    if (resource.options?.onMissing !== 'create') fail('LOOKUP_MISSING', `${id}: adoption lookup has zero matches; explicitly choose onMissing: 'create' to create`);
    return undefined;
  }
  private claim(resource: InspectedResource, resolved: number): void {
    const claim = `${resource.model}:${resolved}`;
    if (this.claims.has(claim)) fail('IDENTITY_COLLISION', `${resource.externalId} and ${this.claims.get(claim)} claim the same record ${claim}`);
    this.claims.set(claim, resource.externalId);
    this.ctx.bindings[resource.externalId] = resolved;
  }
}

// Group only fields actually declared for each record/company. Sharing a
// context is insufficient: a wider field union would observe undeclared
// values and could introduce extra permission requirements or false drift.
type CompanyBatch = { model: string; names: string[]; companyId: number; context: Row; resources: InspectedResource[] };
async function readCompanyValues(ctx: PlanContext, resources: InspectedResource[], desired: Map<string, Row>): Promise<Map<string, Map<number, Row>>> {
  const batches = new Map<string, CompanyBatch>();
  for (const resource of resources) {
    if (!ctx.bindings[resource.externalId]) continue;
    for (const [companyId, scope] of await companyScopes(ctx, resource, desired.get(resource.externalId)!)) {
      const names = scope.names.sort();
      const key = digest({ model: resource.model, names, context: scope.context });
      const batch = batches.get(key) ?? { model: resource.model, names, companyId, context: scope.context, resources: [] };
      batch.resources.push(resource); batches.set(key, batch);
    }
  }
  const effective = new Map<string, Map<number, Row>>();
  for (const batch of batches.values()) {
    for (let start = 0; start < batch.resources.length; start += 100) await readCompanyChunk(ctx, batch, batch.resources.slice(start, start + 100), effective);
  }
  return effective;
}
async function companyScopes(ctx: PlanContext, resource: InspectedResource, values: Row): Promise<Map<number, { context: Row; names: string[] }>> {
  const scopes = new Map<number, { context: Row; names: string[] }>();
  for (const [name, raw] of Object.entries(values)) {
    if (!isCompanyValues(raw)) continue;
    const seen = new Set<number>();
    for (const entry of raw.entries) {
      const scope = await companyContext(ctx, entry.company);
      if (seen.has(scope.companyId)) fail('COMPANY_VALUE_DUPLICATE', `${resource.externalId}.${name}: duplicate company ${scope.companyId}`);
      seen.add(scope.companyId);
      const group = scopes.get(scope.companyId) ?? { context: scope.context, names: [] };
      group.names.push(name); scopes.set(scope.companyId, group);
    }
  }
  return scopes;
}
async function readCompanyChunk(ctx: PlanContext, batch: CompanyBatch, chunk: InspectedResource[], effective: Map<string, Map<number, Row>>): Promise<void> {
  const ids = chunk.map(r => ctx.bindings[r.externalId]).sort((a, b) => a - b);
  const rows = await ctx.search(batch.model, [['id', 'in', ids]], batch.names, undefined, batch.context);
  const byId = new Map(rows.map(row => [row.id, row]));
  if (rows.length !== byId.size || rows.some(row => !ids.includes(row.id as number))) fail('INVALID_READ', `Invalid company batch for ${batch.model}`);
  for (const resource of chunk) {
    const row = byId.get(ctx.bindings[resource.externalId]);
    if (!row) fail('RECORD_UNAVAILABLE', `${resource.externalId}: inaccessible in company ${batch.companyId}`);
    if (batch.names.some(name => !(name in row))) fail('INVALID_READ', `${resource.externalId}: incomplete company field read in company ${batch.companyId}`);
    const values = effective.get(resource.externalId) ?? new Map<number, Row>();
    values.set(batch.companyId, row); effective.set(resource.externalId, values);
  }
}


async function auditExact(ctx: PlanContext, resources: InspectedResource[], desired: Map<string, Row>, actual: Map<string, Row>): Promise<PlanState['exactState']> {
  const exactState: PlanState['exactState'] = new Map();
  const probes: MembershipProbe[] = [];
  for (const resource of resources) {
    for (const [name, raw] of Object.entries(desired.get(resource.externalId)!)) {
      if (isExact(raw)) await auditExactField(ctx, resource, name, actual, exactState, probes);
    }
  }
  const hiddenMembership = await readMembership(probes, ctx.search);
  for (const resource of resources) for (const [name, raw] of Object.entries(desired.get(resource.externalId)!)) {
    if (!isExact(raw)) continue;
    const hidden = hiddenMembership.get(exactKey(resource.externalId, name)) ?? [];
    if (hidden.length) fail('EXACT_VISIBILITY', `${resource.externalId}.${name}: relation reads hide ${ctx.schema[resource.model][name].relation} IDs ${hidden.join(', ')}; Odoo's filtered M2M unlink cannot safely reconcile these links`);
  }
  return exactState;
}
async function auditExactField(ctx: PlanContext, resource: InspectedResource, name: string, actual: Map<string, Row>, exactState: PlanState['exactState'], probes: MembershipProbe[]): Promise<void> {
  const id = resource.externalId;
  const field = ctx.schema[resource.model][name];
  let current = sortedIds(actual.get(id)![name]);
  if (ctx.bindings[id] && !Array.isArray(actual.get(id)![name])) fail('EXACT_VISIBILITY', `${id}.${name}: incomplete relation read`);
  const exactCompanies = await validateExactScope(field, ctx.context, ctx.target.uid, ctx.search, { externalId: id, model: resource.model, field: name, major: ctx.major });
  const targetMeta = await ctx.fields(field.relation!);
  const companyField = targetMeta.company_id;
  if (!companyField && targetMeta.company_ids) fail('EXACT_VISIBILITY', 'exact() does not support targets partitioned through company_ids');
  if (companyField && (companyField.type !== 'many2one' || companyField.relation !== 'res.company')) fail('EXACT_VISIBILITY', 'Unsupported target company partition');
  const inCompanyScope = (row: Row): boolean => field.relation === 'res.company'
    ? exactCompanies.includes(row.id as number)
    : !companyField || row.company_id === false || exactCompanies.includes(normalized(row.company_id, companyField) as number);
  if (current.length) {
    const visible = await ctx.search(field.relation!, [['id', 'in', current]], companyField ? ['company_id'] : []);
    if (visible.length !== current.length) fail('EXACT_VISIBILITY', `${id}.${name}: existing relation targets are inaccessible`);
    current = visible.filter(inCompanyScope).map(row => row.id as number);
  }
  // Numeric-ID membership searches use Odoo 18's raw M2M EXISTS and do
  // not apply the relation field's read domain. Discover hidden links
  // only among independently visible, authorized targets. Bound the
  // audit universe; split matching batches instead of one RPC per target.
  const universe = await ctx.search(field.relation!, [], companyField ? ['company_id'] : [], 10001);
  if (universe.length > 10000) fail('EXACT_VISIBILITY', `${id}.${name}: target visibility audit exceeds 10000 records`);
  const inScope = universe.filter(inCompanyScope).map(row => row.id as number);
  const key = exactKey(id, name);
  exactState.set(key, { current, inScope });
  const unseen = inScope.filter(candidate => !current.includes(candidate));
  if (ctx.bindings[id]) for (let start = 0; start < unseen.length; start += 1000) {
    probes.push({ key, model: resource.model, field: name, id: ctx.bindings[id], candidates: unseen.slice(start, start + 1000) });
  }
}

async function readTranslations(ctx: PlanContext, resources: InspectedResource[], desired: Map<string, Row>): Promise<Map<string, Row>> {
  const translationReads: RecordRead[] = [];
  for (const resource of resources) for (const entry of resource.translations?.entries ?? []) {
    const id = resource.externalId;
    const field = ctx.schema[resource.model][entry.field];
    if (!field || field.relation || typeof entry.value !== 'string') fail('TRANSLATION_UNSUPPORTED', `${id}: translation needs a scalar string field`);
    const defaultValue = desired.get(id)![entry.field];
    if (typeof defaultValue !== 'string') fail('TRANSLATION_UNSUPPORTED', `${id}.${entry.field}: translation needs an authored string default`);
    const baseLang = ctx.context.lang === false ? 'en_US' : ctx.context.lang;
    if (entry.lang === baseLang && !fieldEqual(defaultValue, entry.value, field)) fail('TRANSLATION_CONFLICT', `${id}.${entry.field}: base context and translation ${entry.lang} request different values`);
    if (ctx.bindings[id]) translationReads.push({ key: translationKey(id, entry.field, entry.lang), label: `${id}.${entry.field} (${entry.lang})`, model: resource.model, id: ctx.bindings[id], names: [entry.field], context: { lang: entry.lang } });
  }
  return readRecords(translationReads, ctx.search);
}

function sealed(ctx: PlanContext, resources: InspectedResource[], order: string[], operations: Plan['operations']): Plan {
  // Parallel lookup reads may finish in any order. Preserve each query/value
  // observation while canonicalizing their order before hashing the plan.
  const observations = ctx.observations;
  const sorted = observations.map(value => ({ value, key: `${value.kind}:${value.key}:${digest(value.value)}` }))
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  sorted.forEach((entry, index) => { observations[index] = entry.value; });
  const result: Omit<Plan, 'digest'> = { kind: 'stateman-plan', version: 1, target: ctx.target, input: ctx.complete, options: ctx.stored, resources, order, bindings: ctx.bindings,
    schema: ctx.schema, observations, operations, diagnostics: [...new Set(ctx.diagnostics)].sort() };
  return { ...copy(result), digest: digest(result) };
}

