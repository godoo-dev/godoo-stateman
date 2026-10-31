import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { hash } from './release.mjs';

export const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value)); };
export const load = path => JSON.parse(readFileSync(path, 'utf8'));
export function fixture(t) {
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

