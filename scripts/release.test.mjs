import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { hash, promoteCandidate, requireReleaseSource, verifyCandidate } from './release.mjs';
import { frozenConsumer } from './consumer.mjs';

const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value)); };
const load = path => JSON.parse(readFileSync(path, 'utf8'));
function fixture(t) {
  const area = mkdtempSync(join(tmpdir(), 'stateman-release-controls-'));
  t.after(() => rmSync(area, { recursive: true, force: true }));
  const root=join(area,'source'), directory=join(area,'candidate'), unpack=join(area,'unpack/package');
  mkdirSync(directory,{recursive:true}); mkdirSync(root);
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','main');git('config','user.email','control@example.invalid');git('config','user.name','Release control');
  const pkg={name:'@godoo-dev/stateman',version:'0.1.0',license:'LGPL-3.0-only',publishConfig:{access:'public',registry:'https://registry.npmjs.org'},dependencies:{debug:'^4.4.3'}};
  write(join(root,'package.json'),pkg); write(join(root,'package-lock.json'),{lockfileVersion:3});write(join(root,'.gitignore'),'dist/\n');
  for(const name of ['LICENSE','COPYING','NOTICE.md','src/index.ts','dist/index.js','dist/index.d.ts','bin/stateman.js'])write(join(root,name),'fixture '+name+'\n');
  git('add','.');git('commit','-m','fixture');
  const origin=join(area,'origin.git');execFileSync('git',['init','--bare',origin],{stdio:'ignore'});git('remote','add','origin',origin);git('push','origin','main');
  const names=['package.json','LICENSE','COPYING','NOTICE.md','src/index.ts','dist/index.js','dist/index.d.ts','bin/stateman.js'];
  for(const name of names){mkdirSync(dirname(join(unpack,name)),{recursive:true});cpSync(join(root,name),join(unpack,name));}
  const filename='godoo-dev-stateman-0.1.0.tgz';
  execFileSync('tar',['-czf',join(directory,filename),'-C',dirname(unpack),'package']);
  const artifact={package:pkg.name,version:pkg.version,filename,sha256:hash(join(directory,filename))};
  write(join(directory,'installed-files.json'),Object.fromEntries(names.map(name=>[name,hash(join(unpack,name))])));
  write(join(directory,'installed-package.json'),{private:true,dependencies:{[pkg.name]:'file:/old/'+filename}});
  write(join(directory,'installed-package-lock.json'),{lockfileVersion:3,packages:{'':{dependencies:{[pkg.name]:'file:/old/'+filename}},'node_modules/@godoo-dev/stateman':{version:pkg.version,resolved:'file:/old/'+filename,integrity:'sha512-'+createHash('sha512').update(readFileSync(join(directory,filename))).digest('base64')},'node_modules/debug':{version:'4.4.3',integrity:'kept',resolved:'https://registry.npmjs.org/debug/-/debug-4.4.3.tgz'}}});
  const manifest={sourceHead:git('rev-parse','HEAD'),dirtyState:'',lockSha256:hash(join(root,'package-lock.json')),artifacts:[artifact],proofHashes:Object.fromEntries(['installed-files.json','installed-package.json','installed-package-lock.json'].map(name=>[name,hash(join(directory,name))]))};
  write(join(directory,'manifest.json'),manifest);
  const proof={passed:true,sourceHead:manifest.sourceHead,candidateManifestSha256:hash(join(directory,'manifest.json')),artifact,consumerLockTemplateSha256:manifest.proofHashes['installed-package-lock.json'],cleanupPending:false,allOwnedResourcesAbsent:true,owner:'control-owner',output:JSON.stringify({passed:true,observedVersion:'18.0'})};
  write(join(directory,'odoo18-result.json'),proof);
  write(join(directory,'odoo18-cleanup.json'),{owner:'control-owner',allAbsent:true,proof:Array.from({length:5},(_,i)=>({name:'owned-'+i,absent:true,ownerChecked:true}))});
  const env={GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'godoo-dev/godoo-stateman'};
  return {root,directory,git,env,manifest,artifact,proof,archive:join(directory,filename)};
}

test('clean current main may qualify; manual/ref/repository, dirty and stale eligibility fail closed',t=>{
  const f=fixture(t);assert.equal(requireReleaseSource(f.root,f.env),f.manifest.sourceHead);
  for(const [key,value] of Object.entries({GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/develop',GITHUB_REPOSITORY:'other/repo'}))assert.throws(()=>requireReleaseSource(f.root,{...f.env,[key]:value}));
  write(join(f.root,'unreviewed.txt'),'dirty');assert.throws(()=>requireReleaseSource(f.root,f.env),/clean/);rmSync(join(f.root,'unreviewed.txt'));
  f.git('commit','--allow-empty','-m','newer local');assert.throws(()=>requireReleaseSource(f.root,f.env),/remote main/);
});

test('promotion checks exact retained archive, consumer and18 evidence without rebuilding dist',t=>{
  const f=fixture(t);rmSync(join(f.root,'dist'),{recursive:true});
  assert.equal(verifyCandidate(f.directory,{root:f.root,env:f.env}).artifact.sha256,f.artifact.sha256);
});

test('hosted promotion binds the candidate to the current source and workflow attempt',t=>{
  const f=fixture(t);
  const env={...f.env,GITHUB_ACTIONS:'true',GITHUB_SHA:f.manifest.sourceHead,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2'};
  f.manifest.workflow={runId:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT};
  write(join(f.directory,'manifest.json'),f.manifest);
  f.proof.workflow=f.manifest.workflow;
  f.proof.candidateManifestSha256=hash(join(f.directory,'manifest.json'));
  write(join(f.directory,'odoo18-result.json'),f.proof);
  assert.equal(verifyCandidate(f.directory,{root:f.root,env}).artifact.sha256,f.artifact.sha256);
  for(const [key,value] of Object.entries({GITHUB_SHA:'0'.repeat(40),GITHUB_RUN_ID:'124',GITHUB_RUN_ATTEMPT:'1'}))
    assert.throws(()=>verifyCandidate(f.directory,{root:f.root,env:{...env,[key]:value}}));
});

for(const [name,mutate] of [
  ['wrong source',f=>{f.manifest.sourceHead='0'.repeat(40);write(join(f.directory,'manifest.json'),f.manifest);} ],
  ['changed archive',f=>write(f.archive,'changed')],
  ['changed consumer lock',f=>write(join(f.directory,'installed-package-lock.json'),{})],
  ['omitted18',f=>rmSync(join(f.directory,'odoo18-result.json'))],
  ['failed18',f=>{f.proof.passed=false;write(join(f.directory,'odoo18-result.json'),f.proof);} ],
  ['different candidate18',f=>{f.proof.candidateManifestSha256='0'.repeat(64);write(join(f.directory,'odoo18-result.json'),f.proof);} ],
  ['different18 lock',f=>{f.proof.consumerLockTemplateSha256='0'.repeat(64);write(join(f.directory,'odoo18-result.json'),f.proof);} ],
  ['unobserved18',f=>{f.proof.output=JSON.stringify({passed:true,observedVersion:'19.0'});write(join(f.directory,'odoo18-result.json'),f.proof);} ],
  ['multiple observation payloads',f=>{f.proof.output+='\n'+JSON.stringify({passed:true,observedVersion:'18.0'});write(join(f.directory,'odoo18-result.json'),f.proof);} ],
  ['incomplete cleanup',f=>{f.proof.allOwnedResourcesAbsent=false;write(join(f.directory,'odoo18-result.json'),f.proof);} ],
  ['unchecked ownership',f=>{const p=join(f.directory,'odoo18-cleanup.json');const c=load(p);c.proof[0].ownerChecked=false;write(p,c);} ],
  ['source mutation',f=>write(join(f.root,'src/index.ts'),'changed')],
])test('candidate refuses '+name,t=>{const f=fixture(t);mutate(f);assert.throws(()=>verifyCandidate(f.directory,{root:f.root,env:f.env}));});

test('relocated frozen consumer keeps every third-party version and integrity; mutation is refused',t=>{
  const f=fixture(t);const original=load(join(f.directory,'installed-package-lock.json'));
  const frozen=frozenConsumer(f.directory);
  assert.equal(frozen.package.dependencies['@godoo-dev/stateman'],'file:'+f.archive);
  assert.deepEqual(frozen.lock.packages['node_modules/debug'],original.packages['node_modules/debug']);
  assert.equal(frozen.lock.packages['node_modules/@godoo-dev/stateman'].integrity,original.packages['node_modules/@godoo-dev/stateman'].integrity);
  write(join(f.directory,'installed-package.json'),{});assert.throws(()=>frozenConsumer(f.directory),/proof changed/);
});

test('absent npm version invokes only the retained archive upload; matching version is a no-op',async t=>{
  const f=fixture(t);const calls=[];
  assert.equal(await promoteCandidate(f,{fetchImpl:async()=>({status:404}),publish:async archive=>calls.push(archive)}),'published');
  assert.deepEqual(calls,[f.archive]);calls.length=0;
  const fetchImpl=async url=>String(url).includes('/-/')?new Response(readFileSync(f.archive)):Response.json({name:f.artifact.package,version:f.artifact.version,dist:{tarball:'https://registry.npmjs.org/@godoo-dev/stateman/-/stateman-0.1.0.tgz'}});
  assert.equal(await promoteCandidate(f,{fetchImpl,publish:()=>calls.push('unexpected')}),'present');assert.equal(calls.length,0);
});

test('collision, foreign archives, unknown auth/server/network status never upload',async t=>{
  const f=fixture(t);let writes=0;
  const metadata=url=>Response.json({name:f.artifact.package,version:f.artifact.version,dist:{tarball:url}});
  const badFetches=[
    async()=>new Response(null,{status:401}),async()=>new Response(null,{status:403}),async()=>new Response(null,{status:500}),
    async()=>{throw new Error('network unavailable');},async()=>metadata('https://example.invalid/archive.tgz'),
    async url=>String(url).includes('/-/')?new Response('collision'):metadata('https://registry.npmjs.org/@godoo-dev/stateman/-/stateman-0.1.0.tgz'),
    async()=>Response.json({error:'invalid metadata'}),
  ];
  for(const fetchImpl of badFetches)await assert.rejects(promoteCandidate(f,{fetchImpl,publish:()=>{writes++;}}));
  assert.equal(writes,0);
});
