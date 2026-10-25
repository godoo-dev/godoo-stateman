import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const npmRegistry = 'https://registry.npmjs.org';
export const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

export function requireReleaseSource(root = defaultRoot, env = process.env) {
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'Manual Release dispatch required');
  assert.equal(env.GITHUB_REF, 'refs/heads/develop', 'Release must run from existing develop');
  assert.equal(env.GITHUB_REPOSITORY, 'godoo-dev/godoo-stateman', 'Unexpected release repository');
  assert.equal(git(root, 'status', '--porcelain'), '', 'Release source must be clean');
  const sha = git(root, 'rev-parse', 'HEAD');
  const remote = env.GITHUB_ACTIONS === 'true'
    ? execFileSync('gh', ['api', 'repos/godoo-dev/godoo-stateman/git/ref/heads/develop', '--jq', '.object.sha'], { encoding: 'utf8', env }).trim()
    : git(root, 'ls-remote', '--exit-code', 'origin', 'refs/heads/develop').split(/\s+/)[0];
  if (env.GITHUB_ACTIONS === 'true') assert.equal(sha, env.GITHUB_SHA, 'Workflow source changed');
  assert.equal(remote, sha, 'Release source is no longer the remote develop head');
  return sha;
}

export function verifyCandidate(directory, { root = defaultRoot, complete = true, env = process.env } = {}) {
  assert(directory, 'GODOO_ARTIFACT_DIR is required');
  const manifestPath = join(directory, 'manifest.json');
  const manifest = json(manifestPath);
  const source = json(join(root, 'package.json'));
  assert.equal(source.name, '@godoo-dev/stateman');
  assert.notEqual(source.private, true, 'Public package metadata required');
  assert.deepEqual(source.publishConfig, { access: 'public', registry: npmRegistry });
  assert.equal(source.license, 'LGPL-3.0-only');
  assert.equal(manifest.sourceHead, git(root, 'rev-parse', 'HEAD'), 'Candidate source mismatch');
  assert.equal(git(root, 'status', '--porcelain'), '', 'Source changed after qualification');
  assert.equal(manifest.dirtyState, '', 'Candidate was packed from dirty source');
  if (env.GITHUB_ACTIONS === 'true') {
    assert.equal(manifest.sourceHead, env.GITHUB_SHA);
    assert.deepEqual(manifest.workflow, { runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT }, 'Candidate is not from this workflow attempt');
  }
  assert.equal(manifest.lockSha256, hash(join(root, 'package-lock.json')), 'Source lock mismatch');
  assert.equal(manifest.artifacts?.length, 1, 'Exactly one Stateman archive required');
  const artifact = manifest.artifacts[0];
  assert.equal(artifact.package, source.name);
  assert.equal(artifact.version, source.version);
  assert.equal(artifact.filename, basename(artifact.filename), 'Archive filename escapes candidate');
  const archive = realpathSync(join(directory, artifact.filename));
  const child = relative(realpathSync(directory), archive);
  assert(child && !isAbsolute(child) && !child.startsWith('..'), 'Archive escapes candidate');
  assert.equal(hash(archive), artifact.sha256, 'Archive hash mismatch');
  for (const name of ['installed-files.json', 'installed-package.json', 'installed-package-lock.json']) {
    assert.match(manifest.proofHashes?.[name] ?? '', /^[a-f0-9]{64}$/, 'Missing installed proof hash');
    assert.equal(hash(join(directory, name)), manifest.proofHashes[name], 'Installed proof changed');
  }
  const metadata = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }));
  assert.equal(metadata.name, source.name);
  assert.equal(metadata.version, source.version);
  assert.notEqual(metadata.private, true);
  assert.equal(metadata.license, source.license);
  assert.deepEqual(metadata.publishConfig, source.publishConfig);
  const installed = json(join(directory, 'installed-files.json'));
  for (const name of ['LICENSE', 'COPYING', 'NOTICE.md', 'src/index.ts', 'dist/index.js', 'dist/index.d.ts', 'bin/stateman.js']) {
    assert.match(installed[name] ?? '', /^[a-f0-9]{64}$/, `Missing shipped source/rights: ${name}`);
    if (!name.startsWith('dist/')) assert.equal(installed[name], hash(join(root,name)), `Source/rights changed: ${name}`);
  }
  const archiveFiles = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n').filter(name => !name.endsWith('/'));
  assert.deepEqual(archiveFiles.map(name => name.replace(/^package\//, '')).sort(), Object.keys(installed).sort(), 'Installed proof omits shipped files');
  for (const [name, expected] of Object.entries(installed)) {
    assert(!name.startsWith('/') && !name.split('/').includes('..'), 'Unsafe shipped path');
    const bytes = execFileSync('tar', ['-xOf', archive, 'package/' + name]);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `Shipped bytes changed: ${name}`);
  }
  assert.deepEqual(metadata.dependencies, source.dependencies, 'Shipped runtime dependencies changed');
  if (complete) {
    const proof = json(join(directory, 'odoo18-result.json'));
    assert.equal(proof.passed, true, 'Successful18 proof required');
    assert.deepEqual(proof.workflow, manifest.workflow, '18 proof workflow attempt mismatch');
    assert.equal(proof.sourceHead, manifest.sourceHead, '18 proof source mismatch');
    assert.equal(proof.candidateManifestSha256, hash(manifestPath), '18 proof candidate mismatch');
    assert.deepEqual(proof.artifact, artifact, '18 proof archive mismatch');
    assert.equal(proof.consumerLockTemplateSha256, manifest.proofHashes['installed-package-lock.json'], '18 used another consumer lock');
    assert.equal(proof.cleanupPending, false);
    assert.equal(proof.allOwnedResourcesAbsent, true, 'Owned cleanup incomplete');
    const observation = JSON.parse(proof.output);
    assert.equal(observation.passed, true);
    assert.equal(Number(String(observation.observedVersion).split('.')[0]), 18, 'Observed18 required');
    const cleanup = json(join(directory, 'odoo18-cleanup.json'));
    assert.equal(cleanup.owner, proof.owner);
    assert.equal(cleanup.allAbsent, true);
    assert.equal(cleanup.proof?.length, 5);
    assert(cleanup.proof.every(item => item.absent === true && item.ownerChecked === true));
  }
  return { manifest, artifact, archive };
}

export async function promoteCandidate(candidate, { fetchImpl = fetch, publish } = {}) {
  const { artifact, archive } = candidate;
  const response = await fetchImpl(`${npmRegistry}/${encodeURIComponent(artifact.package)}/${encodeURIComponent(artifact.version)}`, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) {
    assert.equal(typeof publish, 'function');
    await publish(archive);
    return 'published';
  }
  assert(response.ok, `Registry lookup unavailable: HTTP ${response.status}`);
  const metadata = await response.json();
  assert.equal(metadata.name, artifact.package);
  assert.equal(metadata.version, artifact.version);
  const url = new URL(metadata.dist.tarball);
  assert.equal(url.origin, npmRegistry, 'Unexpected npm archive origin');
  assert(!url.username && !url.password);
  const remote = await fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  assert(remote.ok, 'Existing npm archive unavailable');
  const observed = createHash('sha256').update(Buffer.from(await remote.arrayBuffer())).digest('hex');
  assert.equal(observed, artifact.sha256, 'Reserved npm version has different bytes');
  return 'present';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  assert(['guard', 'verify', 'publish'].includes(mode), 'Usage: node scripts/release.mjs guard|verify|publish');
  if (mode === 'guard' || mode === 'publish') requireReleaseSource();
  if (mode !== 'guard') {
    const candidate = verifyCandidate(process.env.GODOO_ARTIFACT_DIR);
    if (mode === 'publish') {
      assert.equal(process.env.GODOO_PUBLISH, 'true', 'Explicit publish choice required');
      const result = await promoteCandidate(candidate, {
        publish(archive) {
          execFileSync('npm', ['publish', archive, '--ignore-scripts', '--access', 'public', '--registry', npmRegistry, '--provenance'], { stdio: 'inherit' });
        },
      });
      console.log(JSON.stringify({ result, artifact: candidate.artifact }));
    } else console.log(JSON.stringify({ passed: true, artifact: candidate.artifact }));
  }
}
