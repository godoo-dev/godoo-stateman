import assert from 'node:assert/strict';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { apply, computedField, drift, inspectResources, lookup, openRecoveryJournal, plan, resource } from '@godoo-dev/stateman';
import * as mis from '@godoo-dev/stateman/mis';

/** Entire database is owned by the disposable verifier; no application inputs. */
export async function misOdoo({ client, connection, root, url, database, versionOptions }) {
  await client.call('ir.module.module', 'update_list', []);
  const [module] = await client.searchRead('ir.module.module', [['name', '=', 'mis_builder']], { fields: ['state'] });
  assert.ok(module, 'Pinned MIS Builder must be available in fixture addons');
  if (module.state !== 'installed') await client.call('ir.module.module', 'button_immediate_install', [[module.id]]);
  const [qualified] = await client.searchRead('ir.module.module', [['id', '=', module.id]], { fields: ['installed_version', 'state'] });
  assert.equal(qualified.state, 'installed'); assert.equal(qualified.installed_version, '18.0.1.10.0');
  const uid = (await connection.identity()).uid;
  const [user] = await client.searchRead('res.users', [['id', '=', uid]], { fields: ['company_ids'] });
  const [country] = await client.searchRead('res.country', [['code', '=', 'US']], { fields: [] });
  const [usd] = await client.searchRead('res.currency', [['name', '=', 'USD']], { fields: [] });
  const a = await client.create('res.company', { name: 'MIS Synthetic A', country_id: country.id, currency_id: usd.id });
  const b = await client.create('res.company', { name: 'MIS Synthetic B', country_id: country.id, currency_id: usd.id });
  const companyIds = [...user.company_ids, a, b];
  await client.write('res.users', [uid], { company_ids: companyIds.map(id => [4, id, 0]) });
  const context = { allowed_company_ids: companyIds, lang: 'en_US' };
  const scope = { ...versionOptions, context };
  const accountIds = [];
  const lines = [];
  async function ledger(company, entries) {
    const local = { ...context, allowed_company_ids: [company, ...companyIds.filter(c => c !== company)] };
    const account = await client.create('account.account', { name: 'MIS synthetic expense', code: company === a ? 'MS1001' : 'MS2001', account_type: 'expense', company_ids: [[6, 0, [company]]] }, local);
    const counterpart = await client.create('account.account', { name: 'MIS synthetic offset', code: company === a ? 'MS1002' : 'MS2002', account_type: 'income', company_ids: [[6, 0, [company]]] }, local);
    accountIds.push(account);
    const journal = await client.create('account.journal', { name: 'MIS synthetic', code: company === a ? 'MSA' : 'MSB', type: 'general', company_id: company }, local);
    for (const [date, gross, cost, posted] of entries) {
      const move = await client.create('account.move', { journal_id: journal, company_id: company, date, line_ids: [
        [0, 0, { name: 'MIS data', account_id: account, debit: gross, credit: 0, quantity: cost }],
        [0, 0, { name: 'MIS offset', account_id: counterpart, debit: 0, credit: gross }],
      ] }, local);
      if (posted) await client.call('account.move', 'action_post', [[move]], { context: local });
      const found = await client.searchRead('account.move.line', [['move_id', '=', move], ['account_id', '=', account]], { fields: [], context: local });
      assert.equal(found.length, 1); lines.push(found[0].id);
    }
  }
  await ledger(a, [['2026-01-15', 100, 10, true], ['2026-02-15', 300, 90, true], ['2026-01-16', 900, 900, false]]);
  await ledger(b, [['2026-01-15', 400, 200, true]]);
  const [amlModel] = await client.searchRead('ir.model', [['model', '=', 'account.move.line']], { fields: [], context });
  const unrelated = await client.create('ir.model.fields', { model_id: amlModel.id, name: 'x_stateman_unrelated', field_description: 'Unrelated preserved', ttype: 'json', store: false, readonly: true, compute: "for record in self:\n    record['x_stateman_unrelated'] = {}\n", depends: 'debit' }, context);
  const unrelatedBefore = await client.searchRead('ir.model.fields', [['id', '=', unrelated]], { fields: ['name', 'compute', 'depends', 'store', 'readonly'], context });
  const compute = "for record in self:\n    record['x_stateman_allocation'] = {'gross': record.debit, 'cost': record.quantity}\n";
  const field = (source = compute, extra = {}) => computedField('account.move.line', 'stateman_mis.allocation', { name: 'x_stateman_allocation', label: 'Synthetic allocation', type: 'json', store: false, readonly: true, compute: source, depends: ['debit', 'quantity'], ...extra });
  const hidden = mis.style('stateman_mis.hidden', { name: 'Stateman MIS hidden', hide_always: true, hide_always_inherit: false });
  const bold = mis.style('stateman_mis.bold', { name: 'Stateman MIS bold', font_weight: 'bold', font_weight_inherit: false });
  const constant = mis.template('stateman_mis.constant', { name: 'Synthetic benchmark', kpis: [mis.kpi('target', { name: 'target', label: 'Target', sequence: 10, expression: '100', type: 'num', accumulation: 'none', compare: 'diff', temporal: 'period-dependent' })] });
  const makeReport = (label = 'Gross') => mis.template('stateman_mis.report', { name: 'Synthetic MIS', subreports: [mis.subreport('benchmark', { name: 'benchmark', report: constant })], queries: [
    mis.query('lines', { name: 'lines', model: 'account.move.line', fields: ['debit', field()], dateField: 'date', companyField: 'company_id', aggregate: false, domain: mis.queryDomain([['id', 'in', lines], ['parent_state', '=', 'posted']]) }),
    mis.query('unfiltered', { name: 'unfiltered', model: 'account.move.line', fields: ['debit'], dateField: 'date', companyField: 'company_id', aggregate: false, domain: mis.queryDomain([['id', 'in', lines]]) }),
  ], kpis: [
    mis.kpi('gross', { name: 'gross', label, sequence: 10, expression: 'sum(l.debit for l in lines)', type: 'num', accumulation: 'sum', compare: 'diff', temporal: 'additive', dependsOn: ['stateman_mis.report.query.lines'], style: bold }),
    mis.kpi('cost', { name: 'cost', label: 'Cost', sequence: 20, expression: "sum(l.x_stateman_allocation['cost'] for l in lines)", type: 'num', accumulation: 'sum', compare: 'diff', temporal: 'additive', dependsOn: ['stateman_mis.report.query.lines'] }),
    mis.kpi('ratio', { name: 'ratio', label: 'Ratio', sequence: 30, expression: 'cost / gross if gross else AccountingNone', type: 'pct', accumulation: 'none', compare: 'diff', temporal: 'ratio', dependsOn: ['stateman_mis.report.kpi.cost', 'stateman_mis.report.kpi.gross'] }),
    mis.kpi('ledger', { name: 'ledger', label: 'Ledger', sequence: 40, expression: mis.aep({ field: 'balance', mode: 'variation', accounts: [['id', 'in', accountIds]] }), type: 'num', accumulation: 'sum', compare: 'diff', temporal: 'additive', expandAccounts: true }),
    mis.kpi('unfiltered', { name: 'unfiltered_value', label: 'Unfiltered query', sequence: 50, expression: 'sum(l.debit for l in unfiltered)', type: 'num', accumulation: 'sum', compare: 'diff', temporal: 'additive', dependsOn: ['stateman_mis.report.query.unfiltered'] }),
    mis.kpi('hidden', { name: 'hidden', label: 'Hidden helper', sequence: 60, expression: 'gross', type: 'num', accumulation: 'sum', compare: 'diff', temporal: 'additive', style: hidden, dependsOn: ['stateman_mis.report.kpi.gross'] }),
    mis.kpi('benchmark', { name: 'target', label: 'Benchmark', sequence: 70, expression: 'benchmark.target', type: 'num', accumulation: 'none', compare: 'diff', temporal: 'period-dependent', dependsOn: ['stateman_mis.report.subreport.benchmark', 'stateman_mis.constant.kpi.target'] }),
  ] });
  const periods = () => [
    mis.period('jan', { label: 'January', sequence: 10, source: 'actuals', dates: { mode: 'fixed', from: '2026-01-01', to: '2026-01-31' } }),
    mis.period('feb', { label: 'February', sequence: 20, source: 'actuals', dates: { mode: 'fixed', from: '2026-02-01', to: '2026-02-28' } }),
    mis.period('ytd', { label: 'YTD', sequence: 30, source: 'actuals', dates: { mode: 'relative', unit: 'month', offset: 0, duration: 1, ytd: true } }),
    mis.period('change', { label: 'Change', sequence: 40, source: 'compare', from: 'jan', to: 'feb' }),
    mis.period('sum', { label: 'Sum', sequence: 50, source: 'sum', terms: [{ key: 'jan', period: 'jan', sign: '+' }, { key: 'feb', period: 'feb', sign: '+' }] }),
  ];
  const make = (label = 'Gross') => {
    const template = makeReport(label);
    return [mis.instance('stateman_mis.single', { name: 'Synthetic single', template, company: a, targetMove: 'posted', pivotDate: '2026-02-15', periods: periods() }),
      mis.instance('stateman_mis.group', { name: 'Synthetic group', template, companies: [a, b], currency: usd.id, targetMove: 'posted', pivotDate: '2026-02-15', periods: periods() })];
  };
  const journal = await openRecoveryJournal(join(root, 'mis-recovery.json'));
  try {
    const first = await plan(make(), connection, { ...scope, recovery: journal.receipts });
    assert.ok(first.operations.some(o => o.model === 'ir.model.fields' && o.type === 'create'));
    assert.ok(first.diagnostics.some(d => d.includes('not inherited')));
    const applied = await apply(first, connection, { journal });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    const fresh = await plan(make(), connection, { ...scope, recovery: journal.receipts });
    assert.equal(fresh.operations.length, 0);
    const ids = fresh.bindings;
    const runtime = await client.searchRead('account.move.line', [['id', '=', lines[0]]], { fields: ['x_stateman_allocation'], context });
    assert.deepEqual(runtime[0].x_stateman_allocation, { gross: 100, cost: 10 });
    const matrix = async id => client.call('mis.report.instance', 'compute', [[id]], { context });
    const single = await matrix(ids['stateman_mis.single']), group = await matrix(ids['stateman_mis.group']);
    const cells = (m, label) => { const row = m.body.find(r => r.label === label); assert.ok(row, `${label}: ${JSON.stringify(m)}`); return row.cells.map(c => c.val ?? null); };
    assert.deepEqual(cells(single, 'Gross'), [100, 300, 400, 200, 400]);
    assert.deepEqual(cells(single, 'Cost'), [10, 90, 100, 80, 100]);
    const ratio = cells(single, 'Ratio'); assert.equal(ratio[0], 0.1); assert.equal(ratio[1], 0.3); assert.equal(ratio[2], 0.25); assert.equal(ratio[4], null);
    assert.deepEqual(cells(single, 'Unfiltered query'), [1000, 300, 1300, -700, 1300]);
    assert.deepEqual(cells(single, 'Ledger'), [100, 300, 400, 200, 400]);
    assert.ok(!single.body.some(r => r.label === 'Hidden helper'));
    assert.deepEqual(cells(group, 'Gross').slice(0, 3), [500, 300, 800]);
    assert.deepEqual(cells(group, 'Cost').slice(0, 3), [210, 90, 300]);
    assert.equal(cells(group, 'Ratio')[2], 300 / 800);
    const dates = await client.searchRead('mis.report.instance.period', [['id', '=', ids['stateman_mis.single.period.ytd']]], { fields: ['date_from', 'date_to'], context });
    assert.equal(dates[0].date_from, '2026-01-01'); assert.equal(dates[0].date_to, '2026-02-28');
    const newSource = compute.replace("'cost': record.quantity", "'cost': record.quantity + 1");
    const sourceUpdate = await plan([field(newSource)], connection, { ...scope, recovery: journal.receipts });
    assert.equal(sourceUpdate.operations.length, 1); assert.equal(sourceUpdate.operations[0].before.compute, compute);
    assert.equal((await apply(sourceUpdate, connection, { journal })).ok, true);
    const changedRuntime = await client.searchRead('account.move.line', [['id', '=', lines[0]]], { fields: ['x_stateman_allocation'], context });
    assert.equal(changedRuntime[0].x_stateman_allocation.cost, 11);
    assert.equal((await apply(await plan([field()], connection, scope), connection, { journal })).ok, true);
    await assert.rejects(plan([computedField('account.move.line', 'stateman_mis.collision', { name: 'x_stateman_allocation', label: 'Conflict', type: 'json', store: false, readonly: true, compute, depends: ['debit'] })], connection, scope), { code: 'FIELD_NAME_TAKEN' });
    await assert.rejects(plan([], connection, { ...scope, removals: [{ externalId: 'stateman_mis.allocation', model: 'ir.model.fields', id: ids['stateman_mis.allocation'], action: 'delete' }] }), { code: 'FIELD_REMOVAL_UNSUPPORTED' });
    const selected = await plan(make(), connection, { ...scope, select: ['stateman_mis.report.query.lines'], recovery: journal.receipts });
    assert.ok(selected.resources.some(r => r.externalId === 'stateman_mis.allocation'));
    assert.equal(selected.operations.length, 0);
    const updated = await plan(make('Gross updated'), connection, { ...scope, recovery: journal.receipts });
    assert.equal(updated.operations.length, 1); assert.equal(updated.operations[0].values.description, 'Gross updated');
    assert.equal((await apply(updated, connection, { journal })).ok, true);
    await client.write('ir.model.fields', [ids['stateman_mis.allocation']], { compute: '# source drift\n' }, context);
    assert.equal((await drift(make('Gross updated'), connection, scope)).converged, false);
    const sourcePlan = await plan([field()], connection, { ...scope, recovery: journal.receipts });
    assert.equal(sourcePlan.operations[0].before.compute, '# source drift\n');
    assert.equal((await apply(sourcePlan, connection, { journal })).ok, true);
    // Explicit adoption of compatible fields and parent-scoped native MIS records.
    const adoptedField = computedField('account.move.line', 'stateman_mis.field_alias', { ...field().values, _ref: lookup('ir.model.fields', { model: 'account.move.line', name: 'x_stateman_allocation' }), name: 'x_stateman_allocation', label: 'Synthetic allocation', type: 'json', store: false, readonly: true, compute, depends: ['debit', 'quantity'] });
    assert.equal((await apply(await plan([adoptedField], connection, scope), connection, { journal })).ok, true);
    assert.equal((await plan([adoptedField], connection, scope)).bindings['stateman_mis.field_alias'], ids['stateman_mis.allocation']);
    const unmanaged = await client.create('mis.report.kpi', { report_id: ids['stateman_mis.report'], name: 'unmanaged', description: 'Unmanaged preserved', type: 'num', expression_ids: [[0, 0, { name: '1' }]] }, context);
    assert.equal((await plan(make('Gross updated'), connection, scope)).operations.length, 0);
    assert.equal((await client.searchRead('mis.report.kpi', [['id', '=', unmanaged]], { fields: [], context })).length, 1);
    const sub = mis.template('stateman_mis.dimension', { name: 'Synthetic dimension', subKpis: [mis.subKpi('debit', { name: 'debit', label: 'Debit', sequence: 10 }), mis.subKpi('credit', { name: 'credit', label: 'Credit', sequence: 20 })], kpis: [mis.kpi('movement', { name: 'movement', label: 'Movement', sequence: 10, expressions: { debit: '1', credit: '2' }, type: 'num', accumulation: 'sum', compare: 'diff', temporal: 'additive' })] });
    assert.equal((await apply(await plan([sub], connection, scope), connection, { journal })).ok, true);
    assert.equal((await plan([sub], connection, scope)).operations.length, 0);
    const nativeReport = await client.create('mis.report', { name: 'Adopt native MIS' }, context);
    const nativeKpi = await client.create('mis.report.kpi', { report_id: nativeReport, name: 'existing', description: 'Existing', multi: false, type: 'num', sequence: 10, accumulation_method: 'sum', compare_method: 'diff', expression_ids: [[0, 0, { name: '5' }]] }, context);
    const adoptedReport = mis.template('stateman_mis.adopted', { _ref: lookup('mis.report', { id: nativeReport }), name: 'Adopt native MIS', kpis: [mis.kpi('existing', { _ref: lookup('mis.report.kpi', { name: 'existing' }), name: 'existing', label: 'Existing', sequence: 10, expression: mis.expression('value', { _ref: lookup('mis.report.kpi.expression', { subkpi_id: false }), value: '5' }), type: 'num', accumulation: 'sum', compare: 'diff', temporal: 'additive' })] });
    const adoptPlan = await plan([adoptedReport], connection, scope);
    assert.equal(adoptPlan.operations.filter(o => o.type === 'create').length, 0);
    assert.equal(adoptPlan.operations.filter(o => o.type === 'adopt').length, 3);
    assert.equal((await apply(adoptPlan, connection, { journal })).ok, true);
    assert.equal((await plan([adoptedReport], connection, scope)).operations.length, 0);
    assert.equal(adoptPlan.bindings['stateman_mis.adopted.kpi.existing'], nativeKpi);
    for (const change of [{ store: true }, { name: 'x_renamed' }, { ttype: 'text' }]) {
      await assert.rejects(plan([resource('ir.model.fields', 'stateman_mis.allocation', change)], connection, scope), { code: 'FIELD_TRANSITION_UNSUPPORTED' });
    }
    const [baseField] = await client.searchRead('ir.model.fields', [['model', '=', 'account.move.line'], ['name', '=', 'debit']], { fields: [], context });
    await assert.rejects(plan([resource('ir.model.fields', 'stateman_mis.base', { _ref: lookup('ir.model.fields', { id: baseField.id }), field_description: 'Forbidden' })], connection, scope), { code: 'FIELD_BASE_PROTECTED' });
    // Separate verification actions: matrix, native drilldown and native exporters.
    const drill = await client.call('mis.report.instance', 'drilldown', [[ids['stateman_mis.single']], { period_id: ids['stateman_mis.single.period.jan'], expr: mis.aep({ field: 'balance', mode: 'variation', accounts: [['id', 'in', accountIds]] }) }], { context });
    assert.equal(drill.res_model, 'account.move.line');
    assert.deepEqual(await client.searchRead('ir.model.fields', [['id', '=', unrelated]], { fields: ['name', 'compute', 'depends', 'store', 'readonly'], context }), unrelatedBefore);
    const auth = await fetch(url + '/web/session/authenticate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db: database, login: 'admin', password: 'admin' }, id: 1 }) });
    assert.ok((await auth.json()).result?.uid);
    const cookie = auth.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    assert.ok(cookie);
    for (const [format, report] of [['xlsx', 'mis_builder.mis_report_instance_xlsx'], ['pdf', 'mis_builder.report_mis_report_instance']]) {
      const reportContext = encodeURIComponent(JSON.stringify(context));
      const response = await fetch(`${url}/report/${format}/${report}/${ids['stateman_mis.single']}?context=${reportContext}`, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.subarray(0, format === 'pdf' ? 5 : 2).toString(), format === 'pdf' ? '%PDF-' : 'PK');
      assert.ok(bytes.length > 1000);
      const file = join(root, 'mis-example.' + format);
      writeFileSync(file, bytes);
      const text = format === 'pdf' ? execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' }) : execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.read("xl/sharedStrings.xml").decode()); print(z.read("xl/styles.xml").decode())', file], { encoding: 'utf8' });
      assert.match(text, /Gross updated/); assert.doesNotMatch(text, /Hidden helper/);
      if (format === 'xlsx') assert.match(text, /<b\/>/);
    }
    writeFileSync(join(root, 'mis-matrices.json'), JSON.stringify({ single, group }, null, 2));
    return { passed: true, version: qualified.installed_version, singleCompanies: [a], groupCompanies: [a, b], checks: ['computed JSON runtime', 'source drift/adopt/no-op', 'monthly/YTD ratio recomputation', 'query posted/company scope', 'multi-company totals', 'styles hidden row', 'stable subset closure/scoped update', 'unmanaged preservation', 'sub-KPI expressions', 'native accounting drilldown', 'native XLSX/PDF exports', 'explicit MIS template/KPI/expression adoption', 'unsafe field transitions/base rejection'] };
  } finally { await journal.close(); }
}
