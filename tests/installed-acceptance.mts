import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, children, equivalentHtml, plan, drift, resource, ref, openRecoveryJournal, readRecoveryJournal } from '@godoo-dev/stateman';
import type { Schema } from '@godoo-dev/stateman';
import { FakeClient } from './fake-client.js';
import { scopedAcceptance, standardContextAcceptance } from './scoped-acceptance.js';
import { planningAcceptance } from './planning-acceptance.js';

await scopedAcceptance();
await planningAcceptance();
await standardContextAcceptance();
console.log('PASS: installed exact M2M ownership and company-dependent effective values, stale refusal, partial failure/recovery, translations, new targets and zero-write repeat.');

const root = import.meta.dirname;
const client = new FakeClient();
Object.assign(client.schema, {
  'ir.actions.client': { name: { type: 'char' }, tag: { type: 'char' } },
  'ir.ui.menu': { action: { type: 'reference', selection: [['ir.actions.client', 'Client action']] } },
} satisfies Schema);
assert.equal(equivalentHtml('<t t-out="object.name"></t><br>', '<t t-out="object.name"/><br/>'), true);
assert.equal(equivalentHtml('<p style="ma', '<p style="ma"/>'), true);
assert.equal(equivalentHtml('<t t-out="object.name"></t>', '<t t-out="object.email"/>'), false);
client.seed('document.page', { content: '<p>Installed<br/></p>' }, 'fixture.html');
assert.deepEqual((await plan([resource('document.page', 'fixture.html', { content: '<p>Installed<br></p>' })], client.connection())).operations, []);
const definitions = [
  resource('x', 'fixture.root', { name: 'Root' }),
  resource('x', 'fixture.child', { name: 'Child', parent_id: ref('fixture.root'), items: [ref('fixture.root')] }),
  resource('ir.ui.menu', 'fixture.menu', { action: ref('fixture.dashboard') }),
  resource('ir.actions.client', 'fixture.dashboard', { name: 'Dashboard', tag: 'fixture.dashboard' }),
];
const path = resolve(root, 'api-recovery.json');
const journal = await openRecoveryJournal(path);
try {
  const result = await apply(await plan(definitions, client.connection()), client.connection(), { journal });
  assert.equal(result.ok, true); assert.equal(result.failed, 0); assert.equal(result.drift?.operations.length, 0);
  assert.equal(client.data['ir.ui.menu'][0].action, `ir.actions.client,${result.drift!.bindings['fixture.dashboard']}`);
  assert.deepEqual(result.drift!.schema['ir.ui.menu'].action.selection, [['ir.actions.client', 'Client action']]);
} finally { await journal.close(); }
assert.equal((await readRecoveryJournal(path)).length, 4);
assert.equal((await drift(definitions, client.connection())).converged, true);
const noOp = await apply(await plan(definitions, client.connection()), client.connection()); assert.equal(noOp.ok, true);

writeFileSync(resolve(root, 'connection.ts'), `
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {FakeClient} from './fake-client.js';
const dbPath = new URL('./db.json',import.meta.url);
const client = new FakeClient();
if (existsSync(dbPath)) { const db=JSON.parse(readFileSync(dbPath,'utf8')); client.data=db.data; client.nextId=db.nextId; }
for (const method of ['create','write','unlink'] as const) {
  const original=client[method].bind(client) as (...args: any[])=>Promise<any>;
  (client as any)[method]=async (...args:any[])=>{const result=await original(...args); writeFileSync(dbPath,JSON.stringify({data:client.data,nextId:client.nextId}));return result;};
}
export default client.connection();
`);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.resolve('@godoo-dev/stateman'))), '..');
const bin = resolve(packageRoot, 'bin/stateman.js');
const input = resolve(root, 'resource.ts'), connection = resolve(root, 'connection.ts'), recovery = resolve(root, 'cli-recovery.json'), reviewedPath = resolve(root, 'plan.json');
const run = (...args: string[]) => execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
const declare = (name: string) => writeFileSync(input, `import {resource} from '@godoo-dev/stateman'; export const record=resource('x','fixture.cli',{name:${JSON.stringify(name)}});\n`);
declare('First');
const first = JSON.parse(run('plan', input, '--connection', connection, '--journal', recovery, '--out', reviewedPath));
assert.equal(first.operations[0].type, 'create');
assert.equal(JSON.parse(run('apply', reviewedPath, '--connection', connection, '--journal', recovery)).ok, true);
assert.equal(JSON.parse(run('drift', input, '--connection', connection, '--journal', recovery)).converged, true);
const repeated = spawnSync(process.execPath, [bin, 'apply', reviewedPath, '--connection', connection, '--journal', recovery], { encoding: 'utf8' });
assert.equal(repeated.status, 1); assert.match(repeated.stderr, /JOURNAL_CHANGED/);
declare('Second');
const changed = JSON.parse(run('plan', input, '--connection', connection, '--journal', recovery, '--out', reviewedPath));
assert.equal(changed.operations[0].type, 'update');
assert.equal(JSON.parse(run('apply', reviewedPath, '--connection', connection, '--journal', recovery)).ok, true);
assert.equal(JSON.parse(run('drift', input, '--connection', connection, '--journal', recovery)).converged, true);
declare('Third');
const dirty = spawnSync(process.execPath, [bin, 'drift', input, '--connection', connection, '--journal', recovery], { encoding: 'utf8' });
assert.equal(dirty.status, 2); assert.equal(JSON.parse(dirty.stdout).converged, false);
const state = JSON.parse(readFileSync(resolve(root, 'db.json'), 'utf8'));
assert.equal(state.data.x.length, 1); assert.equal(state.data.x[0].name, 'Second');
console.log('PASS: installed package API and CLI plan/apply/drift, durable journal, create/no-op/update, drift exit 2, stale journal rejection, no duplicate create.');

for (const parentChanges of [false, true]) for (const childWork of ['scalar', 'link']) for (const stopOnError of [true, false]) {
  const store = new FakeClient();
  const parent = store.seed('x', { name: 'Parent' }, 'readiness.b_parent');
  const child = store.seed('x', { name: 'Child', parent_id: parent }, 'readiness.b_parent.child');
  store.data.x.find(row => row.id === parent)!.items = [child];
  const tag = store.seed('x', {});
  const dependent = store.seed('x', { name: 'Before' }, 'readiness.a_dependent');
  const desired = [
    resource('x', 'readiness.b_parent', {
      name: parentChanges ? 'Parent after' : 'Parent',
      items: children('x', 'parent_id', [resource('x', 'child', childWork === 'scalar' ? { name: 'Refused' } : { name: 'Child', items: [tag] })]),
    }),
    resource('x', 'readiness.a_dependent', { name: 'After' }, { dependsOn: ['readiness.b_parent'] }),
  ];
  const reviewed = await plan(desired, store.connection());
  assert.deepEqual(reviewed.operations.filter(op => op.externalId === 'readiness.b_parent').map(op => op.type), parentChanges ? ['update'] : []);
  store.failure = (_method, _model, values) => values?.name === 'Refused' || values?.items ? new Error('child work refused') : undefined;
  const failed = await apply(reviewed, store.connection(), { stopOnError });
  assert.equal(failed.ok, false);
  assert.equal(failed.results.find(r => r.operation.externalId === 'readiness.b_parent.child')?.status, 'failed');
  assert.equal(failed.results.find(r => r.operation.externalId === 'readiness.a_dependent')?.status, 'skipped');
  assert.equal(store.data.x.find(row => row.id === dependent)?.name, 'Before');
  store.failure = undefined;
  const retry = await apply(await plan(desired, store.connection()), store.connection());
  assert.equal(retry.ok, true);
  const order = retry.results.map(r => r.operation.externalId);
  assert.ok(order.indexOf('readiness.b_parent.child') < order.indexOf('readiness.a_dependent'));
  assert.equal((await drift(desired, store.connection())).converged, true);
}
console.log('PASS: installed full parent readiness includes already-linked scalar/deferred child work, unchanged/scalar-changing parents, both stop modes, retry and fresh convergence.');
