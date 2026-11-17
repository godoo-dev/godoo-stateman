// Characterization of the MIS and computed-field guards, the MIS instance
// builder and apply() fail-closed paths, pinned before splitting them for the
// complexity limit. A snapshot change means a behaviour change.
import { describe, expect, it } from 'vitest';
import { apply, plan, resource } from '@godoo-dev/stateman';
import type { FieldMetadata, InspectedResource, Row } from '@godoo-dev/stateman';
import { protectMis } from '../src/mis-guards.js';
import { protectComputedFields } from '../src/computed-fields.js';
import * as mis from '../src/mis.js';
import { FakeClient } from './fake-client.js';

async function outcome(run: () => Promise<unknown> | unknown): Promise<unknown> {
  try {
    const value = await run();
    return value === undefined ? 'accepted' : value;
  } catch (error) {
    const { code, message } = error as { code?: string; message: string };
    return { code, message };
  }
}
const res = (model: string, externalId: string, values: Row, parentScope?: InspectedResource['parentScope']): InspectedResource =>
  ({ externalId, model, values, ...(parentScope ? { parentScope } : {}) }) as InspectedResource;
type Rows = Record<string, Row[]>;
function stubs(rows: Rows, resolved: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const search = async (model: string, criteria: unknown[], names: string[], limit?: number): Promise<Row[]> => {
    calls.push(JSON.stringify({ model, criteria, names, limit }));
    return structuredClone(rows[model] ?? []);
  };
  const resolve = async (value: unknown, model?: string): Promise<unknown> => {
    calls.push(JSON.stringify({ resolve: value, model }));
    const key = JSON.stringify(value);
    return key in resolved ? resolved[key] : value;
  };
  return { calls, search, resolve };
}

describe('protectMis characterization', () => {
  const cases: Record<string, [InspectedResource[], Record<string, number>, Rows, Record<string, unknown>?]> = {
    'reparented existing child': [[res('mis.report.kpi', 'm.kpi', {}, { parentExternalId: 'm.report', inverseField: 'report_id' })], { 'm.kpi': 5, 'm.report': 1 }, { 'mis.report.kpi': [{ id: 5, report_id: [2, 'Other'] }] }],
    'child of unbound parent': [[res('mis.report.kpi', 'm.kpi', {}, { parentExternalId: 'm.report', inverseField: 'report_id' })], { 'm.kpi': 5 }, { 'mis.report.kpi': [{ id: 5, report_id: false }] }],
    'empty multi-company scope': [[res('mis.report.instance', 'm.i', { multi_company: true, company_ids: [] })], {}, {}],
    'pending group company': [[res('mis.report.instance', 'm.i', { multi_company: true, company_ids: [{ __type: 'resourceRef', externalId: 'm.c' }] })], {}, {}],
    'company currency unreadable': [[res('mis.report.instance', 'm.i', { multi_company: true, company_ids: [1, 2] })], {}, { 'res.company': [{ id: 1, currency_id: [1, 'EUR'] }] }],
    'mixed currencies without reporting currency': [[res('mis.report.instance', 'm.i', { multi_company: true, company_ids: { __type: 'exact', targets: [1, 2] } })], {}, { 'res.company': [{ id: 1, currency_id: [1, 'EUR'] }, { id: 2, currency_id: [2, 'USD'] }] }],
    'mixed currencies with reporting currency': [[res('mis.report.instance', 'm.i', { multi_company: true, company_ids: [1, 2], currency_id: 1 })], {}, { 'res.company': [{ id: 1, currency_id: [1, 'EUR'] }, { id: 2, currency_id: [2, 'USD'] }] }],
    'comparison mode': [[res('mis.report.instance', 'm.i', { comparison_mode: true })], {}, {}],
    'native kpi expression': [[res('mis.report.kpi', 'm.kpi', { expression: '1' })], {}, {}],
    'multi transition': [[res('mis.report.kpi', 'm.kpi', { multi: true })], { 'm.kpi': 5 }, { 'mis.report.kpi': [{ id: 5, multi: false }] }],
    'retained sub-kpi expression': [[
      res('mis.report.kpi', 'm.kpi', { multi: true, expression_ids: [{ __type: 'resourceRef', externalId: 'm.e' }, { __type: 'resourceRef', externalId: 'm.missing' }] }),
      res('mis.report.kpi.expression', 'm.e', { subkpi_id: 3 }),
    ], { 'm.kpi': 5, 'm.e': 8 }, { 'mis.report.kpi': [{ id: 5, multi: true }], 'mis.report.kpi.expression': [{ id: 9, subkpi_id: [3, 'S'] }] }],
    'adopted sub-kpi expression': [[
      res('mis.report.kpi', 'm.kpi', { multi: true, expression_ids: [{ __type: 'resourceRef', externalId: 'm.e' }] }),
      res('mis.report.kpi.expression', 'm.e', { subkpi_id: 3 }),
    ], { 'm.kpi': 5, 'm.e': 9 }, { 'mis.report.kpi': [{ id: 5, multi: true }], 'mis.report.kpi.expression': [{ id: 9, subkpi_id: 3 }] }],
    'retained scalar expression': [[res('mis.report.kpi', 'm.kpi', { multi: false, expression_ids: [] })], { 'm.kpi': 5 }, { 'mis.report.kpi': [{ id: 5, multi: false }], 'mis.report.kpi.expression': [{ id: 9, subkpi_id: false }] }],
    'retained sum term': [[res('mis.report.instance.period', 'm.p', { source_sumcol_ids: [] })], { 'm.p': 4 }, { 'mis.report.instance.period.sum': [{ id: 6 }] }],
    'query model unavailable': [[res('mis.report.query', 'm.q', { model_id: 3, field_ids: [] })], {}, {}],
    'query field list not a list': [[res('mis.report.query', 'm.q', { model_id: 3, field_ids: 'x' })], {}, { 'ir.model': [{ id: 3, model: 'account.move.line' }] }],
    'query field of another model': [[res('mis.report.query', 'm.q', { model_id: 3, field_ids: [10] })], {}, { 'ir.model': [{ id: 3, model: 'account.move.line' }], 'ir.model.fields': [{ id: 10, model: 'res.partner', ttype: 'float', store: true }] }],
    'pending query field of another model': [[
      res('mis.report.query', 'm.q', { model_id: 3, field_ids: [{ __type: 'resourceRef', externalId: 'm.f' }] }),
      res('ir.model.fields', 'm.f', { model_id: 4, ttype: 'json' }),
    ], {}, { 'ir.model': [{ id: 3, model: 'account.move.line' }] }],
    'aggregate over nonstored field': [[res('mis.report.query', 'm.q', { model_id: 3, field_ids: [10], aggregate: 'sum' })], {}, { 'ir.model': [{ id: 3, model: 'account.move.line' }], 'ir.model.fields': [{ id: 10, model: 'account.move.line', ttype: 'float', store: false }] }],
    'non-date date field': [[res('mis.report.query', 'm.q', { model_id: 3, field_ids: [], date_field: 10 })], {}, { 'ir.model': [{ id: 3, model: 'account.move.line' }], 'ir.model.fields': [{ id: 10, model: 'account.move.line', ttype: 'char' }] }],
    'company field not to res.company': [[res('mis.report.query', 'm.q', { model_id: 3, field_ids: [], company_field_id: 10 })], {}, { 'ir.model': [{ id: 3, model: 'account.move.line' }], 'ir.model.fields': [{ id: 10, model: 'account.move.line', ttype: 'many2one', relation: 'res.partner' }] }],
    'valid query': [[
      res('mis.report.query', 'm.q', { model_id: 3, field_ids: [10, { __type: 'resourceRef', externalId: 'm.f' }], aggregate: false, date_field: 10, company_field_id: 10 }),
      res('ir.model.fields', 'm.f', { model_id: 3, ttype: 'json' }),
    ], {}, { 'ir.model': [{ id: 3, model: 'account.move.line' }], 'ir.model.fields': [{ id: 10, model: 'account.move.line', ttype: 'date', store: true, relation: 'res.company' }] }],
  };
  for (const [name, [resources, bindings, rows, resolved]] of Object.entries(cases)) {
    it(name, async () => {
      const { calls, search, resolve } = stubs(rows, resolved);
      const diagnostics: string[] = [];
      const result = await outcome(() => protectMis(resources, bindings, search, resolve, diagnostics));
      expect({ result, diagnostics, calls }).toMatchSnapshot();
    });
  }
});

describe('protectComputedFields characterization', () => {
  const guard = { model: 'x', model_id: 3, name: 'x_total', state: 'manual', ttype: 'json', store: false, readonly: true, compute: 'for r in self: r.x_total = {}', relation: false, related: false, company_dependent: false, translate: false, modules: false, depends: '' };
  const meta: Record<string, Record<string, FieldMetadata>> = {
    'ir.model.fields': Object.fromEntries(Object.keys(guard).map(name => [name, { type: 'char' }])),
    x: { name: { type: 'char' }, parent_id: { type: 'many2one', relation: 'x' }, x_total: { type: 'json', store: false, readonly: true } },
  };
  const cases: Record<string, [Row, Record<string, number>, Rows, Record<string, Record<string, FieldMetadata>>?]> = {
    'guard metadata missing': [{ name: 'x_total' }, {}, {}, { 'ir.model.fields': {} }],
    'bound field unreadable': [{ name: 'x_total' }, { 'f.field': 9 }, {}],
    'bound field incomplete': [{ name: 'x_total' }, { 'f.field': 9 }, { 'ir.model.fields': [{ id: 9, state: 'manual' }] }],
    'base field': [{ name: 'x_total' }, { 'f.field': 9 }, { 'ir.model.fields': [{ ...guard, id: 9, state: 'base' }] }],
    'incompatible existing field': [{ name: 'x_total' }, { 'f.field': 9 }, { 'ir.model.fields': [{ ...guard, id: 9, store: true }] }],
    'type transition': [{ name: 'x_total', ttype: 'char' }, { 'f.field': 9 }, { 'ir.model.fields': [{ ...guard, id: 9 }] }],
    'unresolved model on create': [{ name: 'x_total', model_id: { __type: 'resourceRef', externalId: 'f.model' } }, {}, {}],
    'target model unavailable': [{ ...guard }, {}, {}],
    'conflicting model on create': [{ ...guard, model: 'y' }, {}, { 'ir.model': [{ id: 3, model: 'x' }] }],
    'name already taken': [{ ...guard }, {}, { 'ir.model': [{ id: 3, model: 'x' }], 'ir.model.fields': [{ id: 1 }] }],
    'unsupported shape': [{ ...guard, name: 'total' }, { 'f.field': 9 }, { 'ir.model.fields': [{ ...guard, id: 9, name: 'total' }] }],
    'stale target metadata': [{ name: 'x_total' }, { 'f.field': 9 }, { 'ir.model.fields': [{ ...guard, id: 9 }] }, { ...meta, x: { x_total: { type: 'char' } } }],
    'non-string depends': [{ name: 'x_total', depends: 1 }, { 'f.field': 9 }, { 'ir.model.fields': [{ ...guard, id: 9 }] }],
    'self dependency': [{ name: 'x_total', depends: 'x_total' }, { 'f.field': 9 }, { 'ir.model.fields': [{ ...guard, id: 9 }] }],
    'path through scalar': [{ name: 'x_total', depends: 'name.id' }, { 'f.field': 9 }, { 'ir.model.fields': [{ ...guard, id: 9 }] }],
    'valid relational dependency': [{ name: 'x_total', depends: 'parent_id.name, name' }, { 'f.field': 9 }, { 'ir.model.fields': [{ ...guard, id: 9 }] }],
  };
  for (const [name, [values, bindings, rows, schema]] of Object.entries(cases)) {
    it(name, async () => {
      const { calls, search, resolve } = stubs(rows);
      const fields = async (model: string): Promise<Record<string, FieldMetadata>> => (schema ?? meta)[model] ?? {};
      const result = await outcome(() => protectComputedFields([res('ir.model.fields', 'f.field', values)], bindings, search, fields, resolve));
      expect({ result, calls }).toMatchSnapshot();
    });
  }
});

describe('mis.instance characterization', () => {
  const base = { name: 'I', template: 1, company: 1, targetMove: 'posted' as const };
  const jan = mis.period('jan', { label: 'Jan', sequence: 10, source: 'actuals', dates: { mode: 'fixed', from: '2026-01-01', to: '2026-01-31' } });
  const feb = mis.period('feb', { label: 'Feb', sequence: 20, source: 'actuals', dates: { mode: 'relative', unit: 'dateRange', offset: 0, duration: 1, dateRangeType: 1 } as never });
  const cases: Record<string, () => unknown> = {
    'both company and companies': () => mis.instance('m.i', { ...base, companies: [1], periods: [jan] }),
    'no periods': () => mis.instance('m.i', { ...base, periods: [] }),
    'invalid pivot date': () => mis.instance('m.i', { ...base, pivotDate: '2026-02-30', periods: [jan] }),
    'non-integer sequence': () => mis.instance('m.i', { ...base, periods: [mis.period('x', { label: 'X', sequence: 1.5, source: 'actuals', dates: { mode: 'fixed', from: '2026-01-01', to: '2026-01-02' } })] }),
    'unordered fixed dates': () => mis.instance('m.i', { ...base, periods: [mis.period('x', { label: 'X', sequence: 1, source: 'actuals', dates: { mode: 'fixed', from: '2026-02-01', to: '2026-01-01' } })] }),
    'invalid relative unit': () => mis.instance('m.i', { ...base, periods: [mis.period('x', { label: 'X', sequence: 1, source: 'actuals', dates: { mode: 'relative', unit: 'decade', offset: 0, duration: 1 } as never })] }),
    'compare same operand': () => mis.instance('m.i', { ...base, periods: [jan, mis.period('c', { label: 'C', sequence: 30, source: 'compare', from: 'jan', to: 'jan' })] }),
    'compare non-actual operand': () => mis.instance('m.i', { ...base, periods: [jan, mis.period('c', { label: 'C', sequence: 30, source: 'compare', from: 'jan', to: 'c' })] }),
    'empty sum': () => mis.instance('m.i', { ...base, periods: [jan, mis.period('s', { label: 'S', sequence: 30, source: 'sum', terms: [] })] }),
    'invalid sum sign': () => mis.instance('m.i', { ...base, periods: [jan, mis.period('s', { label: 'S', sequence: 30, source: 'sum', terms: [{ key: 'a', period: 'jan', sign: '*' as never }] })] }),
    'unsupported source': () => mis.instance('m.i', { ...base, periods: [mis.period('u', { label: 'U', sequence: 1, source: 'budget' } as never)] }),
    'complete instance': () => mis.instance('m.i', { ...base, company: undefined, companies: [1, 2], currency: 1, pivotDate: '2026-02-15', periods: [jan, feb,
      mis.period('c', { label: 'C', sequence: 30, source: 'compare', from: 'jan', to: 'feb', normalizeFactor: 2 }),
      mis.period('s', { label: 'S', sequence: 40, source: 'sum', terms: [{ key: 'a', period: 'jan', sign: '+' }, { key: 'b', period: 'feb', sign: '-' }] })] }),
  };
  for (const [name, run] of Object.entries(cases)) it(name, async () => { expect(await outcome(run)).toMatchSnapshot(); });
});

describe('apply() characterization', () => {
  it('stops when the connection identity changes', async () => {
    const client = new FakeClient();
    const reviewed = await plan([resource('x', 'a.one', { name: 'One' })], client.connection());
    const moved = { ...client.connection(), identity: async () => ({ url: 'http://other.test/', database: 'fixture', uid: 7 }) };
    expect(await outcome(async () => (await apply(reviewed, moved)).results.map(r => ({ status: r.status, message: r.message, code: (r.error as { code?: string })?.code })))).toMatchSnapshot();
  });
  it('refuses a concurrent XML-ID binding to another record', async () => {
    const client = new FakeClient();
    const reviewed = await plan([resource('x', 'a.one', { name: 'One' })], client.connection());
    const create = client.create.bind(client);
    client.create = async (model, values) => {
      const id = await create(model, values);
      if (model === 'x') client.seed('ir.model.data', { module: 'a', name: 'one', model: 'x', res_id: id + 50, noupdate: true });
      return id;
    };
    const result = await apply(reviewed, client.connection(), { journal: { save: async () => undefined } });
    expect(result.results.map(r => ({ status: r.status, code: (r.error as { code?: string })?.code, message: (r.error as Error)?.message }))).toMatchSnapshot();
  });
  it('accepts an XML-ID binding that already points to the created record', async () => {
    const client = new FakeClient();
    const reviewed = await plan([resource('x', 'a.one', { name: 'One' })], client.connection());
    const create = client.create.bind(client);
    client.create = async (model, values) => {
      const id = await create(model, values);
      if (model === 'x') client.seed('ir.model.data', { module: 'a', name: 'one', model: 'x', res_id: id, noupdate: true });
      return id;
    };
    const result = await apply(reviewed, client.connection(), { journal: { save: async () => undefined } });
    expect({ ok: result.ok, statuses: result.results.map(r => r.status), mutations: client.mutations.map(m => `${m.method}:${m.model}`) }).toMatchSnapshot();
  });
});
