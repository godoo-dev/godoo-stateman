import { expect, it } from 'vitest';
import { inspectResources, lookup, plan, resource } from '../src/index.js';
import * as mis from '../src/mis.js';
import { fieldFixture } from './fields-client.js';

it('protects raw MIS destructive inverses before any mutation', async () => {
  const f = fieldFixture();
  f.schema['mis.report.kpi'] = { expression: { type: 'char' }, multi: { type: 'boolean' } };
  f.schema['mis.report.instance'] = { comparison_mode: { type: 'boolean' } };
  for (const r of [resource('mis.report.kpi', 'demo.kpi', { expression: '1' }), resource('mis.report.instance', 'demo.instance', { comparison_mode: false })]) {
    await expect(plan([r], f.connection())).rejects.toMatchObject({ code: 'MIS_DESTRUCTIVE_INVERSE' });
  }
  expect(f.mutations).toEqual([]);
});
it('requires explicit adoption of a retained scalar expression', async () => {
  const f = fieldFixture();
  f.schema['mis.report'] = { name: { type: 'char' }, query_ids: { type: 'one2many', relation: 'mis.report.query' }, kpi_ids: { type: 'one2many', relation: 'mis.report.kpi' }, subkpi_ids: { type: 'one2many', relation: 'mis.report.subkpi' }, subreport_ids: { type: 'one2many', relation: 'mis.report.subreport' } };
  f.schema['mis.report.kpi'] = { name: { type: 'char' }, description: { type: 'char' }, sequence: { type: 'integer' }, multi: { type: 'boolean' }, report_id: { type: 'many2one', relation: 'mis.report' }, type: { type: 'selection' }, accumulation_method: { type: 'selection' }, compare_method: { type: 'selection' }, expression_ids: { type: 'one2many', relation: 'mis.report.kpi.expression' } };
  f.schema['mis.report.kpi.expression'] = { name: { type: 'char' }, kpi_id: { type: 'many2one', relation: 'mis.report.kpi' }, subkpi_id: { type: 'many2one', relation: 'mis.report.subkpi' } };
  const report = f.seed('mis.report', { name: 'R' }, 'demo.report');
  const kpi = f.seed('mis.report.kpi', { name: 'v', description: 'V', report_id: report, multi: false, type: 'num', accumulation_method: 'sum', compare_method: 'diff', sequence: 10 }, 'demo.report.kpi.v');
  const expr = f.seed('mis.report.kpi.expression', { kpi_id: kpi, subkpi_id: false, name: '1' });
  f.data['mis.report.kpi'][0].expression_ids = [expr]; f.data['mis.report'][0].kpi_ids = [kpi];
  const make = (adopt: boolean) => mis.template('demo.report', { name: 'R', kpis: [mis.kpi('v', { name: 'v', label: 'V', sequence: 10, type: 'num', accumulation: 'sum', compare: 'diff', temporal: 'additive', expression: adopt ? mis.expression('value', { _ref: lookup('mis.report.kpi.expression', { subkpi_id: false }), value: '1' }) : '1' })] });
  await expect(plan([make(false)], f.connection())).rejects.toMatchObject({ code: 'MIS_EXPRESSION_CONFLICT' });
  const result = await plan([make(true)], f.connection());
  expect(result.operations.map(o => o.type)).toEqual(['adopt']);
  expect((await inspectResources([make(true)])).resources.find(r => r.externalId.endsWith('.expression.value'))?.parentScope?.parentExternalId).toBe('demo.report.kpi.v');
});

it('audits exact company membership under core company rules and rejects arbitrary restrictions', async () => {
  const { scopedStore } = await import('./scoped-client.js');
  const { exact } = await import('../src/index.js');
  const { store, companies, context } = scopedStore();
  store.schema.x.items.relation = 'res.company';
  const unowned = store.seed('res.company', { name: 'Visible but unauthorized' });
  const root = store.seed('x', { items: [...companies, unowned] }, 'demo.companies');
  store.seed('ir.rule', { name: 'Core company rule', 'model_id.model': 'res.company', active: true, perm_read: true, domain_force: "[('id', 'in', company_ids)]" });
  const desired = [resource('x', 'demo.companies', { items: exact([companies[0]]) })];
  const p = await plan(desired, store.connection(), { context });
  expect(p.operations).toHaveLength(1);
  expect(p.operations[0]).toMatchObject({ id: root, type: 'unlink', values: { items: [[3, companies[1], 0], [3, companies[2], 0]] } });
  await expect(plan([resource('x', 'demo.companies', { items: exact([unowned]) })], store.connection(), { context })).rejects.toMatchObject({ code: 'EXACT_VISIBILITY' });
  store.data['ir.rule'][0].domain_force = "[('id', '=', 1)]";
  await expect(plan(desired, store.connection(), { context })).rejects.toMatchObject({ code: 'EXACT_VISIBILITY' });
});

it('requires reporting currency only for a group with differing company currencies', async () => {
  const { protectMis } = await import('../src/mis-guards.js');
  const { exact } = await import('../src/index.js');
  const resource = { externalId: 'demo.group', model: 'mis.report.instance', values: { multi_company: true, company_ids: exact([1, 2]) } };
  const resolve = async (value: unknown) => value;
  const currencies = (b: number) => async () => [{ id: 1, currency_id: [1, 'A'] }, { id: 2, currency_id: [b, 'B'] }];
  await expect(protectMis([resource], {}, currencies(1), resolve, [])).resolves.toBeUndefined();
  await expect(protectMis([resource], {}, currencies(2), resolve, [])).rejects.toMatchObject({ code: 'MIS_CURRENCY_REQUIRED' });
  await expect(protectMis([{ ...resource, values: { ...resource.values, currency_id: 1 } }], {}, currencies(2), resolve, [])).resolves.toBeUndefined();
});
