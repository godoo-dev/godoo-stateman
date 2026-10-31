import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { hash, promoteCandidate, requireReleaseSource, verifyCandidate } from './release.mjs';
import { frozenConsumer } from './consumer.mjs';
import { fixture, load, write } from './release-fixture.mjs';

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
