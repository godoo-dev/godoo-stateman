import assert from 'node:assert/strict';
import { apply, computedField, inspectResources, openRecoveryJournal, plan } from '@godoo-dev/stateman';
import * as mis from '@godoo-dev/stateman/mis';
import { fieldFixture } from './fields-client.js';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const client = fieldFixture();
const field = computedField('x', 'installed.field', { name: 'x_allocation', label: 'Allocation', type: 'json', store: false, readonly: true, compute: readFileSync(new URL('./compute.py', import.meta.url), 'utf8'), depends: ['name'] });
const journal = await openRecoveryJournal(join(import.meta.dirname, 'fields-journal.json'));
try {
  const first = await plan([field], client.connection(), { recovery: journal.receipts });
  assert.equal(first.operations[0].values.compute, readFileSync(new URL('./compute.py', import.meta.url), 'utf8'));
  assert.equal((await apply(first, client.connection(), { journal })).ok, true);
  assert.equal((await plan([field], client.connection(), { recovery: journal.receipts })).operations.length, 0);
  assert.equal(client.data['ir.model.fields'].length, 1);
} finally { await journal.close(); }
const report = mis.template('installed.report', { name: 'Report', kpis: [mis.kpi('value', { name: 'value', label: 'Value', sequence: 10, expression: '1', type: 'num', accumulation: 'sum', compare: 'diff', temporal: 'additive' })] });
const instance = mis.instance('installed.group', { name: 'Group', template: report, companies: [1, 2], currency: 1, targetMove: 'posted', periods: [mis.period('jan', { label: 'January', sequence: 10, source: 'actuals', dates: { mode: 'fixed', from: '2026-01-01', to: '2026-01-31' } })] });
const graph = await inspectResources([instance]);
assert.ok(graph.resources.some(r => r.externalId === 'installed.report.kpi.value.expression.value'));
assert.deepEqual(graph.resources.find(r => r.externalId === 'installed.group')!.values.company_ids, { __type: 'exact', targets: [1, 2] });
assert.equal(mis.queryDomain([['active', '=', false]]), '[("active", "=", False)]');
console.log('Installed computed-field lifecycle and MIS subpath/graph passed');

const cliModule = join(import.meta.dirname, 'mis-resources.mts');
writeFileSync(cliModule, `import * as mis from '@godoo-dev/stateman/mis';
export const report = mis.template('cli.report', {name: 'CLI MIS', kpis: [mis.kpi('value', {name:'value',label:'Value',sequence:10,type:'num',accumulation:'sum',compare:'diff',temporal:'additive',expression:'1'})]});
`);
const cli = JSON.parse(execFileSync(process.execPath, [join(import.meta.dirname, 'node_modules/@godoo-dev/stateman/bin/stateman.js'), 'inspect', cliModule], { encoding: 'utf8' }));
assert.ok(cli.resources.some((r: { externalId: string }) => r.externalId === 'cli.report.kpi.value.expression.value'));
console.log('Installed CLI loads MIS helper modules and preserves Python file bytes');
