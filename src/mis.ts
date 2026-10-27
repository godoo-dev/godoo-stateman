/** MIS Builder 18 authoring sugar. All output is an ordinary resource graph. */
import { children } from './dsl/children.js';
import { exact } from './dsl/scoped-values.js';
import { lookup } from './dsl/lookup.js';
import { ref, resource } from './dsl/resource.js';
import type { LookupRef, ResourceDefinition, ResourceOptions, ResourceRef } from './dsl/types.js';
import { fail, xmlid } from './state-utils.js';

type Target = number | LookupRef | ResourceRef | ResourceDefinition;
type Native = Record<string, unknown> & { _ref?: LookupRef };
type Literal = string | number | boolean | null | readonly Literal[];
export type Domain = readonly (readonly [string, string, Literal] | '&' | '|' | '!')[];
function py(value: Literal, aep = false): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('MIS_DOMAIN_INVALID', 'Domains need finite numbers'); return String(value); }
  if (typeof value === 'string') {
    if (aep && value.includes(']')) fail('MIS_AEP_INVALID', 'AEP bracket parser cannot represent ] inside a literal; use a native expression explicitly');
    return JSON.stringify(value);
  }
  if (!Array.isArray(value)) fail('MIS_DOMAIN_INVALID', 'Domains accept only literal values');
  return '(' + value.map(v => py(v, aep)).join(', ') + (value.length === 1 ? ',' : '') + ')';
}
function domainLiteral(value: Domain, aep = false): string {
  if (!Array.isArray(value) || value.some(v => !(typeof v === 'string' && ['&', '|', '!'].includes(v) || Array.isArray(v) && v.length === 3 && typeof v[0] === 'string' && typeof v[1] === 'string'))) fail('MIS_DOMAIN_INVALID', 'Expected domain terms or prefix logical operators');
  return '[' + value.map(v => py(v, aep)).join(', ') + ']';
}
/** Native query-domain locals are env/uid/context. This serializes literals only. */
export const queryDomain = (value: Domain): string => domainLiteral(value);
export interface AccountingExpression {
  field: 'balance' | 'debit' | 'credit' | 'positiveBalance' | 'negativeBalance';
  mode: 'variation' | 'initial' | 'ending' | 'unallocated';
  accounts: Domain | readonly string[];
  domain?: Domain;
}
/** AEP domains use tuple-compatible literals; ref/user/time locals require raw strings. */
export function aep(value: AccountingExpression): string {
  const field = { balance: 'bal', debit: 'deb', credit: 'crd', positiveBalance: 'pbal', negativeBalance: 'nbal' }[value.field];
  const mode = { variation: 'p', initial: 'i', ending: 'e', unallocated: 'u' }[value.mode];
  if (!field || !mode || !Array.isArray(value.accounts)) fail('MIS_AEP_INVALID', 'Unsupported AEP field/mode/accounts');
  const codes = value.accounts.length && value.accounts.every(v => typeof v === 'string' && !['&', '|', '!'].includes(v));
  if (codes && value.accounts.some(v => !/^[A-Za-z0-9_%.-]+$/.test(v as string))) fail('MIS_AEP_INVALID', 'Account codes cannot contain delimiters; use a literal account domain');
  return field + mode + (codes ? '[' + value.accounts.join(',') + ']' : domainLiteral(value.accounts as Domain, true)) + (value.domain ? domainLiteral(value.domain, true) : '');
}
interface Item<K extends string, V> { readonly kind: K; readonly key: string; readonly values: V; readonly options?: ResourceOptions }
const key = (s: string): string => { if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(s)) fail('MIS_KEY_INVALID', `Expected a stable local key, got ${s}`); return s; };
const item = <K extends string, V>(kind: K, id: string, values: V, options?: ResourceOptions): Item<K, V> => Object.freeze({ kind, key: key(id), values: Object.freeze({ ...values }), options });
export interface ExpressionValues { _ref?: LookupRef; value: string }
export const expression = (id: string, values: ExpressionValues, options?: ResourceOptions): Item<'expression', ExpressionValues> => item('expression', id, values, options);
type Expression = string | Item<'expression', ExpressionValues>;
export interface KpiValues {
  _ref?: LookupRef; name: string; label: string; sequence: number;
  type: 'num' | 'pct' | 'str'; accumulation: 'sum' | 'avg' | 'none'; compare: 'diff' | 'pct' | 'none';
  temporal: 'additive' | 'ratio' | 'snapshot' | 'period-dependent';
  expression?: Expression; expressions?: Record<string, Expression>;
  dependsOn?: readonly string[]; style?: Target; styleExpression?: string; expandAccounts?: boolean;
}
export function kpi(id: string, values: KpiValues, options?: ResourceOptions): Item<'kpi', KpiValues> {
  if (!['num', 'pct', 'str'].includes(values.type) || !['sum', 'avg', 'none'].includes(values.accumulation) || !['diff', 'pct', 'none'].includes(values.compare) || !['additive', 'ratio', 'snapshot', 'period-dependent'].includes(values.temporal)) fail('MIS_KPI_INVALID', `${id}: explicit type, accumulation, compare and temporal intent required`);
  if (values.accumulation === 'sum' && values.temporal !== 'additive') fail('MIS_TEMPORAL_SUM', `${id}: ${values.temporal} results must recompute over the wider period; choose accumulation none/avg`);
  if ((values.expression === undefined) === (values.expressions === undefined) || values.expressions && !Object.keys(values.expressions).length) fail('MIS_EXPRESSION_INVALID', `${id}: provide expression or nonempty expressions`);
  return item('kpi', id, values, options);
}
export interface QueryValues { _ref?: LookupRef; name: string; model: string; fields: readonly (string | Target)[]; dateField: string | Target; companyField: string | Target | null; aggregate: false | 'sum' | 'avg' | 'min' | 'max'; domain?: string }
export const query = (id: string, values: QueryValues, options?: ResourceOptions): Item<'query', QueryValues> => {
  if (!values.model || !values.fields.length || !values.dateField || values.companyField === undefined || ![false, 'sum', 'avg', 'min', 'max'].includes(values.aggregate)) fail('MIS_QUERY_INVALID', `${id}: model, fields, dateField, companyField and aggregate must be explicit`);
  return item('query', id, values, options);
};
export interface SubKpiValues { _ref?: LookupRef; name: string; label: string; sequence: number }
export const subKpi = (id: string, values: SubKpiValues, options?: ResourceOptions): Item<'subKpi', SubKpiValues> => item('subKpi', id, values, options);
export interface SubreportValues { _ref?: LookupRef; name: string; report: Target }
export const subreport = (id: string, values: SubreportValues, options?: ResourceOptions): Item<'subreport', SubreportValues> => item('subreport', id, values, options);
export const style = (id: string, values: Native & { name: string }, options?: ResourceOptions): ResourceDefinition => resource('mis.report.style', id, values, options);
export interface TemplateValues {
  _ref?: LookupRef; name: string; description?: string; style?: Target;
  queries?: readonly ReturnType<typeof query>[]; kpis?: readonly ReturnType<typeof kpi>[];
  subreports?: readonly ReturnType<typeof subreport>[]; subKpis?: readonly ReturnType<typeof subKpi>[];
}
function unique(items: readonly { key: string; values: { name?: string; label?: string } }[], description: string): void {
  if (new Set(items.map(i => i.key)).size !== items.length || new Set(items.map(i => i.values.name ?? i.values.label)).size !== items.length) fail('MIS_DUPLICATE', `Duplicate key/name in ${description}`);
}
const opts = (a?: ResourceOptions, deps: readonly string[] = []): ResourceOptions => ({ ...a, dependsOn: [...new Set([...(a?.dependsOn ?? []), ...deps])] });
export function template(id: string, values: TemplateValues, options?: ResourceOptions): ResourceDefinition {
  xmlid(id);
  const { queries = [], kpis = [], subreports = [], subKpis = [], style: styleId, ...native } = values;
  for (const [name, list] of Object.entries({ queries, kpis, subreports, subKpis })) unique(list, name);
  const subIds = new Map(subKpis.map(s => [s.key, `${id}.subkpi.${s.key}`]));
  const field = (model: string, value: string | Target): Target => typeof value === 'string' ? lookup('ir.model.fields', { model, name: value }) : value;
  const loweredKpis = kpis.map(k => {
    const { expression: single, expressions, label, accumulation, compare, temporal: _temporal, dependsOn = [], style: st, styleExpression, expandAccounts, ...base } = k.values;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(base.name)) fail('MIS_NAME_INVALID', `Invalid KPI variable ${base.name}`);
    if (!Number.isSafeInteger(base.sequence)) fail('MIS_SEQUENCE_INVALID', `${k.key}: sequence must be an integer`);
    const kpiId = `${id}.kpi.${k.key}`;
    const exprs = Object.entries(expressions ?? { value: single! }).map(([sub, e]) => {
      const exp = typeof e === 'string' ? expression(sub, { value: e }) : e;
      if (typeof exp.values.value !== 'string' || !exp.values.value.trim()) fail('MIS_EXPRESSION_INVALID', `${kpiId}: expression cannot be empty`);
      if (expressions && !subIds.has(sub)) fail('MIS_SUBKPI_MISSING', `${kpiId}: unknown sub-KPI ${sub}`);
      return resource('mis.report.kpi.expression', `${kpiId}.expression.${exp.key}`, { _ref: exp.values._ref, name: exp.values.value, subkpi_id: expressions ? ref(subIds.get(sub)!) : false }, exp.options);
    });
    return resource('mis.report.kpi', kpiId, { ...base, description: label, multi: !!expressions, accumulation_method: accumulation, compare_method: compare,
      ...(st !== undefined ? { style_id: st } : {}), ...(styleExpression !== undefined ? { style_expression: styleExpression } : {}),
      ...(expandAccounts !== undefined ? { auto_expand_accounts: expandAccounts } : {}),
      expression_ids: children('mis.report.kpi.expression', 'kpi_id', exprs) }, opts(k.options, dependsOn));
  });
  const loweredQueries = queries.map(q => {
    const { model, fields, dateField, companyField, aggregate, ...native } = q.values;
    return resource('mis.report.query', `${id}.query.${q.key}`, { ...native, aggregate, model_id: lookup('ir.model', { model }), field_ids: fields.map(v => field(model, v)), date_field: field(model, dateField), company_field_id: companyField === null ? false : field(model, companyField) }, q.options);
  });
  return resource('mis.report', id, { ...native, ...(styleId !== undefined ? { style_id: styleId } : {}),
    query_ids: children('mis.report.query', 'report_id', loweredQueries),
    kpi_ids: children('mis.report.kpi', 'report_id', loweredKpis),
    subkpi_ids: children('mis.report.subkpi', 'report_id', subKpis.map(s => { const { label, ...v } = s.values; return resource('mis.report.subkpi', subIds.get(s.key)!, { ...v, description: label }, s.options); })),
    subreport_ids: children('mis.report.subreport', 'report_id', subreports.map(s => { const { report, ...v } = s.values; return resource('mis.report.subreport', `${id}.subreport.${s.key}`, { ...v, subreport_id: report }, s.options); })),
  }, options);
}
export type PeriodDates = { mode: 'fixed'; from: string; to: string } | { mode: 'relative'; unit: 'day' | 'week' | 'month' | 'year'; offset: number; duration: number; ytd?: boolean } | { mode: 'relative'; unit: 'dateRange'; rangeType: Target; offset: number; duration: number; ytd?: boolean };
interface PeriodBase { _ref?: LookupRef; label: string; sequence: number }
export type PeriodValues = PeriodBase & ({ source: 'actuals'; dates: PeriodDates } | { source: 'compare'; from: string; to: string; normalizeFactor?: number } | { source: 'sum'; terms: readonly { key: string; period: string; sign: '+' | '-'; _ref?: LookupRef; options?: ResourceOptions }[] });
export const period = (id: string, values: PeriodValues, options?: ResourceOptions): Item<'period', PeriodValues> => item('period', id, values, options);
export interface InstanceValues { _ref?: LookupRef; name: string; template: Target; company?: Target; companies?: readonly Target[]; currency?: Target; targetMove: 'posted' | 'all'; pivotDate?: string; periods: readonly ReturnType<typeof period>[] }
const date = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export function instance(id: string, values: InstanceValues, options?: ResourceOptions): ResourceDefinition {
  xmlid(id);
  const { template: report, company, companies, currency, targetMove, pivotDate, periods, ...native } = values;
  if ((company === undefined) === (companies === undefined) || companies && !companies.length) fail('MIS_COMPANY_SCOPE', `${id}: choose company or nonempty companies`);
  if (!periods.length || !['posted', 'all'].includes(targetMove) || pivotDate !== undefined && !date(pivotDate)) fail('MIS_INSTANCE_INVALID', `${id}: periods, targetMove and valid pivotDate required`);
  unique(periods, 'periods');
  const byKey = new Map(periods.map(p => [p.key, p]));
  const actual = (operand: string, source: string): ResourceRef => {
    if (!byKey.has(operand) || byKey.get(operand)!.values.source !== 'actuals') fail('MIS_PERIOD_OPERAND', `${source}: operand ${operand} must be a sibling actual period`);
    return ref(`${id}.period.${operand}`);
  };
  const lowered = periods.map(p => {
    const v = p.values, periodId = `${id}.period.${p.key}`;
    if (!Number.isSafeInteger(v.sequence)) fail('MIS_SEQUENCE_INVALID', `${p.key}: sequence must be an integer`);
    const base = { _ref: v._ref, name: v.label, sequence: v.sequence };
    // Undefined _ref is removed by resource(), all persisted values are concrete.
    let extra: Record<string, unknown>;
    if (v.source === 'actuals') {
      const d = v.dates;
      if (d.mode === 'fixed') {
        if (!date(d.from) || !date(d.to) || d.from > d.to || 'ytd' in d) fail('MIS_PERIOD_DATES', `${p.key}: ordered fixed dates required; YTD uses relative mode`);
        extra = { source: 'actuals', mode: 'fix', manual_date_from: d.from, manual_date_to: d.to, is_ytd: false };
      } else {
        const unit = { day: 'd', week: 'w', month: 'm', year: 'y', dateRange: 'date_range' }[d.unit];
        if (d.mode !== 'relative' || !unit || !Number.isSafeInteger(d.offset) || !Number.isSafeInteger(d.duration) || d.duration < 1) fail('MIS_PERIOD_DATES', `${p.key}: valid unit, integer offset and positive duration required`);
        extra = { source: 'actuals', mode: 'relative', type: unit, offset: d.offset, duration: d.duration, is_ytd: d.ytd ?? false, manual_date_from: false, manual_date_to: false, ...(d.unit === 'dateRange' ? { date_range_type_id: d.rangeType } : {}) };
      }
    } else if (v.source === 'compare') {
      if (v.from === v.to || !Number.isSafeInteger(v.normalizeFactor ?? 1) || (v.normalizeFactor ?? 1) <= 0) fail('MIS_PERIOD_OPERAND', `${p.key}: different operands and positive integer normalizeFactor required`);
      extra = { source: 'cmpcol', mode: 'none', source_cmpcol_from_id: actual(v.from, p.key), source_cmpcol_to_id: actual(v.to, p.key), normalize_factor: v.normalizeFactor ?? 1 };
    } else if (v.source === 'sum') {
      if (!v.terms.length || new Set(v.terms.map(t => key(t.key))).size !== v.terms.length || new Set(v.terms.map(t => t.period)).size !== v.terms.length) fail('MIS_SUM_INVALID', `${p.key}: nonempty uniquely keyed operands required`);
      extra = { source: 'sumcol', mode: 'none', source_sumcol_ids: children('mis.report.instance.period.sum', 'period_id', v.terms.map(t => {
        if (!['+', '-'].includes(t.sign)) fail('MIS_SUM_INVALID', `${p.key}: sign must be + or -`);
        return resource('mis.report.instance.period.sum', `${periodId}.term.${t.key}`, { _ref: t._ref, period_to_sum_id: actual(t.period, p.key), sign: t.sign }, t.options);
      })) };
    } else fail('MIS_PERIOD_SOURCE', `${p.key}: unsupported source`);
    return resource('mis.report.instance.period', periodId, { ...base, ...extra }, p.options);
  });
  return resource('mis.report.instance', id, { ...native, report_id: report, target_move: targetMove,
    ...(pivotDate !== undefined ? { date: pivotDate } : {}), date_from: false, date_to: false,
    multi_company: companies !== undefined, company_id: companies ? false : company!,
    ...(companies ? { company_ids: exact([...companies]) } : {}), ...(currency ? { currency_id: currency } : {}),
    period_ids: children('mis.report.instance.period', 'report_instance_id', lowered),
  }, options);
}
