import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, plan, drift, resource, ref, openRecoveryJournal, readRecoveryJournal } from '@godoo-dev/stateman';
import { FakeClient } from './fake-client.js';

const root = import.meta.dirname;
const client = new FakeClient();
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
