import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suppliers, proveSuppliers } from './suppliers.mjs';
import { frozenConsumer } from './consumer.mjs';
import { misPrerequisites } from './mis-prerequisites.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const major=process.argv[2] ? Number(process.argv[2]) : 18;
assert.ok([18,19].includes(major),'Only18 or explicitly qualified19 is supported');
const artifactDir=process.env.GODOO_ARTIFACT_DIR;
assert.ok(artifactDir,'GODOO_ARTIFACT_DIR must identify an already tested package candidate');
const manifestBytes=readFileSync(join(artifactDir,'manifest.json'));
const candidateManifestSha256=createHash('sha256').update(manifestBytes).digest('hex');
const manifest=JSON.parse(manifestBytes.toString('utf8'));
const supplier=suppliers(process.env.GODOO_SUPPLIER_MANIFEST);
assert.deepEqual(supplier?.manifest,manifest.suppliers,'Odoo qualification must use the package-tested supplier candidate');
const artifact=manifest.artifacts.find(item=>item.package==='@godoo-dev/stateman');
assert.ok(artifact,'Missing Stateman candidate');
if(major===19){
  assert.equal(process.env.GODOO_ENABLE_ODOO19,'1','19 requires explicit opt-in');
  const baseline=JSON.parse(readFileSync(join(artifactDir,'odoo18-result.json'),'utf8'));
  assert.equal(baseline.candidateManifestSha256,candidateManifestSha256,'19 requires18 proof for the same complete candidate manifest and supplier inputs');
  assert.equal(baseline.passed,true);assert.equal(baseline.allOwnedResourcesAbsent,true);assert.equal(baseline.artifact.sha256,artifact.sha256,'19 requires18 proof for same artifact');assert.equal(baseline.sourceHead,manifest.sourceHead);
}
const consumerInput=frozenConsumer(artifactDir); // Validate before provisioning.
const image='odoo:'+major+'.0';
const tarball=resolve(artifactDir,artifact.filename);
assert.equal(createHash('sha256').update(readFileSync(tarball)).digest('hex'),artifact.sha256,'Candidate hash mismatch');
const exec=(command,args,options={})=>execFileSync(command,args,{encoding:'utf8',timeout:600_000,...options}).trim();
assert.equal(manifest.sourceHead,exec('git',['rev-parse','HEAD'],{cwd:root}),'Candidate source revision mismatch');
assert.equal(artifact.version,JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version,'Candidate version mismatch');
exec('docker',['info','--format','{{.ServerVersion}}']); // A required lane never skips missing Docker.
const owner='stateman-ci-'+randomUUID().slice(0,12), network=owner+'-net', pg=owner+'-pg', odoo=owner+'-odoo';
const volumes=[owner+'-pgdata',owner+'-odoodata'];
const consumer=mkdtempSync(join(tmpdir(),'stateman-odoo18-installed-'));
const created={containers:[],volumes:[],network:false};
const labels=['--label','godoo.ci.owner='+owner];
try {
  const misInputs = major === 18 ? await misPrerequisites(consumer) : undefined;
  if (misInputs) writeFileSync(join(artifactDir,'mis-prerequisites.json'),JSON.stringify(misInputs.proof,null,2)+'\n');
  for(const candidateImage of ['postgres:15-alpine',image])exec('docker',['pull',candidateImage]);
  const images=Object.fromEntries(['postgres:15-alpine',image].map(image=>[image,JSON.parse(exec('docker',['image','inspect',image,'--format','{{json .RepoDigests}}']))]));
  exec('docker',['network','create',...labels,network]);created.network=true;
  for(const volume of volumes){exec('docker',['volume','create',...labels,volume]);created.volumes.push(volume);}
  exec('docker',['run','-d','--name',pg,...labels,'--network',network,'-e','POSTGRES_USER=odoo','-e','POSTGRES_PASSWORD=odoo','-e','POSTGRES_DB=postgres','-v',volumes[0]+':/var/lib/postgresql/data','postgres:15-alpine']);created.containers.push(pg);
  const deadline=Date.now()+60_000;
  while(true){try{exec('docker',['exec',pg,'pg_isready','-U','odoo','-d','postgres'],{stdio:'pipe'});break;}catch(error){if(Date.now()>deadline)throw error;await new Promise(resolve=>setTimeout(resolve,500));}}
  const common=['--name',odoo,...labels,'--network',network,'-e','HOST='+pg,'-e','USER=odoo','-e','PASSWORD=odoo','-v',volumes[1]+':/var/lib/odoo',...(misInputs ? ['-v',misInputs.addons+':/mnt/extra-addons:ro','-v',misInputs.wheel+':/tmp/'+misInputs.wheel.split('/').at(-1)+':ro'] : [])];
  exec('docker',['run','-d',...common,image,'odoo','-d','stateman_ci','-i','base','--without-demo=all','--stop-after-init','--max-cron-threads=0']);created.containers.push(odoo);
  const status=exec('docker',['wait',odoo]);
  if(status!=='0'){console.error(exec('docker',['logs',odoo]));throw new Error('Owned Odoo initialization failed '+status);}
  exec('docker',['rm',odoo]);created.containers.pop();
  exec('docker',['run','-d',...common,'-p','127.0.0.1::8069',image,'odoo','-d','stateman_ci','--max-cron-threads=0','--workers=0']);created.containers.push(odoo);
  if (misInputs) exec('docker',['exec','-u','root',odoo,'pip3','install','--no-deps','--break-system-packages','/tmp/'+misInputs.wheel.split('/').at(-1)]);
  const ports=JSON.parse(exec('docker',['inspect',odoo,'--format','{{json (index .NetworkSettings.Ports "8069/tcp")}}']));
  assert.equal(ports[0].HostIp,'127.0.0.1');const url='http://127.0.0.1:'+ports[0].HostPort;
  const readyDeadline=Date.now()+180_000;
  while(true){try{const response=await fetch(url+'/web/login',{signal:AbortSignal.timeout(2000)});if(response.ok)break;}catch{}if(Date.now()>readyDeadline)throw new Error('Owned Odoo readiness timed out');await new Promise(resolve=>setTimeout(resolve,500));}
  writeFileSync(join(consumer,'package.json'),JSON.stringify(consumerInput.package));
  writeFileSync(join(consumer,'package-lock.json'),JSON.stringify(consumerInput.lock));
  console.log(exec('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:consumer}));
  if(supplier)writeFileSync(join(artifactDir,'odoo'+major+'-installed-suppliers.json'),JSON.stringify(proveSuppliers(supplier,consumer),null,2)+'\n');
  copyFileSync(join(root,'tests/odoo18.mjs'),join(consumer,'live.mjs'));
  copyFileSync(join(root,'tests/scoped-odoo.mjs'),join(consumer,'scoped-odoo.mjs'));
  copyFileSync(join(root,'tests/mis-odoo.mjs'),join(consumer,'mis-odoo.mjs'));
  writeFileSync(join(consumer,'target.json'),JSON.stringify({url,database:'stateman_ci',major}));
  if(supplier)writeFileSync(join(consumer,'suppliers.json'),JSON.stringify(supplier.manifest));
  const output=exec(process.execPath,['live.mjs'],{cwd:consumer});console.log(output);
  if (misInputs) for (const name of ['mis-matrices.json', 'mis-example.pdf', 'mis-example.xlsx']) copyFileSync(join(consumer,name),join(artifactDir,name));
  writeFileSync(join(artifactDir,'odoo'+major+'-result.json'),JSON.stringify({passed:true,workflow:process.env.GITHUB_ACTIONS==='true'?{runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT}:undefined,candidateManifestSha256,consumerLockTemplateSha256:manifest.proofHashes['installed-package-lock.json'],owner,images,sourceHead:manifest.sourceHead,artifact,output,node:process.version,schedulerDisabled:true,url,cleanupPending:true},null,2)+'\n');
} finally {
  const proof=[];
  for(const name of [...created.containers].reverse()){
    const label=exec('docker',['inspect',name,'--format','{{index .Config.Labels "godoo.ci.owner"}}']);assert.equal(label,owner);
    if(name===odoo){try{writeFileSync(join(artifactDir,'odoo'+major+'-container.log'),exec('docker',['logs',name],{stdio:['ignore','pipe','pipe']}));}catch{}}
    exec('docker',['rm','-f',name]);proof.push({type:'container',name,ownerChecked:true});
  }
  if(created.network){assert.equal(exec('docker',['network','inspect',network,'--format','{{index .Labels "godoo.ci.owner"}}']),owner);exec('docker',['network','rm',network]);proof.push({type:'network',name:network,ownerChecked:true});}
  for(const volume of created.volumes){assert.equal(exec('docker',['volume','inspect',volume,'--format','{{index .Labels "godoo.ci.owner"}}']),owner);exec('docker',['volume','rm',volume]);proof.push({type:'volume',name:volume,ownerChecked:true});}
  for(const item of proof){let absent=false;try{exec('docker',[...(item.type==='container'?['inspect']: [item.type,'inspect']),item.name],{stdio:'pipe'});}catch{absent=true;}assert.ok(absent,'Owned resource remains '+item.name);item.absent=true;}
  writeFileSync(join(artifactDir,'odoo'+major+'-cleanup.json'),JSON.stringify({owner,proof,allAbsent:proof.length===5&&proof.every(item=>item.absent)},null,2)+'\n');
  try{const path=join(artifactDir,'odoo'+major+'-result.json');const result=JSON.parse(readFileSync(path,'utf8'));result.cleanupPending=false;result.allOwnedResourcesAbsent=proof.length===5&&proof.every(item=>item.absent);writeFileSync(path,JSON.stringify(result,null,2)+'\n');}catch{}
  rmSync(consumer,{recursive:true,force:true});
}
