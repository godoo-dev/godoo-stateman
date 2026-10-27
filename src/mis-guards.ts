import type { InspectedResource } from './inspect.js';
import { isExact } from './dsl/scoped-values.js';
import { isResourceRef } from './dsl/types.js';
import type { Row } from './state-types.js';
import { fail } from './state-utils.js';

type Search = (model: string, criteria: any[], names: string[], limit?: number) => Promise<Row[]>;
/** Native destructive inverses and ambiguous retained rows are never implicit migrations. */
export async function protectMis(resources: InspectedResource[], bindings: Record<string, number>, search: Search, resolve: (value: unknown, model?: string) => Promise<unknown>, diagnostics: string[]): Promise<void> {
  const byId = new Map(resources.map(r => [r.externalId, r]));
  const m2o = (v: unknown): unknown => Array.isArray(v) ? v[0] : v;
  for (const r of resources) {
    const v = r.values, id = bindings[r.externalId];
    if (r.model.startsWith('mis.') && id && r.parentScope?.inverseField && r.parentScope.parentExternalId) {
      const inverse = r.parentScope.inverseField, parentId = bindings[r.parentScope.parentExternalId];
      const rows = await search(r.model, [['id', '=', id]], [inverse], 2);
      if (!parentId || rows.length !== 1 || m2o(rows[0][inverse]) !== parentId) fail('MIS_PARENT_CONFLICT', `${r.externalId}: existing MIS children cannot be silently reparented`);
    }
    if (r.model === 'mis.report.instance' && v.multi_company === true) {
      const authored = isExact(v.company_ids) ? v.company_ids.targets : v.company_ids;
      if (!Array.isArray(authored) || !authored.length) fail('MIS_COMPANY_SCOPE', `${r.externalId}: multi-company scope must be explicit and nonempty`);
      const companies = await resolve(authored, 'res.company') as unknown[];
      if (companies.some(c => typeof c !== 'number')) fail('MIS_COMPANY_PENDING', `${r.externalId}: group companies must exist and be authorized before planning`);
      const rows = await search('res.company', [['id', 'in', companies]], ['currency_id']);
      if (rows.length !== new Set(companies).size || rows.some(row => !m2o(row.currency_id))) fail('METADATA_INACCESSIBLE', `${r.externalId}: company currencies unavailable`);
      if (new Set(rows.map(row => m2o(row.currency_id))).size > 1 && !v.currency_id) fail('MIS_CURRENCY_REQUIRED', `${r.externalId}: companies with different currencies require an explicit reporting currency`);
    }
    if (r.model === 'mis.report.instance' && 'comparison_mode' in v) fail('MIS_DESTRUCTIVE_INVERSE', `${r.externalId}: manage date_from/date_to and periods; comparison_mode has a destructive inverse`);
    if (r.model === 'mis.report.kpi') {
      if ('expression' in v) fail('MIS_DESTRUCTIVE_INVERSE', `${r.externalId}: manage expression_ids children instead of native expression inverse`);
      if (id && 'multi' in v) {
        const rows = await search(r.model, [['id', '=', id]], ['multi'], 2);
        if (rows.length !== 1 || rows[0].multi !== v.multi) fail('MIS_MULTI_TRANSITION', `${r.externalId}: multi/scalar transitions need an explicit migration`);
      }
      if (id && (v.multi === true || v.multi === false) && Array.isArray(v.expression_ids)) {
        const rows = await search('mis.report.kpi.expression', [['kpi_id', '=', id]], ['subkpi_id']);
        const expressions = v.expression_ids.filter(isResourceRef);
        if (v.multi) {
          for (const expression of expressions) {
            const child = byId.get(expression.externalId);
            if (!child || !('subkpi_id' in child.values)) continue;
            const sub = await resolve(child.values.subkpi_id, 'mis.report.subkpi');
            if (typeof sub === 'number' && rows.some(row => m2o(row.subkpi_id) === sub && Number(row.id) !== bindings[expression.externalId])) fail('MIS_EXPRESSION_CONFLICT', `${expression.externalId}: explicitly adopt the retained sub-KPI expression`);
          }
        } else {
          const desired = expressions.map(e => bindings[e.externalId]);
          if (rows.length > 1 || rows.some(row => !desired.includes(Number(row.id)) || row.subkpi_id)) fail('MIS_EXPRESSION_CONFLICT', `${r.externalId}: retained scalar expression conflicts; explicitly adopt the existing expression or remove owned conflicts`);
        }
      }
    }
    if (r.model === 'mis.report.instance.period' && id && Array.isArray(v.source_sumcol_ids)) {
      const rows = await search('mis.report.instance.period.sum', [['period_id', '=', id]], []);
      const desired = v.source_sumcol_ids.filter(isResourceRef).map(e => bindings[e.externalId]);
      if (rows.some(row => !desired.includes(Number(row.id)))) fail('MIS_SUM_CONFLICT', `${r.externalId}: retained sum terms change the result; explicitly adopt/remove them`);
    }
    if (r.model === 'mis.report.query' && 'field_ids' in v && 'model_id' in v) {
      const modelId = await resolve(v.model_id, 'ir.model');
      const models = await search('ir.model', [['id', '=', modelId]], ['model'], 2);
      if (models.length !== 1) fail('METADATA_INACCESSIBLE', `${r.externalId}: query model is unavailable`);
      const model = models[0].model;
      async function metadata(value: unknown): Promise<Row> {
        if (isResourceRef(value) && !bindings[value.externalId]) {
          const field = byId.get(value.externalId);
          if (field?.model !== 'ir.model.fields' || await resolve(field.values.model_id, 'ir.model') !== modelId) fail('MIS_QUERY_FIELD', `${r.externalId}: field belongs to another model`);
          return field.values;
        }
        const fieldId = await resolve(value, 'ir.model.fields');
        const rows = await search('ir.model.fields', [['id', '=', fieldId]], ['model', 'ttype', 'store', 'relation'], 2);
        if (rows.length !== 1 || rows[0].model !== model) fail('MIS_QUERY_FIELD', `${r.externalId}: query field must belong to ${model}`);
        return rows[0];
      }
      if (!Array.isArray(v.field_ids)) fail('MIS_QUERY_FIELD', `${r.externalId}: field_ids must be a list`);
      for (const field of v.field_ids) {
        const meta = await metadata(field);
        if (v.aggregate && (!['integer', 'float', 'monetary'].includes(String(meta.ttype)) || meta.store !== true)) fail('MIS_QUERY_AGGREGATE', `${r.externalId}: numeric aggregation requires stored numeric fields; JSON/nonstored fields need aggregate false`);
      }
      if ('date_field' in v && !['date', 'datetime'].includes(String((await metadata(v.date_field)).ttype))) fail('MIS_QUERY_DATE', `${r.externalId}: dateField requires a date/datetime field`);
      if (v.company_field_id && (await metadata(v.company_field_id)).relation !== 'res.company') fail('MIS_QUERY_COMPANY', `${r.externalId}: companyField must relate to res.company`);
      diagnostics.push(`${r.externalId}: generic queries apply date/company filters; target_move and analytic filters are not inherited. Domain/expression dependencies remain explicit.`);
    }
  }
}
