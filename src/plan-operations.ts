import type { InspectedResource } from './inspect.js';
import { isLookupRef, isResourceRef } from './dsl/types.js';
import { isCompanyValues, isExact } from './dsl/scoped-values.js';
import type { CompanyValues } from './dsl/scoped-values.js';
import { dependencyPaths } from './computed-fields.js';
import { assertId, equal, fail, sortGraph, walkRefs, xmlid } from './state-utils.js';
import { companyContext, resolveReference } from './plan-context.js';
import type { PlanContext } from './plan-context.js';
import { companyScalar, exactKey, fieldEqual, multiple, normalized, sortedIds, translationKey } from './plan-values.js';
import type { FieldMetadata, Mutation, Row } from './state-types.js';

/** Observed and desired state gathered by plan() before operations are derived. */
export interface PlanState {
  resources: InspectedResource[];
  desired: Map<string, Row>;
  order: string[];
  creationGraph: Map<string, Set<string>>;
  readinessGraph: Map<string, Set<string>>;
  actual: Map<string, Row>;
  needsAdoption: Set<string>;
  effective: Map<string, Map<number, Row>>;
  exactState: Map<string, { current: number[]; inScope: number[] }>;
  translations: Map<string, Row>;
}
interface Pending {
  operations: Mutation[];
  links: Mutation[];
  exactUnlinks: Mutation[];
}

export async function buildOperations(ctx: PlanContext, state: PlanState): Promise<Mutation[]> {
  const pending: Pending = { operations: [], links: [], exactUnlinks: [] };
  for (const id of state.order) await diffResource(ctx, state, ctx.all.get(id)!, pending);
  const operations = pending.operations;
  operations.push(...pending.links, ...pending.exactUnlinks);
  await explicitUnlinks(ctx, state, operations);
  await removals(ctx, operations);
  const deactivate = cronToggles(ctx, state, operations);
  orderOperations(ctx, state, operations, deactivate);
  return operations;
}

function op(ctx: PlanContext, resource: InspectedResource, type: Mutation['type'], values: Row, suffix: string = type, opContext?: Row): Mutation {
  return {
    key: `${resource.externalId}:${suffix}`,
    type,
    externalId: resource.externalId,
    model: resource.model,
    ...(ctx.bindings[resource.externalId] ? { id: ctx.bindings[resource.externalId] } : {}),
    values,
    context: { ...ctx.context, ...opContext },
    dependsOn: [],
  };
}

async function diffResource(ctx: PlanContext, state: PlanState, resource: InspectedResource, pending: Pending): Promise<void> {
  const id = resource.externalId;
  const scalar: Row = {},
    relation: Row = {};
  for (const [name, raw] of Object.entries(state.desired.get(id)!).sort(([a], [b]) => a.localeCompare(b))) {
    const field = ctx.schema[resource.model][name];
    if (isCompanyValues(raw)) await diffCompanyValues(ctx, state, resource, name, raw, field, pending.links);
    else await diffField(ctx, state, resource, name, raw, field, { scalar, relation, exactUnlinks: pending.exactUnlinks });
  }
  if (resource.model === 'ir.cron') {
    if (typeof state.desired.get(id)!.active === 'boolean') delete scalar.active;
    if (!ctx.bindings[id]) scalar.active = false;
  }
  recordOperations(ctx, state, resource, scalar, pending.operations);
  if (Object.keys(relation).length) pending.links.push(op(ctx, resource, 'link', relation));
  translationOperations(ctx, state, resource, pending.links);
}

async function diffCompanyValues(
  ctx: PlanContext,
  state: PlanState,
  resource: InspectedResource,
  name: string,
  raw: CompanyValues,
  field: FieldMetadata,
  links: Mutation[],
): Promise<void> {
  const id = resource.externalId,
    bound = ctx.bindings[id];
  if (!bound && field.required) fail('COMPANY_CREATE_REQUIRED', `${id}.${name}: required company-dependent fields need an existing resource`);
  const entries: { companyId: number; context: Row; value: unknown }[] = [];
  for (const entry of raw.entries) {
    const scope = await companyContext(ctx, entry.company);
    if (entries.some(previous => previous.companyId === scope.companyId))
      fail('COMPANY_VALUE_DUPLICATE', `${id}.${name}: duplicate company ${scope.companyId}`);
    const value = await ctx.resolveValue(entry.value, field.relation, scope.context);
    if (!companyScalar(value, field))
      fail(
        'COMPANY_VALUE_INVALID',
        `${id}.${name}: expected an effective ${field.type} value; null and fallback-reset markers are unsupported (numeric fields use 0, not false)`,
      );
    entries.push({ ...scope, value });
  }
  for (const entry of entries.sort((a, b) => a.companyId - b.companyId)) {
    const rows = bound ? [state.effective.get(id)!.get(entry.companyId)!] : [];
    if (bound && rows.length !== 1) fail('RECORD_UNAVAILABLE', `${id}: inaccessible in company ${entry.companyId}`);
    if (bound && fieldEqual(entry.value, rows[0][name], field)) continue;
    const mutation = op(ctx, resource, 'update', { [name]: entry.value }, `company:${name}:${entry.companyId}`, entry.context);
    mutation.companyId = entry.companyId;
    mutation.before = { [name]: bound ? normalized(rows[0][name], field) : null };
    links.push(mutation);
  }
}

type FieldTargets = { scalar: Row; relation: Row; exactUnlinks: Mutation[] };
async function diffField(
  ctx: PlanContext,
  state: PlanState,
  resource: InspectedResource,
  name: string,
  raw: unknown,
  field: FieldMetadata,
  targets: FieldTargets,
): Promise<void> {
  const id = resource.externalId;
  const intended = isExact(raw) ? raw.targets : raw;
  if (multiple(field) && (!Array.isArray(intended) || intended.some(v => !(typeof v === 'number' || isLookupRef(v) || isResourceRef(v)))))
    fail('RELATION_VALUE', `${id}.${name}: use a list of IDs/lookups/refs, not raw relation commands`);
  if (isExact(raw) && (ctx.stored.unlink ?? []).some(request => request.externalId === id && request.field === name))
    fail('UNLINK_CONFLICT', `${id}.${name}: exact() cannot combine with an explicit unlink request`);
  const value = field.type === 'reference' ? await resolveReference(ctx, intended, field, `${id}.${name}`) : await ctx.resolveValue(intended, field.relation);
  if (field.type === 'many2one' && !(value === false || value === null || typeof value === 'number' || isResourceRef(value)))
    fail('RELATION_VALUE', `${id}.${name}: expected a single relation target`);
  if (multiple(field)) diffRelation(ctx, state, resource, name, raw, value as unknown[], targets);
  else if (!ctx.bindings[id] || !scalarEqual(state, resource, name, value, field)) targets.scalar[name] = value;
}
function scalarEqual(state: PlanState, resource: InspectedResource, name: string, value: unknown, field: FieldMetadata): boolean {
  const current = state.actual.get(resource.externalId)![name];
  return resource.model === 'ir.model.fields' && name === 'depends'
    ? equal(dependencyPaths(value), dependencyPaths(current))
    : fieldEqual(value, current, field);
}

// Positive links preserve all unrelated/manual relationships. A removal
// needs a separately enumerated unlink request, never set/clear commands.
function diffRelation(
  ctx: PlanContext,
  state: PlanState,
  resource: InspectedResource,
  name: string,
  raw: unknown,
  value: unknown[],
  targets: FieldTargets,
): void {
  const id = resource.externalId;
  let current = sortedIds(state.actual.get(id)![name]);
  if (isExact(raw)) {
    if (ctx.bindings[id] && !Array.isArray(state.actual.get(id)![name])) fail('EXACT_VISIBILITY', `${id}.${name}: incomplete relation read`);
    // Explicit empty initial membership suppresses server defaults on a
    // new record. Desired targets are linked after their identities exist.
    // This is never emitted for an existing record or an ordinary list.
    if (!ctx.bindings[id]) targets.scalar[name] = [[6, 0, []]];
    const exactState = state.exactState.get(exactKey(id, name))!;
    current = [...exactState.current];
    for (const target of value)
      if (typeof target === 'number' && !exactState.inScope.includes(target))
        fail('EXACT_VISIBILITY', `${id}.${name}: desired target ${target} is outside the owned company scope`);
    const unexpected = current.filter(linked => !value.includes(linked));
    if (unexpected.length) targets.exactUnlinks.push(op(ctx, resource, 'unlink', { [name]: unexpected.map(linked => [3, linked, 0]) }, `unlink:${name}`));
  }
  const missing = value.filter(v => typeof v !== 'number' || !current.includes(v));
  if (missing.length) targets.relation[name] = missing.map(v => [4, v, 0]);
}

function recordOperations(ctx: PlanContext, state: PlanState, resource: InspectedResource, scalar: Row, operations: Mutation[]): void {
  const id = resource.externalId;
  if (!ctx.bindings[id]) {
    operations.push(op(ctx, resource, 'create', scalar, 'record'));
    return;
  }
  if (state.needsAdoption.has(id)) operations.push(op(ctx, resource, 'adopt', {}, 'record'));
  if (!Object.keys(scalar).length) return;
  const update = op(ctx, resource, 'update', scalar);
  if (resource.model === 'ir.model.fields') update.before = Object.fromEntries(Object.keys(scalar).map(name => [name, state.actual.get(id)![name]]));
  operations.push(update);
}

// Contextual writes may mirror into Odoo's inactive en_US fallback. Restore
// only affected defaults as explicit reviewed work, after all translations.
function translationOperations(ctx: PlanContext, state: PlanState, resource: InspectedResource, links: Mutation[]): void {
  const id = resource.externalId;
  const translationDefaults: Row = {};
  for (const entry of resource.translations?.entries ?? []) {
    const field = ctx.schema[resource.model][entry.field];
    const rows = ctx.bindings[id] ? [state.translations.get(translationKey(id, entry.field, entry.lang))!] : [];
    if (rows.length && fieldEqual(rows[0][entry.field], entry.value, field)) continue;
    links.push(op(ctx, resource, 'update', { [entry.field]: entry.value }, `translation:${entry.field}:${entry.lang}`, { lang: entry.lang }));
    translationDefaults[entry.field] = state.desired.get(id)![entry.field];
  }
  if (Object.keys(translationDefaults).length) links.push(op(ctx, resource, 'update', translationDefaults, 'translation-defaults'));
}

async function explicitUnlinks(ctx: PlanContext, state: PlanState, operations: Mutation[]): Promise<void> {
  for (const request of [...(ctx.stored.unlink ?? [])].sort((a, b) => `${a.externalId}.${a.field}`.localeCompare(`${b.externalId}.${b.field}`))) {
    const resource = ctx.all.get(request.externalId);
    if (!resource || !ctx.selected.has(request.externalId) || !ctx.bindings[request.externalId])
      fail('UNLINK_TARGET', `Unlink needs an existing selected resource ${request.externalId}`);
    const field = ctx.schema[resource.model][request.field];
    if (!field || field.type !== 'many2many')
      fail('UNLINK_UNSAFE', 'Explicit relation unlink supports M2M only; O2M unlink can delete via cascade and is refused');
    request.ids.forEach(id => assertId(id, 'Unlink target'));
    const desiredIds = (await ctx.resolveValue(state.desired.get(resource.externalId)![request.field] ?? [], field.relation)) as unknown[];
    if (request.ids.some(id => desiredIds.includes(id))) fail('UNLINK_CONFLICT', `Cannot unlink a desired relation on ${request.externalId}.${request.field}`);
    const rows = await ctx.search(resource.model, [['id', '=', ctx.bindings[resource.externalId]]], [request.field]);
    const ids = sortedIds(request.ids).filter(id => sortedIds(rows[0]?.[request.field]).includes(id));
    if (ids.length) operations.push(op(ctx, resource, 'unlink', { [request.field]: ids.map(id => [3, id, 0]) }, `unlink:${request.field}`));
  }
}

type Removal = NonNullable<PlanContext['stored']['removals']>[number];
async function removals(ctx: PlanContext, operations: Mutation[]): Promise<void> {
  for (const request of [...(ctx.stored.removals ?? [])].sort((a, b) => a.externalId.localeCompare(b.externalId))) {
    checkRemovalRequest(ctx, request);
    const binding = await ctx.imd(request.externalId);
    if (!binding && !(await ctx.search(request.model, [['id', '=', request.id]], [])).length) continue; // already removed
    if (!binding || binding.model !== request.model || binding.res_id !== request.id)
      fail('REMOVAL_IDENTITY', `Removal XML ID/model/record mismatch for ${request.externalId}`);
    const aliases = await ctx.search(
      'ir.model.data',
      [
        ['model', '=', request.model],
        ['res_id', '=', request.id],
      ],
      ['module', 'name'],
    );
    const other = aliases.filter(alias => `${alias.module}.${alias.name}` !== request.externalId);
    if (other.length)
      fail(
        'FOREIGN_OWNERSHIP',
        `${request.externalId} also has protected aliases ${other.map(alias => `${alias.module}.${alias.name}`).join(', ')}; adoption does not authorize deletion/archive`,
      );
    const meta = await ctx.fields(request.model);
    if (request.action === 'archive' && meta.active?.type !== 'boolean') fail('ARCHIVE_UNAVAILABLE', `${request.model} lacks an active boolean`);
    const rows = await ctx.search(request.model, [['id', '=', request.id]], request.action === 'archive' ? ['active'] : []);
    if (rows.length !== 1) fail('RECORD_UNAVAILABLE', `Removal target ${request.externalId} is missing or inaccessible`);
    if (request.action === 'archive' && rows[0].active === false) continue;
    operations.push({
      key: `${request.externalId}:${request.action}`,
      type: request.action,
      externalId: request.externalId,
      model: request.model,
      id: request.id,
      values: request.action === 'archive' ? { active: false } : {},
      context: ctx.context,
      dependsOn: [],
    });
  }
}
function checkRemovalRequest(ctx: PlanContext, request: Removal): void {
  if (request.model === 'ir.model.fields') fail('FIELD_REMOVAL_UNSUPPORTED', 'Field archive/delete is unsupported; omission preserves the field');
  assertId(request.id, 'Removal target');
  xmlid(request.externalId);
  if (!['archive', 'delete'].includes(request.action)) fail('REMOVAL_ACTION', 'Removal must explicitly choose archive or delete');
  if (ctx.selected.has(request.externalId)) fail('REMOVAL_CONFLICT', `Cannot remove desired resource ${request.externalId}`);
  if (!(ctx.stored.owned ?? []).some(owned => equal(owned, { externalId: request.externalId, model: request.model, id: request.id })))
    fail('OWNERSHIP_REQUIRED', `Removal requires an exact caller-reviewed ownership entry for ${request.externalId}`);
}

// Pause managed running crons before other mutations, including final disabled
// crons. Omitted active preserves the observed state; new crons default inactive.
function cronToggles(ctx: PlanContext, state: PlanState, operations: Mutation[]): Mutation[] {
  const managedCrons = state.resources.filter(r => r.model === 'ir.cron');
  const cronActive = (r: InspectedResource): boolean =>
    typeof state.desired.get(r.externalId)!.active === 'boolean'
      ? (state.desired.get(r.externalId)!.active as boolean)
      : state.actual.get(r.externalId)!.active === true;
  const activeCrons = managedCrons.filter(cronActive);
  const needsActivation = activeCrons.filter(r => state.actual.get(r.externalId)!.active !== true || operations.length > 0);
  const deactivate = managedCrons
    .filter(r => ctx.bindings[r.externalId] && state.actual.get(r.externalId)!.active === true && (!cronActive(r) || operations.length > 0))
    .map(r => op(ctx, r, 'deactivate', { active: false }));
  operations.unshift(...deactivate);
  for (const resource of needsActivation) operations.push(op(ctx, resource, 'activate', { active: true }));
  return deactivate;
}

// Build the complete operation DAG before sorting. Resource readiness includes
// deferred relation/translation/unlink work, not just operations already seen.
function orderOperations(ctx: PlanContext, state: PlanState, operations: Mutation[], deactivate: Mutation[]): void {
  const recordOps = new Map<string, Mutation[]>();
  const operationByKey = new Map<string, Mutation>();
  for (const operation of operations) {
    if (operationByKey.has(operation.key)) fail('DUPLICATE_OPERATION', `Duplicate operation ${operation.key}`);
    operationByKey.set(operation.key, operation);
    const group = recordOps.get(operation.externalId) ?? [];
    group.push(operation);
    recordOps.set(operation.externalId, group);
  }
  const seen = new Set<string>();
  for (const operation of operations) {
    operation.dependsOn =
      operation.type === 'deactivate' ? [] : [...operationDependencies(ctx, state, operation, { operations, recordOps, seen, deactivate })].sort();
    seen.add(operation.key);
  }
  const executionOrder = sortGraph(new Map(operations.map(operation => [operation.key, new Set(operation.dependsOn)])));
  operations.splice(0, operations.length, ...executionOrder.map(key => operationByKey.get(key)!));
}

type Scheduling = { operations: Mutation[]; recordOps: Map<string, Mutation[]>; seen: Set<string>; deactivate: Mutation[] };
function operationDependencies(ctx: PlanContext, state: PlanState, operation: Mutation, scheduling: Scheduling): Set<string> {
  const { operations, recordOps, seen, deactivate } = scheduling;
  const deps = new Set<string>();
  for (const previous of recordOps.get(operation.externalId) ?? []) if (seen.has(previous.key)) deps.add(previous.key);
  const prerequisite = prerequisites(ctx, state, operation, recordOps, deps);
  for (const dependency of state.creationGraph.get(operation.externalId) ?? []) prerequisite(dependency);
  // Raw symbolic values survive in desired, even when existing target IDs
  // were resolved to numbers in the concrete mutation. Parent child links
  // wait for the child's full work, whose inverse only needs parent identity.
  for (const field of Object.keys(operation.values)) walkRefs(state.desired.get(operation.externalId)?.[field], prerequisite);
  for (const pause of deactivate) deps.add(pause.key);
  if (operation.type === 'activate') {
    for (const candidate of operations) if (candidate.type !== 'activate') deps.add(candidate.key);
    for (const previous of operations) if (previous.type === 'activate' && seen.has(previous.key)) deps.add(previous.key);
  }
  return deps;
}

function prerequisites(
  ctx: PlanContext,
  state: PlanState,
  operation: Mutation,
  recordOps: Map<string, Mutation[]>,
  deps: Set<string>,
): (id: string, dependentId?: string) => void {
  const visited = new Set<string>();
  const identityDependency = (dependentId: string, id: string): boolean => {
    const dependent = ctx.all.get(dependentId);
    return dependent?.parentScope?.parentExternalId === id && !dependent.options?.dependsOn?.includes(id);
  };
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
    for (const dependency of state.readinessGraph.get(id) ?? []) prerequisite(dependency, id);
  };
  return prerequisite;
}
