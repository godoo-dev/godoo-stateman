import { OdooAccessError, OdooRpcError } from '@godoo-dev/client';
import { inspectResources, loadResources } from './inspect.js';
import type { Inspection, InspectedResource } from './inspect.js';
import { isLookupRef, isResourceRef } from './dsl/types.js';
import { isCompanyValues, isExact } from './dsl/scoped-values.js';
import { validateExactScope } from './relation-scope.js';
import { assertId, copy, digest, domain, equal, fail, identity, record, sortGraph, walkRefs, xmlid } from './state-utils.js';
import { StateError } from './state-types.js';
import { equivalentHtml } from './html-equivalence.js';
import { readIdentities, readMembership, readRecords } from './plan-reads.js';
import type { MembershipProbe, RecordRead } from './plan-reads.js';
import type { FieldMetadata, Mutation, Observation, Plan, PlanOptions, Row, Schema, StateConnection, StateInput, StoredPlanOptions } from './state-types.js';

const multiple = (field: FieldMetadata): boolean => ['one2many', 'many2many'].includes(field.type);
const systemFields = new Set(['id', 'create_uid', 'write_uid', 'create_date', 'write_date', '__last_update']);
const sortedIds = (value: unknown): number[] => Array.isArray(value) ? [...new Set(value as number[])].sort((a, b) => a - b) : [];
function normalized(value: unknown, field: FieldMetadata): unknown {
  if (field.type === 'many2one') return Array.isArray(value) ? value[0] : value === null ? false : value;
  if (multiple(field)) return sortedIds(value);
  return value;
}
function companyScalar(value: unknown, field: FieldMetadata): boolean {
  if (field.type === 'many2one') return value === false || typeof value === 'number' || isResourceRef(value);
  if (field.type === 'boolean') return typeof value === 'boolean';
  if (field.type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value);
  if (['float', 'monetary'].includes(field.type)) return typeof value === 'number' && Number.isFinite(value);
  return value === false || typeof value === 'string';
}
function fieldEqual(a: unknown, b: unknown, field: FieldMetadata): boolean {
  return field.type === 'html' && typeof a === 'string' && typeof b === 'string'
    ? equivalentHtml(a, b) : equal(normalized(a, field), normalized(b, field));
}

/** Read-only planning. Every observation relevant to mutations is included in the digest. */
export async function plan(input: StateInput, connection: StateConnection, options: PlanOptions = {}): Promise<Plan> {
  const loaded = typeof input === 'string' ? await loadResources(input, options)
    : Array.isArray(input) ? await inspectResources(input, options) : input as Inspection;
  if (!record(loaded) || loaded.kind !== 'offline-inspection' || !Array.isArray(loaded.resources) || !Array.isArray(loaded.policies)) fail('INVALID_INPUT', 'Expected a rendered Inspection or resource definitions');
  const complete = copy(loaded);
  // File paths/diagnostics are provenance, not assumptions about the selected environment.
  complete.resources.sort((a, b) => a.externalId.localeCompare(b.externalId));
  const { contentRoot: _root, readFile: _reader, ...serializable } = options;
  const stored: StoredPlanOptions = copy(serializable);
  const context: Row = { ...stored.context, active_test: false };
  const observations: Observation[] = [];
  const diagnostics = ['Read access does not establish write permission. RPC writes retain client safety guards.',
    'Target identity and observed state are revalidated before apply; this is not a transaction or concurrent-writer lock.',
    'Addon source availability, external prerequisites, catalog freshness and unfiltered visibility remain unknown.'];
  if (complete.policies.some(p => p.removeOrphans || p.archiveOrphans)) fail('BROAD_REMOVAL_UNSUPPORTED', 'Model-wide removal is unsupported; enumerate owned removals');
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

  // Selection closure follows every reference, parent scope and explicit dependency.
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
  const resources = [...selected].sort().map(id => all.get(id)!);
  const target = identity(await connection.identity());
  const server = await connection.serverInfo();
  if (!server || typeof server.version !== 'string') fail('VERSION_UNKNOWN', 'Read-only server adapter did not provide an Odoo version');
  const major = Number(server.version.match(/^(\d+)/)?.[1]);
  if (major < 18 || !(stored.odooMajorVersions ?? [18]).includes(major)) fail('VERSION_UNSUPPORTED', `Odoo ${server.version} is outside the explicit supported major versions`);
  observations.push({ kind: 'server', key: 'version', value: copy(server) });
  const addons = [...new Set(stored.requiredAddons ?? [])].sort();
  if (addons.length) {
    if (!connection.inspectAddons) fail('ADDON_INSPECTION_UNAVAILABLE', 'Required addons need the generic read-only inspectAddons adapter; installed client 0.6.1 does not include the new seam');
    const report = await connection.inspectAddons(addons, { context });
    observations.push({ kind: 'addons', key: addons.join(','), value: copy(report) });
    if (!report.closureComplete || report.modules.some(m => m.status !== 'installed') || addons.some(name => !report.modules.some(m => m.name === name))) {
      throw new StateError('ADDON_PREREQUISITES', `Addon prerequisites not established: ${report.modules.map(m => `${m.name}:${m.status}`).join(', ')}; ${report.diagnostics.map(d => `${d.code}: ${d.message}`).join('; ')}`);
    }
  } else diagnostics.push('No addon requirements were supplied; model/field schema is checked, but no addon closure is asserted.');

  const schema: Schema = Object.create(null) as Schema;
  const schemaReads = new Map<string, Promise<Record<string, FieldMetadata>>>();
  async function fields(model: string): Promise<Record<string, FieldMetadata>> {
    if (schema[model]) return schema[model];
    let pending = schemaReads.get(model);
    if (!pending) { pending = readFields(model); schemaReads.set(model, pending); }
    return pending;
  }
  async function readFields(model: string): Promise<Record<string, FieldMetadata>> {
    let result: Record<string, FieldMetadata>;
    try {
      result = await connection.client.call(model, 'fields_get', [], { attributes: ['type', 'relation', 'relation_field', 'required', 'readonly', 'company_dependent', 'translate', 'store', 'domain', 'context'], context });
    } catch (cause) {
      if (cause instanceof OdooAccessError) throw new StateError('METADATA_INACCESSIBLE', `Permission denied reading schema for ${model}; model/field availability is unknown`, { cause });
      if (cause instanceof OdooRpcError && cause.data?.name === 'builtins.KeyError' && Array.isArray(cause.data.arguments) && cause.data.arguments[0] === model) throw new StateError('MODEL_MISSING', `Model ${model} is unavailable`, { cause });
      throw cause;
    }
    if (!record(result) || Object.values(result).some(f => !record(f) || typeof f.type !== 'string')) fail('INVALID_SCHEMA', `Invalid fields_get result for ${model}`);
    schema[model] = copy(result);
    observations.push({ kind: 'schema', key: model, value: copy(result) });
    return result;
  }
  // Lifetime is exactly one plan, including in-flight reads. Apply's independent
  // revalidation/final drift therefore never reuse a previous plan's evidence.
  const searches = new Map<string, Promise<Row[]>>();
  async function search(model: string, criteria: any[], names: string[], limit?: number, extraContext?: Row): Promise<Row[]> {
    const query = copy({ model, domain: criteria, fields: [...new Set(['id', ...names])].sort(), limit, order: 'id', context: { ...context, ...extraContext } });
    const key = digest(query);
    let pending = searches.get(key);
    if (!pending) {
      pending = (async () => {
        const rows = await connection.client.searchRead(model, query.domain, { fields: query.fields, limit, order: query.order, context: query.context });
        if (!Array.isArray(rows) || rows.some(row => !record(row))) fail('INVALID_READ', `Invalid search_read result for ${model}`);
        for (const row of rows) assertId(row.id, model);
        const result = copy(rows).sort((a, b) => Number(a.id) - Number(b.id));
        observations.push({ kind: 'search', key, value: { query: copy(query), rows: result } });
        return result;
      })();
      searches.set(key, pending);
    }
    // Membership audits may extend their local arrays. No caller owns cached
    // rows or the immutable observation used for stale-plan comparison.
    return copy(await pending);
  }
  const identities = await readIdentities(resources.map(resource => resource.externalId), search);
  const imd = async (id: string): Promise<Row | undefined> => {
    if (identities.has(id)) return identities.get(id);
    const { module, name } = xmlid(id);
    const rows = await search('ir.model.data', [['module', '=', module], ['name', '=', name]], ['model', 'res_id'], 2);
    if (rows.length > 1) fail('IDENTITY_COLLISION', `Multiple XML-ID bindings for ${id}`);
    return rows[0];
  };
  for (const resource of resources) {
    const meta = await fields(resource.model);
    if (resource.model === 'ir.cron') {
      if (meta.active?.type !== 'boolean') fail('FIELD_UNAVAILABLE', `${resource.externalId}: cron active metadata is unavailable or restricted`);
      if ('active' in resource.values && typeof resource.values.active !== 'boolean') fail('INVALID_CRON_POLICY', `${resource.externalId}: cron active must be an explicit boolean or omitted to preserve its observed state`);
    }
    for (const name of Object.keys(resource.values)) {
      if (systemFields.has(name)) fail('SYSTEM_FIELD', `${resource.externalId}.${name} is not a managed field`);
      if (!meta[name]) fail('FIELD_UNAVAILABLE', `${resource.externalId}: field ${resource.model}.${name} is unavailable or restricted`);
      const raw = resource.values[name], field = meta[name];
      if (isCompanyValues(raw)) {
        if (!field.company_dependent || field.translate || field.readonly || !['many2one', 'char', 'text', 'html', 'boolean', 'integer', 'float', 'monetary', 'selection', 'date', 'datetime'].includes(field.type)) fail('COMPANY_VALUE_UNSUPPORTED', `${resource.externalId}.${name}: companyValues() requires a writable non-translated scalar company-dependent field`);
        if (!Array.isArray(raw.entries) || !raw.entries.length || raw.entries.some(entry => !record(entry) || !('company' in entry) || !('value' in entry))) fail('COMPANY_VALUE_INVALID', `${resource.externalId}.${name}: expected explicit company/value entries`);
        if ('force_company' in context || 'company_id' in context) fail('COMPANY_CONTEXT', 'companyValues() uses allowed_company_ids; competing company context keys are unsupported');
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
    for (const entry of resource.translations?.entries ?? []) if (meta[entry.field]?.company_dependent) fail('COMPANY_VALUE_UNSUPPORTED', `${resource.externalId}.${entry.field}: translations of company-dependent fields are unsupported`);
  }
  // Inverse fields are metadata-backed; no generic ownership is inferred from them.
  const desired = new Map(resources.map(resource => [resource.externalId, copy(resource.values)]));
  for (const resource of resources) {
    const scope = resource.parentScope;
    if (!scope?.inverseField || !scope.parentExternalId) continue;
    const parent = all.get(scope.parentExternalId)!;
    const field = (await fields(resource.model))[scope.inverseField];
    if (!field || field.relation !== parent.model || !['many2one', 'many2many'].includes(field.type)) fail('INVALID_INVERSE', `${resource.externalId}.${scope.inverseField} must relate to ${parent.model} through M2O or M2M`);
    const values = desired.get(resource.externalId)!;
    if (scope.inverseField in values) fail('INVERSE_CONFLICT', `${resource.externalId}: children inverse ${scope.inverseField} is declared twice`);
    values[scope.inverseField] = field.type === 'many2one' ? { __type: 'resourceRef', externalId: parent.externalId } : [{ __type: 'resourceRef', externalId: parent.externalId }];
  }

  const identityDependency = (dependentId: string, id: string): boolean => {
    const dependent = all.get(dependentId);
    return dependent?.parentScope?.parentExternalId === id && !dependent.options?.dependsOn?.includes(id);
  };
  // Creation omits parent-to-child relation edges. Full readiness retains every
  // desired reference, with implicit child inverses requiring only identity.
  const creationGraph = new Map<string, Set<string>>();
  const readinessGraph = new Map<string, Set<string>>();
  for (const resource of resources) {
    const deps = new Set(resource.options?.dependsOn ?? []);
    const readinessDeps = new Set(deps);
    for (const [name, value] of Object.entries(desired.get(resource.externalId)!)) {
      const meta = schema[resource.model][name];
      walkRefs(value, id => {
        readinessDeps.add(id);
        const child = all.get(id);
        // Parent's declared x2many children are linked after creation. The inverse
        // edge orders child after parent without fabricating a resource cycle.
        if (multiple(meta) && child?.parentScope?.parentExternalId === resource.externalId && child.parentScope.inverseField) return;
        deps.add(id);
      });
    }
    creationGraph.set(resource.externalId, deps);
    readinessGraph.set(resource.externalId, readinessDeps);
  }
  const order = sortGraph(creationGraph);
  const bindings: Record<string, number> = {};
  const needsAdoption = new Set<string>();
  const claims = new Map<string, string>();
  const actual = new Map<string, Row>();
  const receipts = new Map<string, NonNullable<PlanOptions['recovery']>[number]>();
  for (const receipt of stored.recovery ?? []) {
    if (receipt.version !== 1 || !equal(identity(receipt.target), target)) fail('RECOVERY_TARGET', 'Recovery receipt belongs to a different connection');
    if (receipts.has(receipt.externalId)) fail('RECOVERY_COLLISION', `Duplicate recovery receipt for ${receipt.externalId}`);
    receipts.set(receipt.externalId, receipt);
  }
  // Identity resolution follows parent scope even when relation scheduling points
  // in the other direction. This never falls back to an unscoped child lookup.
  const resolving = new Set<string>();
  async function bind(resource: InspectedResource): Promise<void> {
    const id = resource.externalId;
    if (actual.has(id)) return;
    if (resolving.has(id)) fail('SCOPE_CYCLE', `Cyclic parent scope for ${id}`);
    resolving.add(id);
    let parentId: number | undefined;
    if (resource.parentScope?.inverseField && resource.parentScope.parentExternalId) {
      await bind(all.get(resource.parentScope.parentExternalId)!);
      parentId = bindings[resource.parentScope.parentExternalId];
    }
    const binding = await imd(id);
    let resolved: number | undefined;
    if (binding) {
      if (binding.model !== resource.model) fail('IDENTITY_COLLISION', `${id} points to ${String(binding.model)}, expected ${resource.model}`);
      assertId(binding.res_id, `XML ID ${id}`); resolved = binding.res_id;
    }
    const receipt = receipts.get(id);
    if (receipt) {
      if (receipt.model !== resource.model) fail('RECOVERY_COLLISION', `Recovery model mismatch for ${id}`);
      if (!receipt.id) fail('RECOVERY_REQUIRED', `Uncertain create for ${id}; investigate pending receipt before retrying. Supply the verified record ID or establish that no record was created.`);
      assertId(receipt.id, `Recovery ${id}`);
      if (resolved && resolved !== receipt.id) fail('RECOVERY_COLLISION', `XML ID ${id} conflicts with recovered record ${receipt.id}`);
      if (!resolved) { resolved = receipt.id; needsAdoption.add(id); }
    }
    if (!resolved && resource.ref) {
      if (!isLookupRef(resource.ref) || resource.ref.model !== resource.model) fail('LOOKUP_MODEL', `${id}: adoption lookup model must equal ${resource.model}`);
      const scoped = resource.parentScope?.inverseField;
      const criteria = domain(resource.ref.domain);
      const rows = scoped && !parentId ? [] : await search(resource.model, [...criteria, ...(scoped ? [[scoped, '=', parentId]] : [])], [], 2);
      if (rows.length > 1) fail('AMBIGUOUS_LOOKUP', `Adoption lookup for ${id} matched multiple records`);
      if (rows.length) { resolved = rows[0].id as number; needsAdoption.add(id); }
      else if (resource.options?.onMissing !== 'create') fail('LOOKUP_MISSING', `${id}: adoption lookup has zero matches; explicitly choose onMissing: 'create' to create`);
    }
    if (resolved) {
      const claim = `${resource.model}:${resolved}`;
      if (claims.has(claim)) fail('IDENTITY_COLLISION', `${id} and ${claims.get(claim)} claim the same record ${claim}`);
      claims.set(claim, id);
      bindings[id] = resolved; actual.set(id, {});
    } else actual.set(id, {});
    resolving.delete(id);
  }
  for (const resource of resources) await bind(resource);
  const baseReads: RecordRead[] = resources.filter(resource => bindings[resource.externalId]).map(resource => ({
    key: resource.externalId, label: resource.externalId, model: resource.model, id: bindings[resource.externalId],
    names: [...Object.keys(desired.get(resource.externalId)!).filter(name => !isCompanyValues(desired.get(resource.externalId)![name])), ...(resource.model === 'ir.cron' ? ['active'] : [])],
  }));
  for (const [id, row] of await readRecords(baseReads, search)) actual.set(id, row);

  async function resolveValue(value: unknown, expectedModel?: string, valueContext?: Row): Promise<unknown> {
    if (isLookupRef(value)) {
      if (expectedModel && value.model !== expectedModel) fail('RELATION_MODEL', `Lookup ${value.model} does not match relation ${expectedModel}`);
      await fields(value.model);
      const rows = await search(value.model, domain(value.domain), [], 2, valueContext);
      if (rows.length !== 1) fail(rows.length ? 'AMBIGUOUS_LOOKUP' : 'LOOKUP_MISSING', `Field lookup for ${value.model} requires exactly one visible record, found ${rows.length}`);
      return rows[0].id;
    }
    if (isResourceRef(value)) {
      const resource = all.get(value.externalId);
      if (!resource || !selected.has(value.externalId)) fail('MISSING_DEPENDENCY', `Missing managed reference ${value.externalId}`);
      if (expectedModel && resource.model !== expectedModel) fail('RELATION_MODEL', `${value.externalId} is ${resource.model}, expected ${expectedModel}`);
      if (valueContext && bindings[value.externalId]) {
        const rows = await search(resource.model, [['id', '=', bindings[value.externalId]]], [], undefined, valueContext);
        if (rows.length !== 1) fail('RECORD_UNAVAILABLE', `${value.externalId} is inaccessible in the intended company context`);
      }
      return bindings[value.externalId] ?? value;
    }
    if (Array.isArray(value)) return Promise.all(value.map(v => resolveValue(v, expectedModel, valueContext)));
    if (record(value)) {
      if ('__type' in value) fail('UNRENDERED_MARKER', 'Content/DSL markers must be rendered before record planning');
      return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await resolveValue(v, undefined, valueContext)])));
    }
    if (typeof value === 'number' && expectedModel) {
      assertId(value, expectedModel);
      const rows = await search(expectedModel, [['id', '=', value]], [], undefined, valueContext);
      if (rows.length !== 1) fail('RECORD_UNAVAILABLE', `Referenced ${expectedModel}#${value} is missing or inaccessible`);
    }
    return value;
  }
  let authorizedCompanies: number[] | undefined;
  async function companyContext(company: unknown): Promise<{ companyId: number; context: Row }> {
    const companyId = await resolveValue(company, 'res.company');
    if (isResourceRef(companyId)) fail('COMPANY_UNRESOLVED', 'Company contexts require existing companies; create companies in an earlier reviewed stage');
    assertId(companyId, 'Company');
    if (!authorizedCompanies) {
      const users = await search('res.users', [['id', '=', target.uid]], ['company_ids']);
      if (users.length !== 1 || !Array.isArray(users[0].company_ids)) fail('COMPANY_ACCESS', 'Cannot read the authenticated user company authorization');
      authorizedCompanies = users[0].company_ids as number[];
      authorizedCompanies.forEach(id => assertId(id, 'Authorized company'));
    }
    if (!authorizedCompanies.includes(companyId)) fail('COMPANY_ACCESS', `Company ${companyId} is not authorized for the authenticated user`);
    const visible = context.allowed_company_ids ?? [companyId];
    if (!Array.isArray(visible) || !visible.length || visible.some(id => !Number.isSafeInteger(id) || !authorizedCompanies!.includes(id)) || !visible.includes(companyId) || new Set(visible).size !== visible.length) fail('COMPANY_CONTEXT', `Base allowed_company_ids must authorize and include company ${companyId}`);
    return { companyId, context: { ...context, allowed_company_ids: [companyId, ...visible.filter(id => id !== companyId)] } };
  }
  // Group only fields actually declared for each record/company. Sharing a
  // context is insufficient: a wider field union would observe undeclared
  // values and could introduce extra permission requirements or false drift.
  const effective = new Map<string, Map<number, Row>>();
  const batches = new Map<string, { model: string; names: string[]; companyId: number; context: Row; resources: InspectedResource[] }>();
  // Establish the complete exact-ownership scope before narrower company reads.
  // Field-specific checks remain separate; only identical physical reads share.
  for (const resource of resources) for (const [name, raw] of Object.entries(desired.get(resource.externalId)!)) {
    if (isExact(raw)) await validateExactScope(schema[resource.model][name], context, target.uid, search, { externalId: resource.externalId, model: resource.model, field: name, major });
  }
  for (const resource of resources) {
    if (!bindings[resource.externalId]) continue;
    const scopes = new Map<number, { context: Row; names: string[] }>();
    for (const [name, raw] of Object.entries(desired.get(resource.externalId)!)) {
      if (!isCompanyValues(raw)) continue;
      const seen = new Set<number>();
      for (const entry of raw.entries) {
        const scope = await companyContext(entry.company);
        if (seen.has(scope.companyId)) fail('COMPANY_VALUE_DUPLICATE', `${resource.externalId}.${name}: duplicate company ${scope.companyId}`);
        seen.add(scope.companyId);
        const group = scopes.get(scope.companyId) ?? { context: scope.context, names: [] };
        group.names.push(name); scopes.set(scope.companyId, group);
      }
    }
    for (const [companyId, scope] of scopes) {
      const names = scope.names.sort();
      const key = digest({ model: resource.model, names, context: scope.context });
      const batch = batches.get(key) ?? { model: resource.model, names, companyId, context: scope.context, resources: [] };
      batch.resources.push(resource); batches.set(key, batch);
    }
  }
  for (const batch of batches.values()) {
    for (let start = 0; start < batch.resources.length; start += 100) {
      const chunk = batch.resources.slice(start, start + 100);
      const ids = chunk.map(r => bindings[r.externalId]).sort((a, b) => a - b);
      const rows = await search(batch.model, [['id', 'in', ids]], batch.names, undefined, batch.context);
      const byId = new Map(rows.map(row => [row.id, row]));
      if (rows.length !== byId.size || rows.some(row => !ids.includes(row.id as number))) fail('INVALID_READ', `Invalid company batch for ${batch.model}`);
      for (const resource of chunk) {
        const row = byId.get(bindings[resource.externalId]);
        if (!row) fail('RECORD_UNAVAILABLE', `${resource.externalId}: inaccessible in company ${batch.companyId}`);
        if (batch.names.some(name => !(name in row))) fail('INVALID_READ', `${resource.externalId}: incomplete company field read in company ${batch.companyId}`);
        const values = effective.get(resource.externalId) ?? new Map<number, Row>();
        values.set(batch.companyId, row); effective.set(resource.externalId, values);
      }
    }
  }
  const exactKey = (id: string, name: string): string => digest({ id, name });
  const exactState = new Map<string, { current: number[]; inScope: number[] }>();
  const probes: MembershipProbe[] = [];
  for (const resource of resources) {
    const id = resource.externalId;
    for (const [name, raw] of Object.entries(desired.get(id)!)) {
      if (!isExact(raw)) continue;
      const field = schema[resource.model][name];
      let current = sortedIds(actual.get(id)![name]);
      if (bindings[id] && !Array.isArray(actual.get(id)![name])) fail('EXACT_VISIBILITY', `${id}.${name}: incomplete relation read`);
      const exactCompanies = await validateExactScope(field, context, target.uid, search, { externalId: id, model: resource.model, field: name, major });
      const targetMeta = await fields(field.relation!);
      const companyField = targetMeta.company_id;
      if (!companyField && targetMeta.company_ids) fail('EXACT_VISIBILITY', 'exact() does not support targets partitioned through company_ids');
      if (companyField && (companyField.type !== 'many2one' || companyField.relation !== 'res.company')) fail('EXACT_VISIBILITY', 'Unsupported target company partition');
      if (current.length) {
        const visible = await search(field.relation!, [['id', 'in', current]], companyField ? ['company_id'] : []);
        if (visible.length !== current.length) fail('EXACT_VISIBILITY', `${id}.${name}: existing relation targets are inaccessible`);
        current = visible.filter(row => !companyField || row.company_id === false || exactCompanies!.includes(normalized(row.company_id, companyField) as number)).map(row => row.id as number);
      }
      // Numeric-ID membership searches use Odoo 18's raw M2M EXISTS and do
      // not apply the relation field's read domain. Discover hidden links
      // only among independently visible, authorized targets. Bound the
      // audit universe; split matching batches instead of one RPC per target.
      const universe = await search(field.relation!, [], companyField ? ['company_id'] : [], 10001);
      if (universe.length > 10000) fail('EXACT_VISIBILITY', `${id}.${name}: target visibility audit exceeds 10000 records`);
      const inScope = universe.filter(row => !companyField || row.company_id === false || exactCompanies!.includes(normalized(row.company_id, companyField) as number)).map(row => row.id as number);
      const key = exactKey(id, name);
      exactState.set(key, { current, inScope });
      const unseen = inScope.filter(target => !current.includes(target));
      if (bindings[id]) for (let start = 0; start < unseen.length; start += 1000) {
        probes.push({ key, model: resource.model, field: name, id: bindings[id], candidates: unseen.slice(start, start + 1000) });
      }
    }
  }
  const hiddenMembership = await readMembership(probes, search);
  for (const resource of resources) for (const [name, raw] of Object.entries(desired.get(resource.externalId)!)) {
    if (!isExact(raw)) continue;
    const hidden = hiddenMembership.get(exactKey(resource.externalId, name)) ?? [];
    if (hidden.length) fail('EXACT_VISIBILITY', `${resource.externalId}.${name}: relation reads hide ${schema[resource.model][name].relation} IDs ${hidden.join(', ')}; Odoo's filtered M2M unlink cannot safely reconcile these links`);
  }
  const translationKey = (id: string, field: string, lang: string): string => digest({ id, field, lang });
  const translationReads: RecordRead[] = [];
  for (const resource of resources) for (const entry of resource.translations?.entries ?? []) {
    const id = resource.externalId;
    const field = schema[resource.model][entry.field];
    if (!field || field.relation || typeof entry.value !== 'string') fail('TRANSLATION_UNSUPPORTED', `${id}: translation needs a scalar string field`);
    const defaultValue = desired.get(id)![entry.field];
    if (typeof defaultValue !== 'string') fail('TRANSLATION_UNSUPPORTED', `${id}.${entry.field}: translation needs an authored string default`);
    const baseLang = context.lang === false ? 'en_US' : context.lang;
    if (entry.lang === baseLang && !fieldEqual(defaultValue, entry.value, field)) fail('TRANSLATION_CONFLICT', `${id}.${entry.field}: base context and translation ${entry.lang} request different values`);
    if (bindings[id]) translationReads.push({ key: translationKey(id, entry.field, entry.lang), label: `${id}.${entry.field} (${entry.lang})`, model: resource.model, id: bindings[id], names: [entry.field], context: { lang: entry.lang } });
  }
  const translations = await readRecords(translationReads, search);
  const operations: Mutation[] = [];
  const links: Mutation[] = [];
  const exactUnlinks: Mutation[] = [];
  function op(resource: InspectedResource, type: Mutation['type'], values: Row, suffix: string = type, opContext?: Row): Mutation {
    const mutation: Mutation = { key: `${resource.externalId}:${suffix}`, type, externalId: resource.externalId, model: resource.model,
      ...(bindings[resource.externalId] ? { id: bindings[resource.externalId] } : {}), values,
      context: { ...context, ...opContext }, dependsOn: [] };
    return mutation;
  }
  for (const id of order) {
    const resource = all.get(id)!;
    const scalar: Row = {}, relation: Row = {};
    for (const [name, raw] of Object.entries(desired.get(id)!).sort(([a], [b]) => a.localeCompare(b))) {
      const field = schema[resource.model][name];
      if (isCompanyValues(raw)) {
        if (!bindings[id] && field.required) fail('COMPANY_CREATE_REQUIRED', `${id}.${name}: required company-dependent fields need an existing resource`);
        const entries: { companyId: number; context: Row; value: unknown }[] = [];
        for (const entry of raw.entries) {
          const scope = await companyContext(entry.company);
          if (entries.some(previous => previous.companyId === scope.companyId)) fail('COMPANY_VALUE_DUPLICATE', `${id}.${name}: duplicate company ${scope.companyId}`);
          const value = await resolveValue(entry.value, field.relation, scope.context);
          if (!companyScalar(value, field)) fail('COMPANY_VALUE_INVALID', `${id}.${name}: expected an effective ${field.type} value; null and fallback-reset markers are unsupported (numeric fields use 0, not false)`);
          entries.push({ ...scope, value });
        }
        for (const entry of entries.sort((a, b) => a.companyId - b.companyId)) {
          const rows = bindings[id] ? [effective.get(id)!.get(entry.companyId)!] : [];
          if (bindings[id] && rows.length !== 1) fail('RECORD_UNAVAILABLE', `${id}: inaccessible in company ${entry.companyId}`);
          if (!bindings[id] || !fieldEqual(entry.value, rows[0][name], field)) {
            const mutation = op(resource, 'update', { [name]: entry.value }, `company:${name}:${entry.companyId}`, entry.context);
            mutation.companyId = entry.companyId;
            mutation.before = { [name]: bindings[id] ? normalized(rows[0][name], field) : null };
            links.push(mutation);
          }
        }
        continue;
      }
      const intended = isExact(raw) ? raw.targets : raw;
      if (multiple(field) && (!Array.isArray(intended) || intended.some(v => !(typeof v === 'number' || isLookupRef(v) || isResourceRef(v))))) fail('RELATION_VALUE', `${id}.${name}: use a list of IDs/lookups/refs, not raw relation commands`);
      if (isExact(raw) && (stored.unlink ?? []).some(request => request.externalId === id && request.field === name)) fail('UNLINK_CONFLICT', `${id}.${name}: exact() cannot combine with an explicit unlink request`);
      const value = await resolveValue(intended, field.relation);
      if (field.type === 'many2one' && !(value === false || value === null || typeof value === 'number' || isResourceRef(value))) fail('RELATION_VALUE', `${id}.${name}: expected a single relation target`);
      if (multiple(field)) {
        // Positive links preserve all unrelated/manual relationships. A removal
        // needs a separately enumerated unlink request, never set/clear commands.
        let current = sortedIds(actual.get(id)![name]);
        if (isExact(raw) && bindings[id] && !Array.isArray(actual.get(id)![name])) fail('EXACT_VISIBILITY', `${id}.${name}: incomplete relation read`);
        if (isExact(raw)) {
          // Explicit empty initial membership suppresses server defaults on a
          // new record. Desired targets are linked after their identities exist.
          // This is never emitted for an existing record or an ordinary list.
          if (!bindings[id]) scalar[name] = [[6, 0, []]];
          const state = exactState.get(exactKey(id, name))!;
          current = [...state.current];
          for (const desired of value as unknown[]) if (typeof desired === 'number' && !state.inScope.includes(desired)) fail('EXACT_VISIBILITY', `${id}.${name}: desired target ${desired} is outside the owned company scope`);
          const unexpected = current.filter(id => !(value as unknown[]).includes(id));
          if (unexpected.length) exactUnlinks.push(op(resource, 'unlink', { [name]: unexpected.map(id => [3, id, 0]) }, `unlink:${name}`));
        }
        const missing = (value as unknown[]).filter(v => typeof v !== 'number' || !current.includes(v));
        if (missing.length) relation[name] = missing.map(v => [4, v, 0]);
      } else if (!bindings[id] || !fieldEqual(value, actual.get(id)![name], field)) scalar[name] = value;
    }
    if (resource.model === 'ir.cron') {
      if (typeof desired.get(id)!.active === 'boolean') delete scalar.active;
      if (!bindings[id]) scalar.active = false;
    }
    if (!bindings[id]) operations.push(op(resource, 'create', scalar, 'record'));
    else {
      if (needsAdoption.has(id)) operations.push(op(resource, 'adopt', {}, 'record'));
      if (Object.keys(scalar).length) operations.push(op(resource, 'update', scalar));
    }
    if (Object.keys(relation).length) links.push(op(resource, 'link', relation));
    // Contextual writes may mirror into Odoo's inactive en_US fallback. Restore
    // only affected defaults as explicit reviewed work, after all translations.
    const translationDefaults: Row = {};
    for (const entry of resource.translations?.entries ?? []) {
      const field = schema[resource.model][entry.field];
      const defaultValue = desired.get(id)![entry.field];
      const rows = bindings[id] ? [translations.get(translationKey(id, entry.field, entry.lang))!] : [];
      if (!rows.length || !fieldEqual(rows[0][entry.field], entry.value, field)) {
        links.push(op(resource, 'update', { [entry.field]: entry.value }, `translation:${entry.field}:${entry.lang}`, { lang: entry.lang }));
        translationDefaults[entry.field] = defaultValue;
      }
    }
    if (Object.keys(translationDefaults).length) links.push(op(resource, 'update', translationDefaults, 'translation-defaults'));
  }
  operations.push(...links, ...exactUnlinks);

  for (const request of [...(stored.unlink ?? [])].sort((a, b) => `${a.externalId}.${a.field}`.localeCompare(`${b.externalId}.${b.field}`))) {
    const resource = all.get(request.externalId);
    if (!resource || !selected.has(request.externalId) || !bindings[request.externalId]) fail('UNLINK_TARGET', `Unlink needs an existing selected resource ${request.externalId}`);
    const field = schema[resource.model][request.field];
    if (!field || field.type !== 'many2many') fail('UNLINK_UNSAFE', 'Explicit relation unlink supports M2M only; O2M unlink can delete via cascade and is refused');
    request.ids.forEach(id => assertId(id, 'Unlink target'));
    const desiredIds = await resolveValue(desired.get(resource.externalId)![request.field] ?? [], field.relation) as unknown[];
    if (request.ids.some(id => desiredIds.includes(id))) fail('UNLINK_CONFLICT', `Cannot unlink a desired relation on ${request.externalId}.${request.field}`);
    const rows = await search(resource.model, [['id', '=', bindings[resource.externalId]]], [request.field]);
    const ids = sortedIds(request.ids).filter(id => sortedIds(rows[0]?.[request.field]).includes(id));
    if (ids.length) operations.push(op(resource, 'unlink', { [request.field]: ids.map(id => [3, id, 0]) }, `unlink:${request.field}`));
  }
  for (const request of [...(stored.removals ?? [])].sort((a, b) => a.externalId.localeCompare(b.externalId))) {
    assertId(request.id, 'Removal target'); xmlid(request.externalId);
    if (!['archive', 'delete'].includes(request.action)) fail('REMOVAL_ACTION', 'Removal must explicitly choose archive or delete');
    if (selected.has(request.externalId)) fail('REMOVAL_CONFLICT', `Cannot remove desired resource ${request.externalId}`);
    if (!(stored.owned ?? []).some(owned => equal(owned, { externalId: request.externalId, model: request.model, id: request.id }))) fail('OWNERSHIP_REQUIRED', `Removal requires an exact caller-reviewed ownership entry for ${request.externalId}`);
    const binding = await imd(request.externalId);
    if (!binding && !(await search(request.model, [['id', '=', request.id]], [])).length) continue; // already removed
    if (!binding || binding.model !== request.model || binding.res_id !== request.id) fail('REMOVAL_IDENTITY', `Removal XML ID/model/record mismatch for ${request.externalId}`);
    const aliases = await search('ir.model.data', [['model', '=', request.model], ['res_id', '=', request.id]], ['module', 'name']);
    const other = aliases.filter(alias => `${alias.module}.${alias.name}` !== request.externalId);
    if (other.length) fail('FOREIGN_OWNERSHIP', `${request.externalId} also has protected aliases ${other.map(alias => `${alias.module}.${alias.name}`).join(', ')}; adoption does not authorize deletion/archive`);
    const meta = await fields(request.model);
    if (request.action === 'archive' && meta.active?.type !== 'boolean') fail('ARCHIVE_UNAVAILABLE', `${request.model} lacks an active boolean`);
    const rows = await search(request.model, [['id', '=', request.id]], request.action === 'archive' ? ['active'] : []);
    if (rows.length !== 1) fail('RECORD_UNAVAILABLE', `Removal target ${request.externalId} is missing or inaccessible`);
    if (request.action === 'archive' && rows[0].active === false) continue;
    operations.push({ key: `${request.externalId}:${request.action}`, type: request.action, externalId: request.externalId, model: request.model,
      id: request.id, values: request.action === 'archive' ? { active: false } : {}, context, dependsOn: [] });
  }

  // Pause managed running crons before other mutations, including final disabled
  // crons. Omitted active preserves the observed state; new crons default inactive.
  const managedCrons = resources.filter(r => r.model === 'ir.cron');
  const cronActive = (r: InspectedResource): boolean => typeof desired.get(r.externalId)!.active === 'boolean'
    ? desired.get(r.externalId)!.active as boolean : actual.get(r.externalId)!.active === true;
  const activeCrons = managedCrons.filter(cronActive);
  const needsActivation = activeCrons.filter(r => actual.get(r.externalId)!.active !== true || operations.length > 0);
  const deactivate = managedCrons.filter(r => bindings[r.externalId] && actual.get(r.externalId)!.active === true
    && (!cronActive(r) || operations.length > 0)).map(r => op(r, 'deactivate', { active: false }));
  operations.unshift(...deactivate);
  for (const resource of needsActivation) operations.push(op(resource, 'activate', { active: true }));

  // Build the complete operation DAG before sorting. Resource readiness includes
  // deferred relation/translation/unlink work, not just operations already seen.
  const recordOps = new Map<string, Mutation[]>();
  const operationByKey = new Map<string, Mutation>();
  for (const operation of operations) {
    if (operationByKey.has(operation.key)) fail('DUPLICATE_OPERATION', `Duplicate operation ${operation.key}`);
    operationByKey.set(operation.key, operation);
    const group = recordOps.get(operation.externalId) ?? []; group.push(operation); recordOps.set(operation.externalId, group);
  }
  const seen = new Set<string>();
  for (const operation of operations) {
    const deps = new Set<string>();
    if (operation.type !== 'deactivate') {
      for (const previous of recordOps.get(operation.externalId) ?? []) if (seen.has(previous.key)) deps.add(previous.key);
      const visited = new Set<string>();
      const prerequisite = (id: string, dependentId = operation.externalId): void => {
        // A child's inverse needs its parent's identity; waiting for the parent's
        // child links here would fabricate a cycle. Explicit dependsOn still
        // requests full readiness and may correctly reject an impossible cycle.
        const identityOnly = identityDependency(dependentId, id);
        if (!identityOnly && visited.has(id)) return;
        if (!identityOnly) visited.add(id);
        for (const candidate of recordOps.get(id) ?? []) {
          if (candidate.type === 'activate' || candidate.type === 'deactivate') continue;
          if (!identityOnly || candidate.type === 'create' || candidate.type === 'adopt') deps.add(candidate.key);
        }
        if (identityOnly) return;
        // Own mutations do not necessarily carry all desired relation work:
        // creation must precede children, and existing links may need no write.
        for (const dependency of readinessGraph.get(id) ?? []) prerequisite(dependency, id);
      };
      for (const dependency of creationGraph.get(operation.externalId) ?? []) prerequisite(dependency);
      // Raw symbolic values survive in desired, even when existing target IDs
      // were resolved to numbers in the concrete mutation. Parent child links
      // wait for the child's full work, whose inverse only needs parent identity.
      for (const field of Object.keys(operation.values)) walkRefs(desired.get(operation.externalId)?.[field], prerequisite);
      for (const pause of deactivate) deps.add(pause.key);
      if (operation.type === 'activate') {
        for (const candidate of operations) if (candidate.type !== 'activate') deps.add(candidate.key);
        for (const previous of operations) if (previous.type === 'activate' && seen.has(previous.key)) deps.add(previous.key);
      }
    }
    operation.dependsOn = [...deps].sort(); seen.add(operation.key);
  }
  const executionOrder = sortGraph(new Map(operations.map(operation => [operation.key, new Set(operation.dependsOn)])));
  operations.splice(0, operations.length, ...executionOrder.map(key => operationByKey.get(key)!));
  // Parallel lookup reads may finish in any order. Preserve each query/value
  // observation while canonicalizing their order before hashing the plan.
  const sorted = observations.map(value => ({ value, key: `${value.kind}:${value.key}:${digest(value.value)}` }))
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  sorted.forEach((entry, index) => { observations[index] = entry.value; });
  const result: Omit<Plan, 'digest'> = { kind: 'stateman-plan', version: 1, target, input: complete, options: stored, resources, order, bindings,
    schema, observations, operations, diagnostics: [...new Set(diagnostics)].sort() };
  return { ...copy(result), digest: digest(result) };
}

export async function drift(input: StateInput, connection: StateConnection, options: PlanOptions = {}): Promise<{ converged: boolean; plan: Plan }> {
  const fresh = await plan(input, connection, options);
  return { converged: fresh.operations.length === 0, plan: fresh };
}
