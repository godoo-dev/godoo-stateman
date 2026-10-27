import { resource } from './dsl/resource.js';
import { lookup } from './dsl/lookup.js';
import type { LookupRef, ResourceDefinition, ResourceOptions } from './dsl/types.js';
import type { InspectedResource } from './inspect.js';
import type { FieldMetadata, Row } from './state-types.js';
import { equal, fail } from './state-utils.js';

export interface ComputedFieldValues {
  _ref?: LookupRef;
  name: string;
  label: string;
  type: 'json';
  store: false;
  readonly: true;
  compute: string;
  depends: readonly string[];
  help?: string;
}
/** Plain source bytes become an ordinary, protected ir.model.fields resource. */
export function computedField(model: string, externalId: string, values: ComputedFieldValues, options?: ResourceOptions): ResourceDefinition {
  const { label, type, depends, ...native } = values;
  if (!model || !/^x_[a-zA-Z0-9_]+$/.test(values.name) || type !== 'json' || values.store !== false || values.readonly !== true || !values.compute?.trim() || !Array.isArray(depends)) fail('FIELD_SHAPE_UNSUPPORTED', 'computedField requires an x_ JSON, readonly, nonstored compute with explicit depends');
  return resource('ir.model.fields', externalId, { ...native, field_description: label, ttype: type,
    depends: depends.join(','), state: 'manual', model_id: lookup('ir.model', { model }) }, options);
}
export const dependencyPaths = (value: unknown): string[] => typeof value === 'string' ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
export const fieldGuardNames = ['model', 'model_id', 'name', 'state', 'modules', 'ttype', 'store', 'readonly', 'compute', 'depends', 'relation', 'related', 'company_dependent', 'translate'] as const;
type Search = (model: string, criteria: any[], names: string[], limit?: number) => Promise<Row[]>;
type Fields = (model: string) => Promise<Record<string, FieldMetadata>>;
function hasSupportedComputeShape(field: Row): boolean {
  return field.ttype === 'json' && field.store === false && field.readonly === true
    && typeof field.compute === 'string' && !!field.compute.trim()
    && !field.relation && !field.related && !field.company_dependent && !field.translate;
}
/** Guard all binding paths, including XML IDs and recovered IDs, before authored-field reads. */
export async function protectComputedFields(resources: InspectedResource[], bindings: Record<string, number>, search: Search, fields: Fields, resolve: (value: unknown, model?: string) => Promise<unknown>): Promise<void> {
  for (const resource of resources.filter(r => r.model === 'ir.model.fields')) {
    const id = resource.externalId, values = resource.values;
    const meta = await fields('ir.model.fields');
    for (const name of fieldGuardNames) if (!meta[name]) fail('METADATA_INACCESSIBLE', `${id}: compatibility metadata ${name} unavailable`);
    const rows = bindings[id] ? await search(resource.model, [['id', '=', bindings[id]]], [...fieldGuardNames], 2) : [];
    if (bindings[id] && rows.length !== 1) fail('RECORD_UNAVAILABLE', `${id}: field metadata unavailable`);
    const current = rows[0];
    if (current && fieldGuardNames.some(name => !(name in current))) fail('METADATA_INACCESSIBLE', `${id}: incomplete compatibility metadata`);
    if (current && (current.state !== 'manual' || current.modules)) fail('FIELD_BASE_PROTECTED', `${id}: base/module-defined fields cannot be managed`);
    if (current && !hasSupportedComputeShape(current)) fail('FIELD_INCOMPATIBLE', `${id}: existing field is not a readonly nonstored JSON compute; adoption and aliases cannot convert it`);
    const resolved: Row = { ...values };
    if ('model_id' in values) resolved.model_id = await resolve(values.model_id, 'ir.model');
    const m2o = (v: unknown): unknown => Array.isArray(v) ? v[0] : v;
    if (current) {
      for (const name of ['model', 'model_id', 'name', 'state', 'ttype', 'store', 'relation', 'related', 'company_dependent', 'translate']) {
        if (name in resolved && !equal(m2o(resolved[name]), m2o(current[name]))) fail('FIELD_TRANSITION_UNSUPPORTED', `${id}: changing ${name} is unsupported`);
      }
    }
    // Permit partial updates, but the effective field must always satisfy v1.
    const effective: Row = { state: 'manual', ...current, ...resolved };
    if (!current) {
      if (!Number.isSafeInteger(effective.model_id)) fail('FIELD_SHAPE_UNSUPPORTED', `${id}: model_id must resolve to an existing ir.model`);
      const models = await search('ir.model', [['id', '=', effective.model_id]], ['model'], 2);
      if (models.length !== 1) fail('METADATA_INACCESSIBLE', `${id}: target model unavailable`);
      if (effective.model && effective.model !== models[0].model) fail('FIELD_TRANSITION_UNSUPPORTED', `${id}: conflicting model/model_id`);
      effective.model = models[0].model;
      if ((await search('ir.model.fields', [['model', '=', effective.model], ['name', '=', effective.name]], [], 2)).length) fail('FIELD_NAME_TAKEN', `${id}: ${effective.model}.${effective.name} already exists; use explicit _ref adoption`);
    }
    const allowed = new Set(['model', 'model_id', 'name', 'state', 'ttype', 'store', 'readonly', 'compute', 'depends', 'field_description', 'help', 'relation', 'related', 'company_dependent', 'translate']);
    if (Object.keys(values).some(name => !allowed.has(name)) || effective.state !== 'manual' || typeof effective.name !== 'string' || !/^x_[a-zA-Z0-9_]+$/.test(effective.name) || !hasSupportedComputeShape(effective)) fail('FIELD_SHAPE_UNSUPPORTED', `${id}: only manual x_ readonly nonstored JSON computed fields are supported`);
    if (current) {
      const live = (await fields(String(effective.model)))[String(effective.name)];
      if (!live || live.type !== 'json' || live.store !== false || live.readonly !== true) fail('FIELD_NOT_READY', `${id}: fresh target-model metadata does not match the protected field`);
    }
    if ('depends' in values && typeof values.depends !== 'string') fail('FIELD_DEPENDS_INVALID', `${id}: depends must be comma-separated paths`);
    for (const path of dependencyPaths(effective.depends)) {
      let model = String(effective.model);
      const parts = path.split('.');
      for (let index = 0; index < parts.length; index++) {
        const name = parts[index], field = (await fields(model))[name];
        if (!field || name === effective.name && model === effective.model) fail('FIELD_DEPENDS_INVALID', `${id}: invalid dependency ${path} at ${model}.${name}`);
        if (index < parts.length - 1) {
          if (!field.relation) fail('FIELD_DEPENDS_INVALID', `${id}: ${model}.${name} is not relational`);
          model = field.relation;
        }
      }
    }
  }
}
