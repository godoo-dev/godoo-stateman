import type { InspectedResource } from './inspect.js';
import { isExact } from './dsl/scoped-values.js';
import { isResourceRef } from './dsl/types.js';
import type { Row } from './state-types.js';
import { fail } from './state-utils.js';

type Search = (model: string, criteria: unknown[], names: string[], limit?: number) => Promise<Row[]>;
type Resolve = (value: unknown, model?: string) => Promise<unknown>;
interface MisGuard {
  byId: Map<string, InspectedResource>;
  bindings: Record<string, number>;
  search: Search;
  resolve: Resolve;
  diagnostics: string[];
}
const m2o = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** Native destructive inverses and ambiguous retained rows are never implicit migrations. */
export async function protectMis(
  resources: InspectedResource[],
  bindings: Record<string, number>,
  search: Search,
  resolve: Resolve,
  diagnostics: string[],
): Promise<void> {
  const guard: MisGuard = { byId: new Map(resources.map(r => [r.externalId, r])), bindings, search, resolve, diagnostics };
  for (const r of resources) {
    const v = r.values;
    await checkParent(guard, r);
    if (r.model === 'mis.report.instance' && v.multi_company === true) await checkCompanyScope(guard, r);
    if (r.model === 'mis.report.instance' && 'comparison_mode' in v)
      fail('MIS_DESTRUCTIVE_INVERSE', `${r.externalId}: manage date_from/date_to and periods; comparison_mode has a destructive inverse`);
    if (r.model === 'mis.report.kpi') await checkKpi(guard, r);
    if (r.model === 'mis.report.instance.period' && bindings[r.externalId] && Array.isArray(v.source_sumcol_ids))
      await checkSumTerms(guard, r, v.source_sumcol_ids);
    if (r.model === 'mis.report.query' && 'field_ids' in v && 'model_id' in v) await checkQuery(guard, r);
  }
}

async function checkParent(guard: MisGuard, r: InspectedResource): Promise<void> {
  const id = guard.bindings[r.externalId];
  if (!r.model.startsWith('mis.') || !id || !r.parentScope?.inverseField || !r.parentScope.parentExternalId) return;
  const inverse = r.parentScope.inverseField,
    parentId = guard.bindings[r.parentScope.parentExternalId];
  const rows = await guard.search(r.model, [['id', '=', id]], [inverse], 2);
  if (!parentId || rows.length !== 1 || m2o(rows[0][inverse]) !== parentId)
    fail('MIS_PARENT_CONFLICT', `${r.externalId}: existing MIS children cannot be silently reparented`);
}

async function checkCompanyScope(guard: MisGuard, r: InspectedResource): Promise<void> {
  const v = r.values;
  const authored = isExact(v.company_ids) ? v.company_ids.targets : v.company_ids;
  if (!Array.isArray(authored) || !authored.length) fail('MIS_COMPANY_SCOPE', `${r.externalId}: multi-company scope must be explicit and nonempty`);
  const companies = (await guard.resolve(authored, 'res.company')) as unknown[];
  if (companies.some(c => typeof c !== 'number')) fail('MIS_COMPANY_PENDING', `${r.externalId}: group companies must exist and be authorized before planning`);
  const rows = await guard.search('res.company', [['id', 'in', companies]], ['currency_id']);
  if (rows.length !== new Set(companies).size || rows.some(row => !m2o(row.currency_id)))
    fail('METADATA_INACCESSIBLE', `${r.externalId}: company currencies unavailable`);
  if (new Set(rows.map(row => m2o(row.currency_id))).size > 1 && !v.currency_id)
    fail('MIS_CURRENCY_REQUIRED', `${r.externalId}: companies with different currencies require an explicit reporting currency`);
}

async function checkKpi(guard: MisGuard, r: InspectedResource): Promise<void> {
  const v = r.values,
    id = guard.bindings[r.externalId];
  if ('expression' in v) fail('MIS_DESTRUCTIVE_INVERSE', `${r.externalId}: manage expression_ids children instead of native expression inverse`);
  if (id && 'multi' in v) {
    const rows = await guard.search(r.model, [['id', '=', id]], ['multi'], 2);
    if (rows.length !== 1 || rows[0].multi !== v.multi) fail('MIS_MULTI_TRANSITION', `${r.externalId}: multi/scalar transitions need an explicit migration`);
  }
  if (!id || !(v.multi === true || v.multi === false) || !Array.isArray(v.expression_ids)) return;
  const rows = await guard.search('mis.report.kpi.expression', [['kpi_id', '=', id]], ['subkpi_id']);
  const expressions = v.expression_ids.filter(isResourceRef);
  if (v.multi) await checkSubKpiExpressions(guard, expressions, rows);
  else {
    const desired = expressions.map(e => guard.bindings[e.externalId]);
    if (rows.length > 1 || rows.some(row => !desired.includes(Number(row.id)) || row.subkpi_id))
      fail(
        'MIS_EXPRESSION_CONFLICT',
        `${r.externalId}: retained scalar expression conflicts; explicitly adopt the existing expression or remove owned conflicts`,
      );
  }
}
async function checkSubKpiExpressions(guard: MisGuard, expressions: { externalId: string }[], rows: Row[]): Promise<void> {
  for (const expression of expressions) {
    const child = guard.byId.get(expression.externalId);
    if (!child || !('subkpi_id' in child.values)) continue;
    const sub = await guard.resolve(child.values.subkpi_id, 'mis.report.subkpi');
    if (typeof sub === 'number' && rows.some(row => m2o(row.subkpi_id) === sub && Number(row.id) !== guard.bindings[expression.externalId]))
      fail('MIS_EXPRESSION_CONFLICT', `${expression.externalId}: explicitly adopt the retained sub-KPI expression`);
  }
}

async function checkSumTerms(guard: MisGuard, r: InspectedResource, terms: unknown[]): Promise<void> {
  const rows = await guard.search('mis.report.instance.period.sum', [['period_id', '=', guard.bindings[r.externalId]]], []);
  const desired = terms.filter(isResourceRef).map(e => guard.bindings[e.externalId]);
  if (rows.some(row => !desired.includes(Number(row.id))))
    fail('MIS_SUM_CONFLICT', `${r.externalId}: retained sum terms change the result; explicitly adopt/remove them`);
}

async function checkQuery(guard: MisGuard, r: InspectedResource): Promise<void> {
  const v = r.values;
  const modelId = await guard.resolve(v.model_id, 'ir.model');
  const models = await guard.search('ir.model', [['id', '=', modelId]], ['model'], 2);
  if (models.length !== 1) fail('METADATA_INACCESSIBLE', `${r.externalId}: query model is unavailable`);
  const metadata = (value: unknown): Promise<Row> => queryFieldMetadata(guard, r, value, modelId, models[0].model);
  if (!Array.isArray(v.field_ids)) fail('MIS_QUERY_FIELD', `${r.externalId}: field_ids must be a list`);
  for (const field of v.field_ids) {
    const meta = await metadata(field);
    if (v.aggregate && (!['integer', 'float', 'monetary'].includes(String(meta.ttype)) || meta.store !== true))
      fail('MIS_QUERY_AGGREGATE', `${r.externalId}: numeric aggregation requires stored numeric fields; JSON/nonstored fields need aggregate false`);
  }
  if ('date_field' in v && !['date', 'datetime'].includes(String((await metadata(v.date_field)).ttype)))
    fail('MIS_QUERY_DATE', `${r.externalId}: dateField requires a date/datetime field`);
  if (v.company_field_id && (await metadata(v.company_field_id)).relation !== 'res.company')
    fail('MIS_QUERY_COMPANY', `${r.externalId}: companyField must relate to res.company`);
  guard.diagnostics.push(
    `${r.externalId}: generic queries apply date/company filters; target_move and analytic filters are not inherited. Domain/expression dependencies remain explicit.`,
  );
}
async function queryFieldMetadata(guard: MisGuard, r: InspectedResource, value: unknown, modelId: unknown, model: unknown): Promise<Row> {
  if (isResourceRef(value) && !guard.bindings[value.externalId]) {
    const field = guard.byId.get(value.externalId);
    if (field?.model !== 'ir.model.fields' || (await guard.resolve(field.values.model_id, 'ir.model')) !== modelId)
      fail('MIS_QUERY_FIELD', `${r.externalId}: field belongs to another model`);
    return field.values;
  }
  const fieldId = await guard.resolve(value, 'ir.model.fields');
  const rows = await guard.search('ir.model.fields', [['id', '=', fieldId]], ['model', 'ttype', 'store', 'relation'], 2);
  if (rows.length !== 1 || rows[0].model !== model) fail('MIS_QUERY_FIELD', `${r.externalId}: query field must belong to ${model}`);
  return rows[0];
}
