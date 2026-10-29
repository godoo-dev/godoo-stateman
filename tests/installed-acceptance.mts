import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
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
const referenceSchema = {
  'ir.actions.client': { name: { type: 'char' }, tag: { type: 'char' } },
  'ir.ui.menu': { name: { type: 'char' }, action: { type: 'reference', selection: [['ir.actions.client', 'Client action'], ['ir.actions.server', 'Server action']] } },
  'reference.numeric': { action_id: { type: 'many2one', relation: 'ir.actions.client' }, payload: { type: 'json' }, polymorphic_id: { type: 'many2one_reference' } },
} satisfies Schema;
Object.assign(client.schema, referenceSchema);
assert.equal(equivalentHtml('<t t-out="object.name"></t><br>', '<t t-out="object.name"/><br/>'), true);
assert.equal(equivalentHtml('<p style="ma', '<p style="ma"/>'), true);
assert.equal(equivalentHtml('<t t-out="object.name"></t>', '<t t-out="object.email"/>'), false);
client.seed('document.page', { content: '<p>Installed<br/></p>' }, 'fixture.html');
assert.deepEqual((await plan([resource('document.page', 'fixture.html', { content: '<p>Installed<br></p>' })], client.connection())).operations, []);
const definitions = [resource('x', 'fixture.root', { name: 'Root' }), resource('x', 'fixture.child', { name: 'Child', parent_id: ref('fixture.root'), items: [ref('fixture.root')] })];
const path = resolve(root, 'api-recovery.json');
const journal = await openRecoveryJournal(path);
try {
  const result = await apply(await plan(definitions, client.connection()), client.connection(), { journal });
  assert.equal(result.ok, true); assert.equal(result.failed, 0); assert.equal(result.drift?.operations.length, 0);
} finally { await journal.close(); }
assert.equal((await readRecoveryJournal(path)).length, 2);
assert.equal((await drift(definitions, client.connection())).converged, true);
const noOp = await apply(await plan(definitions, client.connection()), client.connection()); assert.equal(noOp.ok, true);

const apiReferenceDefinitions = [
  resource('ir.ui.menu', 'reference.menu', { name: 'Dashboard', action: ref('reference.dashboard') }),
  resource('ir.actions.client', 'reference.dashboard', { name: 'Dashboard', tag: 'reference.dashboard' }),
  resource('reference.numeric', 'reference.numeric', {
    action_id: ref('reference.dashboard'), polymorphic_id: ref('reference.dashboard'),
    payload: { nested: [ref('reference.dashboard')] },
  }),
];
const apiReferencePath = resolve(root, 'reference-api-recovery.json');
const apiReferenceJournal = await openRecoveryJournal(apiReferencePath);
try {
  const options = () => ({ context: { lang: false }, recovery: apiReferenceJournal.receipts });
  const reviewed = await plan(apiReferenceDefinitions, client.connection(), options());
  assert.equal(reviewed.schema['ir.ui.menu'].action.type, 'reference');
  assert.deepEqual(reviewed.schema['ir.ui.menu'].action.selection, referenceSchema['ir.ui.menu'].action.selection);
  const applied = await apply(JSON.parse(JSON.stringify(reviewed)), client.connection(), { journal: apiReferenceJournal });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  const actionId = applied.drift!.bindings['reference.dashboard'];
  const [menu] = await client.searchRead('ir.ui.menu', [], { fields: ['action'] });
  const [numeric] = await client.searchRead('reference.numeric', [], { fields: ['action_id', 'payload', 'polymorphic_id'] });
  assert.equal(menu.action, `ir.actions.client,${actionId}`);
  assert.equal(numeric.action_id, actionId);
  assert.equal(numeric.polymorphic_id, actionId);
  assert.deepEqual(numeric.payload, { nested: [actionId] });
  assert.deepEqual(apiReferenceJournal.receipts.map(receipt => [receipt.externalId, receipt.model, receipt.state]).sort(), [
    ['reference.dashboard', 'ir.actions.client', 'complete'], ['reference.menu', 'ir.ui.menu', 'complete'], ['reference.numeric', 'reference.numeric', 'complete'],
  ]);
  const mutationCount = client.mutations.length;
  const again = await apply(await plan(apiReferenceDefinitions, client.connection(), options()), client.connection(), { journal: apiReferenceJournal });
  assert.equal(again.ok, true); assert.equal(again.committed, 0);
  assert.equal(client.mutations.length, mutationCount);
  assert.equal((await drift(apiReferenceDefinitions, client.connection(), options())).converged, true);
} finally { await apiReferenceJournal.close(); }
assert.equal((await readRecoveryJournal(apiReferencePath)).length, 3);

writeFileSync(resolve(root, 'connection.ts'), `
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {FakeClient} from './fake-client.js';
const dbPath = new URL('./db.json',import.meta.url);
const client = new FakeClient();
Object.assign(client.schema, ${JSON.stringify(referenceSchema)});
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

const referenceInput = resolve(root, 'reference.ts');
const referenceRecovery = resolve(root, 'reference-cli-recovery.json');
const referencePlan = resolve(root, 'reference-plan.json');
const referenceOptions = resolve(root, 'reference-options.json');
writeFileSync(referenceOptions, JSON.stringify({ select: ['reference_cli.menu'], context: { lang: false } }));
const declareReference = (action: string) => writeFileSync(referenceInput, `
import {resource,ref} from '@godoo-dev/stateman';
export const menu=resource('ir.ui.menu','reference_cli.menu',{name:'CLI Dashboard',action:${action}});
export const dashboard=resource('ir.actions.client','reference_cli.dashboard',{name:'CLI Dashboard',tag:'reference_cli.dashboard'});
`);
const referenceArgs = ['--connection', connection, '--journal', referenceRecovery, '--options', referenceOptions];
const referenceRead = () => {
  const db = JSON.parse(readFileSync(resolve(root, 'db.json'), 'utf8'));
  assert.equal(db.data['ir.actions.client'].length, 1);
  assert.equal(db.data['ir.ui.menu'].length, 1);
  const action = db.data['ir.actions.client'][0], menu = db.data['ir.ui.menu'][0];
  assert.equal(action.name, 'CLI Dashboard'); assert.equal(action.tag, 'reference_cli.dashboard');
  const identities = db.data['ir.model.data'].filter((row: Record<string, unknown>) => row.module === 'reference_cli');
  assert.deepEqual(identities.map((row: Record<string, unknown>) => [row.name, row.model, row.res_id]).sort(), [
    ['dashboard', 'ir.actions.client', action.id], ['menu', 'ir.ui.menu', menu.id],
  ]);
  return { action, menu };
};
const referenceNoOp = () => {
  const fresh = JSON.parse(run('plan', referenceInput, ...referenceArgs, '--out', referencePlan));
  assert.deepEqual(fresh.operations, []);
  const again = JSON.parse(run('apply', referencePlan, ...referenceArgs));
  assert.equal(again.ok, true); assert.equal(again.committed, 0);
  assert.equal(JSON.parse(run('drift', referenceInput, ...referenceArgs)).converged, true);
};
declareReference("ref('reference_cli.dashboard')");
const referenceReviewed = JSON.parse(run('plan', referenceInput, ...referenceArgs, '--out', referencePlan));
writeFileSync(resolve(root, 'reference-cli-create-plan.json'), JSON.stringify(referenceReviewed, null, 2) + '\n');
assert.deepEqual(referenceReviewed.order, ['reference_cli.dashboard', 'reference_cli.menu']);
assert.deepEqual(referenceReviewed.resources.map((row: { externalId: string }) => row.externalId).sort(), ['reference_cli.dashboard', 'reference_cli.menu']);
assert.equal(referenceReviewed.schema['ir.ui.menu'].action.type, 'reference');
assert.deepEqual(referenceReviewed.schema['ir.ui.menu'].action.selection, referenceSchema['ir.ui.menu'].action.selection);
assert.equal(referenceReviewed.operations.filter((op: { type: string }) => op.type === 'create').length, 2);
assert.equal(JSON.parse(run('apply', referencePlan, ...referenceArgs)).ok, true);
const referenceCreated = referenceRead();
assert.equal(referenceCreated.menu.action, `ir.actions.client,${referenceCreated.action.id}`);
const referenceReceipts = await readRecoveryJournal(referenceRecovery);
assert.deepEqual(referenceReceipts.map(receipt => [receipt.externalId, receipt.model, receipt.state]).sort(), [
  ['reference_cli.dashboard', 'ir.actions.client', 'complete'], ['reference_cli.menu', 'ir.ui.menu', 'complete'],
]);
referenceNoOp();
for (const empty of ['false', 'null']) {
  declareReference(empty);
  const cleared = JSON.parse(run('plan', referenceInput, ...referenceArgs, '--out', referencePlan));
  assert.equal(cleared.operations.length, 1); assert.equal(cleared.operations[0].type, 'update');
  assert.equal(JSON.parse(run('apply', referencePlan, ...referenceArgs)).ok, true);
  assert.equal(referenceRead().menu.action, false);
  referenceNoOp();
  declareReference("ref('reference_cli.dashboard')");
  const assigned = JSON.parse(run('plan', referenceInput, ...referenceArgs, '--out', referencePlan));
  assert.equal(assigned.operations.length, 1); assert.equal(assigned.operations[0].type, 'update');
  assert.equal(assigned.operations[0].values.action, `ir.actions.client,${referenceCreated.action.id}`);
  assert.equal(JSON.parse(run('apply', referencePlan, ...referenceArgs)).ok, true);
  assert.equal(referenceRead().menu.action, `ir.actions.client,${referenceCreated.action.id}`);
  referenceNoOp();
}
assert.deepEqual(await readRecoveryJournal(referenceRecovery), referenceReceipts);
if (process.env.GODOO_ARTIFACT_DIR) {
  for (const name of ['reference-api-recovery.json', 'reference-cli-recovery.json', 'reference-cli-create-plan.json']) {
    copyFileSync(resolve(root, name), resolve(process.env.GODOO_ARTIFACT_DIR, `installed-${name}`));
  }
}
console.log('PASS: installed typed API Reference/model receipts with numeric M2O/JSON/many2one_reference; selected native CLI saved plan/apply/drift, new/existing action, false/null clears and zero-commit repeats.');

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
