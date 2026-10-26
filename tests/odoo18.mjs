import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OdooClient } from '@godoo-dev/client';
import { apply, applyModules, createConnection, createFixture, drift, equivalentHtml, inspectResources, openRecoveryJournal, parseFixture, plan, planModules, resource, seedFixture, serializeFixture, translated } from '@godoo-dev/stateman';
import { scopedOdoo } from './scoped-odoo.mjs';

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
assert.deepEqual(createFixture(parseFixture(serializeFixture(fixture)),{namespaces:['stateman_ci']}),fixture);
const seedJournal=await openRecoveryJournal(join(root,'seed-recovery.json'));
try {
  const seeded=await seedFixture(fixture,connection,{journal:seedJournal,plan:{...versionOptions,recovery:seedJournal.receipts}});assert.equal(seeded.ok,true);assert.ok(seeded.bindings['stateman_ci.fixture']>0);
  const repeated=await seedFixture(fixture,connection,{journal:seedJournal,plan:{...versionOptions,recovery:seedJournal.receipts}});assert.equal(repeated.ok,true);assert.equal(repeated.result.committed,0);
} finally {await seedJournal.close();}
// Synthetic mail.template storage only: never render or send email. Installation
// and language activation affect only this harness's owned disposable database.
const [mail] = await client.searchRead('ir.module.module', [['name', '=', 'mail']], {fields:['state']});
assert.ok(mail);
if(mail.state !== 'installed') await client.call('ir.module.module','button_immediate_install',[[mail.id]]);
const languages = await client.searchRead('res.lang',[['code','in',['ca_ES','en_GB','es_ES']]],{fields:['code'],context:{active_test:false}});
assert.equal(languages.length,3);
await client.write('res.lang',languages.map(row=>row.id),{active:true});
const [partnerModel] = await client.searchRead('ir.model',[['model','=','res.partner']],{fields:[]});
assert.ok(partnerModel);
const sourceHtml = '<p>Source<br></p><t t-set="label" t-value="\'Example\'"></t><img src="/test.png">';
const languageHtml = {ca_ES:'<p>Català<br></p>',en_GB:'<p>English<br></p><p style="ma',es_ES:'<p>Castellano<br></p>'};
const storedHtml = {
  source:'<p>Source<br/></p><t t-set="label" t-value="\'Example\'"/><img src="/test.png"/>',
  ca_ES:'<p>Català<br/></p>',en_GB:'<p>English<br/></p><p style="ma"/>',es_ES:'<p>Castellano<br/></p>',
};
for (const inactiveBase of [false,true]) {
if (inactiveBase) {
  const users=await client.searchRead('res.users', [['lang','=','en_US']], {fields:[],context:{active_test:false}});
  if(users.length) await client.write('res.users',users.map(row=>row.id),{lang:'en_GB'});
  const contacts=await client.searchRead('res.partner', [['lang','=','en_US']], {fields:[],context:{active_test:false}});
  if(contacts.length) await client.write('res.partner',contacts.map(row=>row.id),{lang:'en_GB'});
  // Upstream res.lang.write rejects active contacts and even inactive users
  // still using this language. Only synthetic owned database records are moved.
  for(const model of ['res.users','res.partner']) assert.deepEqual(await client.searchRead(model,[['lang','=','en_US']],{fields:[],context:{active_test:false}}),[]);
  const [baseLanguage]=await client.searchRead('res.lang',[['code','=','en_US']],{fields:[],context:{active_test:false}});
  assert.ok(baseLanguage);await client.write('res.lang',[baseLanguage.id],{active:false});
  const [inactiveLanguage]=await client.searchRead('res.lang',[['id','=',baseLanguage.id]],{fields:['active'],context:{active_test:false}});
  assert.equal(inactiveLanguage.active,false);
}
const templateId=inactiveBase?'stateman_ci.html_inactive':'stateman_ci.html';
const descriptionByLanguage={ca_ES:'Descripció catalana',en_GB:'English description',es_ES:'Descripción castellana'};
const templates = [resource('mail.template',templateId,{name:'Stateman synthetic HTML',model_id:partnerModel.id,description:translated('Default description',descriptionByLanguage),body_html:translated(sourceHtml,languageHtml)})];
const htmlJournal = await openRecoveryJournal(join(root,`html-${inactiveBase}-recovery.json`));
try {
  const options = () => ({...versionOptions,context:{lang:false},recovery:htmlJournal.receipts});
  const rendered = await inspectResources(templates);
  assert.equal(rendered.resources[0].values.body_html,sourceHtml);
  const reviewed = await plan(rendered,connection,options());
  const applied = await apply(reviewed,connection,{journal:htmlJournal});
  assert.equal(applied.ok,true,JSON.stringify(applied));
  const fresh = await plan(rendered,connection,options());
  assert.deepEqual(fresh.operations,[]);
  const again = await apply(fresh,connection,{journal:htmlJournal});
  assert.equal(again.ok,true);assert.equal(again.committed,0);
  for(const lang of [false,'ca_ES','en_GB','es_ES']) {
    const [row] = await client.searchRead('mail.template',[['id','=',fresh.bindings[templateId]]],{fields:['body_html','description'],context:{lang}});
    assert.equal(row.description,lang?descriptionByLanguage[lang]:'Default description');
    assert.equal(row.body_html,storedHtml[lang||'source']); // Independent exact read, not just the helper.
    assert.equal(equivalentHtml(lang?languageHtml[lang]:sourceHtml,row.body_html),true);
  }
  for(const body of [sourceHtml.replace('Source','Changed'),sourceHtml.replace("'Example'","'Changed'"),sourceHtml.replace('/test.png','/changed.png'),sourceHtml.replace('<img ','<img alt="Changed" ')]) {
    const changed = structuredClone(rendered);changed.resources[0].values.body_html=body;
    assert.ok((await plan(changed,connection,options())).operations.some(op=>op.values.body_html===body));
  }
  const changedLanguage = structuredClone(rendered);
  changedLanguage.resources[0].translations.entries.find(entry=>entry.lang==='en_GB'&&entry.field==='body_html').value='<p>Different English<br></p>';
  const changedPlan=await plan(changedLanguage,connection,options());
  assert.equal(changedPlan.operations.length,2);assert.equal(changedPlan.operations[0].context.lang,'en_GB');
  assert.equal(changedPlan.operations[1].context.lang,false);
  assert.equal(changedPlan.operations[1].values.body_html,sourceHtml);
  const changedResult=await apply(changedPlan,connection,{journal:htmlJournal});
  assert.equal(changedResult.ok,true,JSON.stringify(changedResult));
  for(const lang of [false,'ca_ES','en_GB','es_ES']) {
    const [row]=await client.searchRead('mail.template',[['id','=',fresh.bindings[templateId]]],{fields:['body_html','description'],context:{lang}});
    assert.equal(row.description,lang?descriptionByLanguage[lang]:'Default description');
    assert.equal(row.body_html,lang==='en_GB'?'<p>Different English<br/></p>':storedHtml[lang||'source']);
  }
  assert.equal((await apply(await plan(changedLanguage,connection,options()),connection,{journal:htmlJournal})).committed,0);
} finally {await htmlJournal.close();}
}
// Restore the language fixture before independent accounting/CLI checks.
const [restoredBase] = await client.searchRead('res.lang', [['code', '=', 'en_US']], {fields:[],context:{active_test:false}});
await client.write('res.lang', [restoredBase.id], {active:true});
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
let supplierModuleStage = false;
if (existsSync(join(root,'suppliers.json'))) {
  const { Introspector } = await import('@godoo-dev/introspection');
  const introspector = new Introspector(client);
  assert.equal((await introspector.getModels()).some(model => model.model === 'project.project'), false);
  let invalidations = 0;
  const stage = { identity: connection.identity, modules: client.modules, invalidateSchema: () => { invalidations++; introspector.clearCache(); } };
  const preview = await planModules(stage,[{name:'project',action:'install'}]);
  assert.equal(preview.prerequisites.modules.find(module=>module.name==='project').status,'uninstalled');
  const installed = await applyModules(preview,stage);
  assert.equal(installed.ok,true);assert.equal(installed.requiresReplan,true);assert.equal(invalidations,1);
  assert.equal((await introspector.getModels()).some(model=>model.model==='project.project'),true);
  const noop = await applyModules(await planModules(stage,[{name:'project',action:'install'}]),stage);
  assert.equal(noop.ok,true);assert.equal(noop.requiresReplan,false);assert.equal(invalidations,1);
  const upgraded = await applyModules(await planModules(stage,[{name:'project',action:'upgrade'}]),stage);
  assert.equal(upgraded.ok,true);assert.equal(upgraded.requiresReplan,true);assert.equal(invalidations,2);
  const projectJournal=await openRecoveryJournal(join(root,'project-recovery.json'));
  try {
    const desired=[resource('project.project','stateman_ci.project',{name:'Installed supplier project'})];
    const fresh=await plan(desired,connection,{...versionOptions,recovery:projectJournal.receipts});
    assert.equal((await apply(fresh,connection,{journal:projectJournal})).ok,true);
    assert.equal((await drift(desired,connection,{...versionOptions,recovery:projectJournal.receipts})).converged,true);
  } finally {await projectJournal.close();}
  supplierModuleStage = true;
}
const scoped = await scopedOdoo({ client, connection, root, url, database, versionOptions });
console.log(JSON.stringify({scoped,passed:true,observedVersion:server.version,uid:client.getSession()?.uid,binding,supplierModuleStage,checks:['installed API create/durable receipt/no-op/update','actual drift and stale refusal without writes','fresh convergence','portable fixture roundtrip/seed/repeat committed0','mail.template HTML/text active+inactive-en_US source/three-language exact reads/convergence/update/repeat committed0/content negatives','installed CLI plan/apply/fresh drift','missing-connection poison refusal'],cleanup:'owned whole disposable environment removed by caller'}));
