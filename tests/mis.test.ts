import { describe, expect, it } from 'vitest';
import { computedField, createFixture, inspectResources, lookup, parseFixture, ref, serializeFixture } from '../src/index.js';
import * as mis from '../src/mis.js';
const periods = () => [
  mis.period('jan', { label: 'Jan', sequence: 10, source: 'actuals', dates: { mode: 'fixed', from: '2026-01-01', to: '2026-01-31' } }),
  mis.period('feb', { label: 'Feb', sequence: 20, source: 'actuals', dates: { mode: 'relative', unit: 'month', offset: 0, duration: 1, ytd: true } }),
  mis.period('cmp', { label: 'Change', sequence: 30, source: 'compare', from: 'jan', to: 'feb' }),
  mis.period('sum', { label: 'Sum', sequence: 40, source: 'sum', terms: [{ key: 'jan', period: 'jan', sign: '+' }, { key: 'feb', period: 'feb', sign: '+' }] }),
];
describe('MIS resource lowering', () => {
  it('keeps stable category identities, parent-scoped adoption, expression children and opaque dependencies', async () => {
    const report = mis.template('demo.report', {
      name: 'Demo',
      queries: [mis.query('lines', { name: 'lines', model: 'account.move.line', fields: ['debit'], dateField: 'date', companyField: 'company_id', aggregate: false })],
      kpis: [mis.kpi('net', { _ref: lookup('mis.report.kpi', { name: 'net' }), name: 'net', label: 'Net', sequence: 10, expression: mis.expression('value', { _ref: lookup('mis.report.kpi.expression', { subkpi_id: false }), value: 'sum(l.debit for l in lines)' }), type: 'num', accumulation: 'sum', compare: 'diff', temporal: 'additive', dependsOn: ['demo.report.query.lines'] })],
    });
    const graph = await inspectResources([report]);
    const kpi = graph.resources.find(r => r.externalId === 'demo.report.kpi.net')!;
    expect(kpi.values).not.toHaveProperty('expression');
    expect(kpi.options?.dependsOn).toEqual(['demo.report.query.lines']);
    const expression = graph.resources.find(r => r.externalId.endsWith('.expression.value'))!;
    expect(expression.parentScope).toEqual({ parentExternalId: kpi.externalId, inverseField: 'kpi_id' });
    expect(expression.ref).toEqual(lookup('mis.report.kpi.expression', { subkpi_id: false }));
    expect(createFixture(parseFixture(serializeFixture(createFixture(graph, { namespaces: ['demo'] }))), { namespaces: ['demo'] }).resources).toEqual(graph.resources);
  });
  it('models distinct subreports/subKPIs and symbolic field references', async () => {
    const field = computedField('account.move.line', 'demo.field', { name: 'x_net', label: 'Net', type: 'json', store: false, readonly: true, compute: 'pass', depends: [] });
    const other = mis.template('demo.other', { name: 'Other' });
    const report = mis.template('demo.report', { name: 'Report',
      subreports: [mis.subreport('other', { name: 'other', report: other })],
      subKpis: [mis.subKpi('debit', { name: 'debit', label: 'Debit', sequence: 10 })],
      queries: [mis.query('lines', { name: 'lines', model: 'account.move.line', fields: [field], dateField: 'date', companyField: null, aggregate: false })],
      kpis: [mis.kpi('movement', { name: 'movement', label: 'Movement', sequence: 10, expressions: { debit: mis.aep({ field: 'debit', mode: 'variation', accounts: [] }) }, type: 'num', accumulation: 'sum', compare: 'pct', temporal: 'additive' })],
    });
    const graph = await inspectResources([report]);
    expect(graph.resources.find(r => r.externalId === 'demo.report.query.lines')?.values.field_ids).toEqual([ref('demo.field')]);
    expect(graph.resources.find(r => r.externalId.endsWith('.expression.debit'))?.values.subkpi_id).toEqual(ref('demo.report.subkpi.debit'));
    expect(graph.resources.find(r => r.externalId.endsWith('.subreport.other'))?.values.subreport_id).toEqual(ref('demo.other'));
  });
  it('represents multiple companies with exact membership and preserves period identities across reorder', async () => {
    const make = (p = periods()) => mis.instance('demo.group', { name: 'Group', template: lookup('mis.report', { name: 'R' }), companies: [1, 2], currency: 1, targetMove: 'posted', periods: p });
    const g = await inspectResources([make()]);
    const instance = g.resources.find(r => r.externalId === 'demo.group')!;
    expect(instance.values).toMatchObject({ multi_company: true, company_id: false, date_from: false, date_to: false, company_ids: { __type: 'exact', targets: [1, 2] } });
    expect(instance.values).not.toHaveProperty('comparison_mode');
    expect(g.resources.find(r => r.externalId === 'demo.group.period.cmp')?.values).toMatchObject({ source: 'cmpcol', mode: 'none', source_cmpcol_from_id: ref('demo.group.period.jan') });
    expect((await inspectResources([make(periods().reverse())])).resources.map(r => r.externalId)).toEqual(g.resources.map(r => r.externalId));
  });
  it('rejects ambiguous scope, invalid operands/dates and summed period-dependent KPIs', () => {
    const base = { name: 'X', template: 1, targetMove: 'posted' as const, periods: periods() };
    expect(() => mis.instance('demo.x', { ...base, company: 1, companies: [2], currency: 1 })).toThrow(/choose company/);
    expect(() => mis.instance('demo.x', { ...base, companies: [1, 2] })).not.toThrow();
    expect(() => mis.instance('demo.x', { ...base, company: 1, periods: [...periods(), mis.period('bad', { label: 'Bad', sequence: 50, source: 'sum', terms: [{ key: 'sum', period: 'sum', sign: '+' }] })] })).toThrow(/actual period/);
    expect(() => mis.instance('demo.x', { ...base, company: 1, periods: [mis.period('bad', { label: 'Bad', sequence: 10, source: 'actuals', dates: { mode: 'fixed', from: '2026-02-30', to: '2026-03-01' } })] })).toThrow(/fixed dates/);
    expect(() => mis.kpi('ratio', { name: 'ratio', label: 'Ratio', sequence: 1, type: 'pct', accumulation: 'sum', compare: 'diff', temporal: 'ratio', expression: 'a/b' })).toThrow(/recompute/);
  });
  it('serializes nested AEP domains as tuples and query booleans as Python', () => {
    expect(mis.aep({ field: 'balance', mode: 'variation', accounts: [['account_type', 'in', ['income', 'expense']]], domain: [['company_id', '=', 1]] })).toBe('balp[("account_type", "in", ("income", "expense"))][("company_id", "=", 1)]');
    expect(mis.queryDomain([['active', '=', false]])).toBe('[("active", "=", False)]');
    expect(() => mis.aep({ field: 'debit', mode: 'ending', accounts: [['name', '=', 'a]b']] })).toThrow(/bracket/);
  });
});
