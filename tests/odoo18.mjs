import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OdooClient } from '@godoo-dev/client';
import { apply, createConnection, createFixture, drift, inspectResources, openRecoveryJournal, parseFixture, plan, resource, seedFixture, serializeFixture } from '@godoo-dev/stateman';

const root = import.meta.dirname;
const { url, database } = JSON.parse(readFileSync(join(root,'target.json'),'utf8'));
assert.match(url,/^http:\/\/127\.0\.0\.1:\d+$/);
assert.equal(database,'stateman_ci');
const client = new OdooClient({url,database,username:'admin',password:'admin',safety:{confirm:async operation=>operation.target===url}});
await client.authenticate();
const connection = createConnection(client,{url});
const server = await connection.serverInfo();
const expectedMajor = JSON.parse(readFileSync(join(root,'target.json'),'utf8')).major;
assert.equal(Number(server.version.split('.')[0]),expectedMajor);
const versionOptions = expectedMajor === 18 ? {} : {odooMajorVersions:[expectedMajor]};
const externalId = 'stateman_ci.partner';
const definitions = name => [resource('res.partner',externalId,{name})];
const journalPath = join(root,'recovery.json');
const journal = await openRecoveryJournal(journalPath);
let binding;
try {
  const first = await plan(definitions('CI partner'),connection,{...versionOptions,recovery:journal.receipts});
  assert.equal(first.operations.filter(operation=>operation.type==='create').length,1);
  const result = await apply(first,connection,{journal});
  assert.equal(result.ok,true);
  binding = (await plan(definitions('CI partner'),connection,{...versionOptions,recovery:journal.receipts})).bindings[externalId];
  assert.ok(binding>0);
  assert.equal((await drift(definitions('CI partner'),connection,{...versionOptions,recovery:journal.receipts})).converged,true);
  const changed = await plan(definitions('Updated CI partner'),connection,{...versionOptions,recovery:journal.receipts});
  assert.ok(changed.operations.some(operation=>operation.type==='update'));
  assert.equal((await apply(changed,connection,{journal})).ok,true);
  const reviewed = await plan(definitions('Reviewed CI partner'),connection,{...versionOptions,recovery:journal.receipts});
  await client.write('res.partner',[binding],{name:'Manual drift'});
  const before = await client.searchRead('res.partner',[['id','=',binding]],{fields:['name']});
  await assert.rejects(apply(reviewed,connection,{journal}),error=>error.code==='STALE_PLAN');
  assert.deepEqual(await client.searchRead('res.partner',[['id','=',binding]],{fields:['name']}),before);
  assert.equal((await drift(definitions('Updated CI partner'),connection,{...versionOptions,recovery:journal.receipts})).converged,false);
  assert.equal((await apply(await plan(definitions('Updated CI partner'),connection,{...versionOptions,recovery:journal.receipts}),connection,{journal})).ok,true);
  assert.equal((await drift(definitions('Updated CI partner'),connection,{...versionOptions,recovery:journal.receipts})).converged,true);
} finally { await journal.close(); }
const fixture=createFixture(await inspectResources([resource('res.partner','stateman_ci.fixture',{name:'Portable fixture'})]),{namespaces:['stateman_ci']});
assert.deepEqual(parseFixture(serializeFixture(fixture)),fixture);
const seedJournal=await openRecoveryJournal(join(root,'seed-recovery.json'));
try {
  const seeded=await seedFixture(fixture,connection,{journal:seedJournal,plan:{...versionOptions,recovery:seedJournal.receipts}});assert.equal(seeded.ok,true);assert.ok(seeded.bindings['stateman_ci.fixture']>0);
  const repeated=await seedFixture(fixture,connection,{journal:seedJournal,plan:{...versionOptions,recovery:seedJournal.receipts}});assert.equal(repeated.ok,true);assert.equal(repeated.result.committed,0);
} finally {await seedJournal.close();}
// Exercise the installed CLI in fresh subprocesses against the same owned target.
writeFileSync(join(root,'connection.mjs'),`import {OdooClient} from '@godoo-dev/client'; import {createConnection} from '@godoo-dev/stateman'; const client=new OdooClient(${JSON.stringify({url,database,username:'admin',password:'admin'})}); await client.authenticate(); export default createConnection(client,{url:${JSON.stringify(url)}});`);
writeFileSync(join(root,'resources.mjs'),"import {resource} from '@godoo-dev/stateman'; export const partner=resource('res.partner','stateman_ci.partner',{name:'CLI partner'});\n");
const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve('@godoo-dev/stateman'))));
const bin = join(packageRoot,'bin/stateman.js');
writeFileSync(join(root,'options.json'),JSON.stringify(versionOptions));
const shared = ['--options',join(root,'options.json'),'--connection',join(root,'connection.mjs'),'--journal',journalPath];
const run = args => execFileSync(process.execPath,[bin,...args],{cwd:root,encoding:'utf8'});
const planPath=join(root,'reviewed.json');
JSON.parse(run(['plan',join(root,'resources.mjs'),...shared,'--out',planPath]));
assert.equal(JSON.parse(run(['apply',planPath,...shared])).ok,true);
assert.equal(JSON.parse(run(['drift',join(root,'resources.mjs'),...shared])).converged,true);
const rows=await client.searchRead('res.partner',[['id','=',binding]],{fields:['name']});
assert.equal(rows[0].name,'CLI partner');
const poison=join(root,'poison.mts');writeFileSync(poison,"throw new Error('POISON_MODULE_EXECUTED');");
const denied=spawnSync(process.execPath,[bin,'plan',poison],{encoding:'utf8'});
assert.equal(denied.status,1);assert.match(denied.stderr,/CONNECTION_REQUIRED/);assert.doesNotMatch(denied.stderr,/POISON/);
console.log(JSON.stringify({passed:true,observedVersion:server.version,uid:client.getSession()?.uid,binding,checks:['installed API create/durable receipt/no-op/update','actual drift and stale refusal without writes','fresh convergence','portable fixture roundtrip/seed/repeat committed0','installed CLI plan/apply/fresh drift','missing-connection poison refusal'],cleanup:'owned whole disposable environment removed by caller'}));
