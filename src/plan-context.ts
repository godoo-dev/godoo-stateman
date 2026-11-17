import { OdooAccessError, OdooRpcError } from '@godoo-dev/client';
import type { Inspection, InspectedResource } from './inspect.js';
import { isLookupRef, isResourceRef } from './dsl/types.js';
import { assertId, copy, digest, domain, fail, record, xmlid } from './state-utils.js';
import { StateError } from './state-types.js';
import type { ConnectionIdentity, FieldMetadata, Observation, Row, Schema, StateConnection, StoredPlanOptions } from './state-types.js';

const schemaAttributes = ['type', 'relation', 'relation_field', 'required', 'readonly', 'company_dependent', 'translate', 'store', 'domain', 'context', 'selection'];

/** State shared by the phases of one plan() call. Never reused across plans. */
export interface PlanContext {
  connection: StateConnection;
  complete: Inspection;
  stored: StoredPlanOptions;
  context: Row;
  observations: Observation[];
  diagnostics: string[];
  all: Map<string, InspectedResource>;
  selected: Set<string>;
  target: ConnectionIdentity;
  major: number;
  schema: Schema;
  identities: Map<string, Row | undefined>;
  bindings: Record<string, number>;
  authorizedCompanies?: number[];
  fields(model: string): Promise<Record<string, FieldMetadata>>;
  search(model: string, criteria: unknown[], names: string[], limit?: number, extraContext?: Row): Promise<Row[]>;
  imd(id: string): Promise<Row | undefined>;
  validateDomain(model: string, criteria: unknown[]): Promise<void>;
  resolveValue(value: unknown, expectedModel?: string, valueContext?: Row): Promise<unknown>;
}

export type PlanContextBase = Pick<PlanContext, 'connection' | 'complete' | 'stored' | 'context' | 'observations' | 'diagnostics' | 'all' | 'selected' | 'target' | 'major'>;

export function createPlanContext(base: PlanContextBase): PlanContext {
  const ctx = { ...base, schema: Object.create(null) as Schema, identities: new Map(), bindings: {} } as PlanContext;
  const schemaReads = new Map<string, Promise<Record<string, FieldMetadata>>>();
  // Lifetime is exactly one plan, including in-flight reads. Apply's independent
  // revalidation/final drift therefore never reuse a previous plan's evidence.
  const searches = new Map<string, Promise<Row[]>>();
  ctx.fields = async model => {
    if (ctx.schema[model]) return ctx.schema[model];
    let pending = schemaReads.get(model);
    if (!pending) { pending = readFields(ctx, model); schemaReads.set(model, pending); }
    return pending;
  };
  ctx.search = async (model, criteria, names, limit, extraContext) => {
    const query = copy({ model, domain: criteria, fields: [...new Set(['id', ...names])].sort(), limit, order: 'id', context: { ...ctx.context, ...extraContext } });
    const key = digest(query);
    let pending = searches.get(key);
    if (!pending) { pending = runSearch(ctx, query, key); searches.set(key, pending); }
    // Membership audits may extend their local arrays. No caller owns cached
    // rows or the immutable observation used for stale-plan comparison.
    return copy(await pending);
  };
  ctx.imd = async id => {
    if (ctx.identities.has(id)) return ctx.identities.get(id);
    const { module, name } = xmlid(id);
    const rows = await ctx.search('ir.model.data', [['module', '=', module], ['name', '=', name]], ['model', 'res_id'], 2);
    if (rows.length > 1) fail('IDENTITY_COLLISION', `Multiple XML-ID bindings for ${id}`);
    return rows[0];
  };
  ctx.validateDomain = async (model, criteria) => {
    for (const term of criteria) if (Array.isArray(term) && typeof term[0] === 'string') await validatePath(ctx, model, term[0]);
  };
  ctx.resolveValue = (value, expectedModel, valueContext) => resolveValue(ctx, value, expectedModel, valueContext);
  return ctx;
}

async function readFields(ctx: PlanContext, model: string): Promise<Record<string, FieldMetadata>> {
  let result: Record<string, FieldMetadata>;
  try {
    result = await ctx.connection.client.call(model, 'fields_get', [], { attributes: schemaAttributes, context: ctx.context });
  } catch (cause) {
    if (cause instanceof OdooAccessError) throw new StateError('METADATA_INACCESSIBLE', `Permission denied reading schema for ${model}; model/field availability is unknown`, { cause });
    if (cause instanceof OdooRpcError && cause.data?.name === 'builtins.KeyError' && Array.isArray(cause.data.arguments) && cause.data.arguments[0] === model) throw new StateError('MODEL_MISSING', `Model ${model} is unavailable`, { cause });
    throw cause;
  }
  if (!record(result) || Object.values(result).some(f => !record(f) || typeof f.type !== 'string')) fail('INVALID_SCHEMA', `Invalid fields_get result for ${model}`);
  ctx.schema[model] = copy(result);
  ctx.observations.push({ kind: 'schema', key: model, value: copy(result) });
  return result;
}

type Query = { model: string; domain: unknown[]; fields: string[]; limit?: number; order: string; context: Row };
async function runSearch(ctx: PlanContext, query: Query, key: string): Promise<Row[]> {
  const rows = await ctx.connection.client.searchRead(query.model, query.domain, { fields: query.fields, limit: query.limit, order: query.order, context: query.context });
  if (!Array.isArray(rows) || rows.some(row => !record(row))) fail('INVALID_READ', `Invalid search_read result for ${query.model}`);
  for (const row of rows) assertId(row.id, query.model);
  const result = copy(rows).sort((a, b) => Number(a.id) - Number(b.id));
  ctx.observations.push({ kind: 'search', key, value: { query: copy(query), rows: result } });
  return result;
}

async function validatePath(ctx: PlanContext, model: string, path: string): Promise<void> {
  const parts = path.split('.');
  for (const [index, name] of parts.entries()) {
    if (name === 'id' && index === parts.length - 1) continue;
    const meta = (await ctx.fields(model))[name];
    if (!meta) await failMissingField(ctx, model, name);
    if (name.startsWith('x_')) await checkManualField(ctx, model, name);
    if (index < parts.length - 1) {
      if (!meta.relation) fail('INVALID_LOOKUP', `${model}.${name} is not relational`);
      model = meta.relation;
    }
  }
}
async function failMissingField(ctx: PlanContext, model: string, name: string): Promise<never> {
  let declared: InspectedResource | undefined;
  for (const candidate of ctx.complete.resources.filter(r => r.model === 'ir.model.fields' && r.values.name === name)) {
    if (await declaredModel(ctx, candidate) === model) { declared = candidate; break; }
  }
  if (declared) fail('FIELD_PENDING', `${model}.${name} requires a fresh schema: plan/apply with select: ['${declared.externalId}'] first, then make a fresh consumer plan`);
  fail('FIELD_UNAVAILABLE', `Field ${model}.${name} is unavailable or restricted`);
}
async function declaredModel(ctx: PlanContext, candidate: InspectedResource): Promise<unknown> {
  let targetModel = candidate.values.model;
  const modelId = candidate.values.model_id;
  if (!targetModel && (typeof modelId === 'number' || isLookupRef(modelId) && modelId.model === 'ir.model')) {
    const criteria = typeof modelId === 'number' ? [['id', '=', modelId]] : domain(modelId.domain);
    await ctx.validateDomain('ir.model', criteria);
    const rows = await ctx.search('ir.model', criteria, ['model'], 2);
    if (rows.length === 1) targetModel = rows[0].model;
  }
  return targetModel;
}
async function checkManualField(ctx: PlanContext, model: string, name: string): Promise<void> {
  const rows = await ctx.search('ir.model.fields', [['model', '=', model], ['name', '=', name]], ['state', 'compute'], 2);
  if (rows.length !== 1) fail('METADATA_INACCESSIBLE', `Cannot establish manual field metadata for ${model}.${name}`);
  if (rows[0].state === 'manual' && rows[0].compute) fail('COMPUTED_VALUE_UNSUPPORTED', `Planning cannot read or filter computed values of ${model}.${name}`);
}

async function resolveValue(ctx: PlanContext, value: unknown, expectedModel?: string, valueContext?: Row): Promise<unknown> {
  if (isLookupRef(value)) return resolveLookup(ctx, value, expectedModel, valueContext);
  if (isResourceRef(value)) return resolveResourceRef(ctx, value, expectedModel, valueContext);
  if (Array.isArray(value)) return Promise.all(value.map(v => ctx.resolveValue(v, expectedModel, valueContext)));
  if (record(value)) {
    if ('__type' in value) fail('UNRENDERED_MARKER', 'Content/DSL markers must be rendered before record planning');
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await ctx.resolveValue(v, undefined, valueContext)])));
  }
  if (typeof value === 'number' && expectedModel) {
    assertId(value, expectedModel);
    const rows = await ctx.search(expectedModel, [['id', '=', value]], [], undefined, valueContext);
    if (rows.length !== 1) fail('RECORD_UNAVAILABLE', `Referenced ${expectedModel}#${value} is missing or inaccessible`);
  }
  return value;
}
async function resolveLookup(ctx: PlanContext, value: { model: string; domain: Parameters<typeof domain>[0] }, expectedModel?: string, valueContext?: Row): Promise<unknown> {
  if (expectedModel && value.model !== expectedModel) fail('RELATION_MODEL', `Lookup ${value.model} does not match relation ${expectedModel}`);
  await ctx.fields(value.model);
  await ctx.validateDomain(value.model, domain(value.domain));
  const rows = await ctx.search(value.model, domain(value.domain), [], 2, valueContext);
  if (rows.length !== 1) fail(rows.length ? 'AMBIGUOUS_LOOKUP' : 'LOOKUP_MISSING', `Field lookup for ${value.model} requires exactly one visible record, found ${rows.length}`);
  return rows[0].id;
}
async function resolveResourceRef(ctx: PlanContext, value: { externalId: string }, expectedModel?: string, valueContext?: Row): Promise<unknown> {
  const resource = ctx.all.get(value.externalId);
  if (!resource || !ctx.selected.has(value.externalId)) fail('MISSING_DEPENDENCY', `Missing managed reference ${value.externalId}`);
  if (expectedModel && resource.model !== expectedModel) fail('RELATION_MODEL', `${value.externalId} is ${resource.model}, expected ${expectedModel}`);
  if (valueContext && ctx.bindings[value.externalId]) {
    const rows = await ctx.search(resource.model, [['id', '=', ctx.bindings[value.externalId]]], [], undefined, valueContext);
    if (rows.length !== 1) fail('RECORD_UNAVAILABLE', `${value.externalId} is inaccessible in the intended company context`);
  }
  return ctx.bindings[value.externalId] ?? value;
}

/** Resolve a Reference field value to Odoo's canonical "model,id" form. */
export async function resolveReference(ctx: PlanContext, value: unknown, field: FieldMetadata, label: string): Promise<unknown> {
  if (value === false || value === null) return false;
  let model: string;
  let targetValue: unknown = value;
  if (isResourceRef(value)) {
    const resource = ctx.all.get(value.externalId);
    if (!resource || !ctx.selected.has(value.externalId)) fail('MISSING_DEPENDENCY', `Missing managed reference ${value.externalId}`);
    model = resource.model;
  } else if (isLookupRef(value)) model = value.model;
  else {
    const match = typeof value === 'string' && /^([A-Za-z_][A-Za-z0-9_.]*),([1-9][0-9]*)$/.exec(value);
    if (!match || !Number.isSafeInteger(Number(match[2]))) fail('REFERENCE_VALUE', `${label}: expected a managed ref, lookup, canonical "model,id" or false/null`);
    model = match[1]; targetValue = Number(match[2]);
  }
  if (!validSelection(field.selection)) fail('REFERENCE_METADATA', `${label}: complete Reference selection metadata is required`);
  if (!field.selection.some(([key]) => key === model)) fail('REFERENCE_MODEL', `${label}: target model ${model} is not allowed by Reference selection`);
  await ctx.fields(model);
  const resolved = await ctx.resolveValue(targetValue, model);
  return typeof resolved === 'number' ? `${model},${resolved}` : resolved;
}
function validSelection(selection: unknown): selection is [string, string][] {
  return Array.isArray(selection) && !selection.some(pair => !Array.isArray(pair) || pair.length !== 2 || pair.some(part => typeof part !== 'string') || !pair[0]);
}

/** Company context for companyValues(); the user's authorized companies are read lazily, once per plan. */
export async function companyContext(ctx: PlanContext, company: unknown): Promise<{ companyId: number; context: Row }> {
  const companyId = await ctx.resolveValue(company, 'res.company');
  if (isResourceRef(companyId)) fail('COMPANY_UNRESOLVED', 'Company contexts require existing companies; create companies in an earlier reviewed stage');
  assertId(companyId, 'Company');
  const authorized = await authorizedCompanies(ctx);
  if (!authorized.includes(companyId)) fail('COMPANY_ACCESS', `Company ${companyId} is not authorized for the authenticated user`);
  const visible = ctx.context.allowed_company_ids ?? [companyId];
  if (!Array.isArray(visible) || !visible.length || visible.some(id => !Number.isSafeInteger(id) || !authorized.includes(id)) || !visible.includes(companyId) || new Set(visible).size !== visible.length) fail('COMPANY_CONTEXT', `Base allowed_company_ids must authorize and include company ${companyId}`);
  return { companyId, context: { ...ctx.context, allowed_company_ids: [companyId, ...visible.filter(id => id !== companyId)] } };
}
async function authorizedCompanies(ctx: PlanContext): Promise<number[]> {
  if (!ctx.authorizedCompanies) {
    const users = await ctx.search('res.users', [['id', '=', ctx.target.uid]], ['company_ids']);
    if (users.length !== 1 || !Array.isArray(users[0].company_ids)) fail('COMPANY_ACCESS', 'Cannot read the authenticated user company authorization');
    ctx.authorizedCompanies = users[0].company_ids as number[];
    ctx.authorizedCompanies.forEach(id => assertId(id, 'Authorized company'));
  }
  return ctx.authorizedCompanies;
}
