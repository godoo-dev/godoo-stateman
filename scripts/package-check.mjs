import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suppliers, proveSuppliers } from './suppliers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const supplier = suppliers(process.env.GODOO_SUPPLIER_MANIFEST);
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const artifactDir = process.env.GODOO_ARTIFACT_DIR ? realpathSync(process.env.GODOO_ARTIFACT_DIR) : mkdtempSync(join(tmpdir(), 'stateman-candidate-'));
assert.ok(!isAbsolute(relative(root, artifactDir)) && relative(root, artifactDir).startsWith('..'), 'Artifact directory must be outside the checkout');
assert.ok(!existsSync(join(artifactDir, 'manifest.json')), 'Candidate manifest already exists; use a fresh artifact directory');
const pack = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', artifactDir]))[0];
const tarball = join(artifactDir, pack.filename);
const sourceHead = run('git', ['rev-parse', 'HEAD']).trim();
const dirtyState = run('git', ['status', '--short']);
const patchSha256 = createHash('sha256').update(run('git', ['diff', 'HEAD', '--binary'])).digest('hex');
const consumer = mkdtempSync(join(tmpdir(), 'stateman-installed-'));
try {
  const versions = Object.fromEntries(['typescript','@types/node'].map(name => [name, JSON.parse(readFileSync(join(root,'node_modules',name,'package.json'),'utf8')).version]));
  writeFileSync(join(consumer,'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { '@godoo-dev/stateman': `file:${tarball}`, ...supplier?.dependencies }, overrides: supplier?.overrides, devDependencies: versions }, null, 2));
  console.log(run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer));
  if(supplier)writeFileSync(join(artifactDir,'installed-suppliers.json'),JSON.stringify(proveSuppliers(supplier,consumer),null,2)+'\n');
  cpSync(join(root,'tests/fixtures/consumer'), join(consumer,'consumer'), { recursive: true });
  cpSync(join(root,'tests/installed-acceptance.mts'), join(consumer,'installed-acceptance.mts'));
  cpSync(join(root,'tests/fake-client.ts'), join(consumer,'fake-client.ts'));
  for (const name of ['scoped-client.ts', 'scoped-acceptance.ts']) cpSync(join(root,'tests',name), join(consumer,name));
  writeFileSync(join(consumer,'tsconfig.json'), JSON.stringify({compilerOptions:{target:'ES2023',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true,types:['node']},include:['*.ts','*.mts','consumer/**/*.ts','consumer/**/*.mts']}));
  const installed = join(consumer,'node_modules/@godoo-dev/stateman');
  assert.ok(realpathSync(installed).startsWith(realpathSync(consumer) + '/'), 'Package resolved outside isolated consumer');
  const installedHashes = {};
  for (const entry of pack.files) { const file=entry.path; assert.equal(hash(join(installed,file)),hash(join(root,file)),file+' differs in installed candidate'); installedHashes[file]=hash(join(installed,file)); }
  writeFileSync(join(artifactDir,'installed-files.json'),JSON.stringify(installedHashes,null,2)+'\n');
  console.log(run('node', ['node_modules/typescript/bin/tsc'], consumer));
  console.log(run('node', ['--import','tsx','installed-acceptance.mts'], consumer));
  console.log(run('node', ['--import','tsx','consumer/acceptance.mts'], consumer));
  writeFileSync(join(artifactDir,'installed-dependency-tree.json'),run('npm',['ls','--all','--json'],consumer));
  cpSync(join(consumer,'package.json'),join(artifactDir,'installed-package.json'));
  cpSync(join(consumer,'package-lock.json'),join(artifactDir,'installed-package-lock.json'));
  const proofHashes = Object.fromEntries(['installed-files.json','installed-package.json','installed-package-lock.json'].map(name => [name,hash(join(artifactDir,name))]));
  const manifest = {schemaVersion:1,workflow:process.env.GITHUB_ACTIONS==='true'?{runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT}:undefined,proofHashes,sourceHead,dirtyState,patchSha256,lockSha256:hash(join(root,'package-lock.json')),node:process.version,artifacts:[{package:pack.name,version:pack.version,filename:pack.filename,sha256:hash(tarball)}],installedProof:'API/CLI, typed consumer, package rights/source',supplierQualification:!!supplier,suppliers:supplier?.manifest};
  writeFileSync(join(artifactDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({passed:true,artifactDir,manifest}));
} finally { rmSync(consumer,{recursive:true,force:true}); }
