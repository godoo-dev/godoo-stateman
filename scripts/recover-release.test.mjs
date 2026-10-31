import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { hash } from './release.mjs';
import { fixture, load, write } from './release-fixture.mjs';
import { parseRecovery, recoverCandidate, unpackArtifact } from './recover-release.mjs';

const repository = 'godoo-dev/godoo-stateman';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function recoveryFixture(t) {
  const f = fixture(t);
  f.manifest.workflow = { runId: '123', attempt: '1' };
  write(join(f.directory, 'manifest.json'), f.manifest);
  f.proof.workflow = f.manifest.workflow;
  f.proof.candidateManifestSha256 = hash(join(f.directory, 'manifest.json'));
  write(join(f.directory, 'odoo18-result.json'), f.proof);
  const publisherRoot = join(dirname(f.root), 'publisher');
  execFileSync('git', ['clone', f.root, publisherRoot], { stdio: 'ignore' });
  const git = (...args) => execFileSync('git', args, { cwd: publisherRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('config', 'user.email', 'control@example.invalid'); git('config', 'user.name', 'Recovery control');
  write(join(publisherRoot, 'recovery.txt'), 'current publisher, distinct original source');
  git('add', '.'); git('commit', '-m', 'recovery tooling');
  const env = { ...f.env, GITHUB_ACTIONS: 'true', GITHUB_SHA: git('rev-parse', 'HEAD'), GITHUB_RUN_ID: '456', GITHUB_RUN_ATTEMPT: '2',
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/release.yml@refs/heads/main`, GODOO_PUBLISH: 'true' };
  env.GITHUB_WORKFLOW_SHA = env.GITHUB_SHA;
  const request = { source: f.manifest.sourceHead, runId: '123', attempt: '1', packageArtifactId: '71', odooArtifactId: '72', archiveSha256: f.artifact.sha256, manifestSha256: hash(join(f.directory, 'manifest.json')) };
  const run = { id: 123, run_attempt: 1, head_sha: request.source, path: '.github/workflows/release.yml', event: 'workflow_dispatch', head_branch: 'main', repository: { id: 99, full_name: repository }, head_repository: { id: 99, full_name: repository }, workflow_id: 77, status: 'completed', conclusion: 'failure' };
  const current = { ...structuredClone(run), id: 456, run_attempt: 2, head_sha: env.GITHUB_SHA, status: 'in_progress', conclusion: null };
  const jobs = ['eligibility', 'validation / offline', 'validation / package', 'validation / odoo18 / integration', 'validation / required', 'preflight', 'publish'].map(name => ({ name, run_id: 123, run_attempt: 1, head_sha: request.source, status: 'completed', conclusion: name === 'publish' ? 'failure' : 'success', started_at: '2026-10-30T20:00:00Z', completed_at: '2026-10-30T20:02:00Z' }));
  const artifacts = {};
  const zips = {};
  function pack() {
    for (const [key, id, prefix, names] of [
      ['packageArtifactId', 71, 'stateman-candidate-', [f.artifact.filename, 'manifest.json', 'installed-files.json', 'installed-package.json', 'installed-package-lock.json']],
      ['odooArtifactId', 72, 'stateman-odoo18-', ['odoo18-result.json', 'odoo18-cleanup.json']],
    ]) {
      const zip = join(dirname(f.root), `${id}.zip`);
      rmSync(zip, { force: true });
      execFileSync('zip', ['-q', zip, ...names], { cwd: f.directory });
      zips[id] = readFileSync(zip);
      artifacts[key] = { id, name: prefix + request.source, expired: false, digest: 'sha256:' + sha256(zips[id]), created_at: '2026-10-30T20:01:00Z', workflow_run: { id: 123, head_sha: request.source, head_branch: 'main', repository_id: 99, head_repository_id: 99 } };
    }
  }
  pack();
  const evidence = { original: run, current, jobs, artifacts };
  const api = async path => {
    if (path === 'actions/runs/123/attempts/1') return run;
    if (path === 'actions/runs/456/attempts/2') return current;
    if (path === 'actions/runs/123/attempts/1/jobs?per_page=100&page=1') return { jobs, total_count: jobs.length };
    if (path === 'actions/artifacts/71') return artifacts.packageArtifactId;
    if (path === 'actions/artifacts/72') return artifacts.odooArtifactId;
    assert.fail('Unexpected GitHub request: ' + path);
  };
  let calls = 0, downloads = 0, lookups = 0;
  const options = () => ({ directory: join(dirname(f.root), 'download-' + calls++), sourceRoot: f.root, publisherRoot, env, api,
    download: async artifact => { downloads++; return zips[artifact.id]; }, guard: () => {},
    fetchImpl: async () => { lookups++; assert.fail('Unexpected registry access'); }, publish: () => assert.fail('Unexpected publish'),
  });
  return { ...f, publisherRoot, env, request, evidence, pack, zips, options, counts: () => ({ downloads, lookups }) };
}

test('strict recovery inputs refuse omitted/extra/unsafe identities', t => {
  const f = recoveryFixture(t);
  assert.deepEqual(parseRecovery(JSON.stringify(f.request)), f.request);
  for (const change of [{ source: 'main' }, { runId: 123 }, { attempt: '0' }, { packageArtifactId: '72' }, { runId: '9007199254740992' }, { archiveSha256: 'bad' }, { manifestSha256: null }, { extra: 'ignored' }])
    assert.throws(() => parseRecovery(JSON.stringify({ ...f.request, ...change })));
  const missing = { ...f.request }; delete missing.odooArtifactId;
  assert.throws(() => parseRecovery(JSON.stringify(missing)));
});

test('same original bytes recover through a distinct current workflow without rebuild or network', async t => {
  const f = recoveryFixture(t);
  let writes = 0;
  const receipt = await recoverCandidate(f.request, { ...f.options(), fetchImpl: async () => new Response(null, { status: 404 }), publish: archive => {
    assert.equal(hash(archive), f.request.archiveSha256);
    assert.deepEqual(readFileSync(archive), readFileSync(f.archive)); writes++;
  } });
  assert.equal(writes, 1);
  assert.equal(receipt.result, 'published');
  assert.equal(receipt.original.source, f.request.source);
  assert.equal(receipt.original.attempt, '1');
  assert.equal(receipt.recovery.source, f.env.GITHUB_SHA);
  assert.equal(receipt.recovery.attempt, '2');
  assert.notEqual(receipt.original.source, receipt.recovery.source);
  const options = f.options(); delete options.publish;
  assert.equal((await recoverCandidate(f.request, options)).result, 'verified');
  assert.equal(writes, 1);
});

for (const [name, mutate] of [
  ['changed original source', f => f.evidence.original.head_sha = '0'.repeat(40)],
  ['wrong original run', f => f.evidence.original.id++],
  ['wrong original attempt', f => f.evidence.original.run_attempt++],
  ['foreign original repository', f => f.evidence.original.head_repository.full_name = 'other/repo'],
  ['nonmanual original', f => f.evidence.original.event = 'push'],
  ['foreign original workflow', f => f.evidence.original.path = '.github/workflows/test.yml'],
  ['unsettled original', f => f.evidence.original.status = 'in_progress'],
  ['successful original', f => f.evidence.original.conclusion = 'success'],
  ['changed recovery source', f => f.evidence.current.head_sha = f.request.source],
  ['changed recovery workflow', f => f.env.GITHUB_WORKFLOW_REF = `${repository}/.github/workflows/other.yml@refs/heads/main`],
  ['changed workflow SHA', f => f.env.GITHUB_WORKFLOW_SHA = f.request.source],
  ['nonmain recovery', f => f.env.GITHUB_REF = 'refs/heads/develop'],
  ['local recovery', f => f.env.GITHUB_ACTIONS = 'false'],
  ['changed workflow id', f => f.evidence.current.workflow_id++],
  ['missing mandatory result', f => f.evidence.jobs.shift()],
  ['duplicate mandatory result', f => f.evidence.jobs.push(f.evidence.jobs[0])],
  ['failed required aggregate', f => f.evidence.jobs.find(j => j.name === 'validation / required').conclusion = 'failure'],
  ['skipped Odoo18', f => f.evidence.jobs.find(j => j.name === 'validation / odoo18 / integration').conclusion = 'skipped'],
  ['job from different attempt', f => f.evidence.jobs[0].run_attempt++],
  ['job from different run', f => f.evidence.jobs[0].run_id++],
  ['job from different source', f => f.evidence.jobs[0].head_sha = '0'.repeat(40)],
  ['wrong artifact id', f => f.evidence.artifacts.packageArtifactId.id++],
  ['wrong artifact name', f => f.evidence.artifacts.odooArtifactId.name = 'other'],
  ['expired artifact', f => f.evidence.artifacts.packageArtifactId.expired = true],
  ['missing immutable digest', f => delete f.evidence.artifacts.packageArtifactId.digest],
  ['artifact from other run', f => f.evidence.artifacts.odooArtifactId.workflow_run.id++],
  ['artifact from other source', f => f.evidence.artifacts.packageArtifactId.workflow_run.head_sha = '0'.repeat(40)],
  ['artifact from other repository', f => f.evidence.artifacts.odooArtifactId.workflow_run.repository_id++],
  ['artifact outside producer attempt', f => f.evidence.artifacts.packageArtifactId.created_at = '2026-10-30T20:03:00Z'],
]) test('recovery refuses ' + name + ' before download or publication', async t => {
  const f = recoveryFixture(t); mutate(f);
  await assert.rejects(recoverCandidate(f.request, f.options()));
  assert.deepEqual(f.counts(), { downloads: 0, lookups: 0 });
});

for (const [name, mutate] of [
  ['archive hash selection', f => f.request.archiveSha256 = '0'.repeat(64)],
  ['manifest hash selection', f => f.request.manifestSha256 = '0'.repeat(64)],
  ['archive bytes', f => write(f.archive, 'changed')],
  ['installed proof', f => write(join(f.directory, 'installed-files.json'), {})],
  ['proof source', f => { f.proof.sourceHead = '0'.repeat(40); write(join(f.directory, 'odoo18-result.json'), f.proof); }],
  ['proof run', f => { f.proof.workflow.runId = '124'; write(join(f.directory, 'odoo18-result.json'), f.proof); }],
  ['proof attempt', f => { f.proof.workflow.attempt = '2'; write(join(f.directory, 'odoo18-result.json'), f.proof); }],
  ['cleanup proof', f => { const path = join(f.directory, 'odoo18-cleanup.json'); const cleanup = load(path); cleanup.proof[0].ownerChecked = false; write(path, cleanup); }],
  ['original checkout', f => write(join(f.root, 'src/index.ts'), 'changed')],
  ['publisher checkout', f => write(join(f.publisherRoot, 'recovery.txt'), 'dirty')],
]) test('recovery refuses changed ' + name + ' even with valid GitHub ZIP digests', async t => {
  const f = recoveryFixture(t); mutate(f); f.pack();
  await assert.rejects(recoverCandidate(f.request, f.options()));
  assert.equal(f.counts().lookups, 0);
});

test('ZIP byte mismatch, traversal and duplicate entries fail closed', t => {
  const f = recoveryFixture(t);
  assert.throws(() => unpackArtifact(Buffer.from('changed'), f.evidence.artifacts.packageArtifactId, join(dirname(f.root), 'bad'), 'package'), /digest/);
  const unsafe = execFileSync('python3', ['-c', "import io,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,'w') as z:z.writestr('../escape','bad')\nsys.stdout.buffer.write(b.getvalue())"]);
  assert.throws(() => unpackArtifact(unsafe, { digest: 'sha256:' + sha256(unsafe) }, join(dirname(f.root), 'unsafe'), 'package'), /contents/);
  const duplicates = execFileSync('python3', ['-W', 'ignore', '-c', "import io,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,'w') as z:\n z.writestr('manifest.json','one')\n z.writestr('manifest.json','two')\nsys.stdout.buffer.write(b.getvalue())"]);
  assert.throws(() => unpackArtifact(duplicates, { digest: 'sha256:' + sha256(duplicates) }, join(dirname(f.root), 'duplicates'), 'package'), /Duplicate/);
});

test('existing matching reservation is a no-op; collisions, unknown states and failed upload never retry', async t => {
  const f = recoveryFixture(t);
  const metadata = () => Response.json({ name: f.artifact.package, version: f.artifact.version, dist: { tarball: 'https://registry.npmjs.org/@godoo-dev/stateman/-/stateman-0.1.0.tgz' } });
  let writes = 0;
  const publish = () => { writes++; throw new Error('uncertain upload'); };
  const fetchImpl = async url => String(url).includes('/-/') ? new Response(readFileSync(f.archive)) : metadata();
  assert.equal((await recoverCandidate(f.request, { ...f.options(), fetchImpl, publish })).result, 'present');
  assert.equal(writes, 0);
  for (const status of [401, 403, 429, 500]) await assert.rejects(recoverCandidate(f.request, { ...f.options(), fetchImpl: async () => new Response(null, { status }), publish }), /Registry lookup unavailable/);
  await assert.rejects(recoverCandidate(f.request, { ...f.options(), fetchImpl: async () => { throw new Error('network unknown'); }, publish }), /network unknown/);
  await assert.rejects(recoverCandidate(f.request, { ...f.options(), fetchImpl: async url => String(url).includes('/-/') ? new Response('collision') : metadata(), publish }), /different bytes/);
  assert.equal(writes, 0);
  await assert.rejects(recoverCandidate(f.request, { ...f.options(), env: { ...f.env, GODOO_PUBLISH: 'false' }, fetchImpl, publish }), /Explicit/);
  await assert.rejects(recoverCandidate(f.request, { ...f.options(), fetchImpl: async () => new Response(null, { status: 404 }), publish }), /uncertain upload/);
  assert.equal(writes, 1);
});


test('current main is guarded before retrieval and again immediately before promotion', async t => {
  const f = recoveryFixture(t);
  await assert.rejects(recoverCandidate(f.request, { ...f.options(), guard: () => { throw new Error('main moved'); } }), /main moved/);
  assert.deepEqual(f.counts(), { downloads: 0, lookups: 0 });
  let guards = 0;
  await assert.rejects(recoverCandidate(f.request, { ...f.options(), guard: () => { if (++guards === 2) throw new Error('main moved after review'); } }), /main moved after review/);
  assert.equal(guards, 2);
  assert.equal(f.counts().lookups, 0);
});

test('workflow requires eligibility, mode-specific validation and preflight before the protected publisher', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const condition = name => new Function('inputs', 'needs', 'always', 'return (' + workflow.match(new RegExp('\\n  ' + name + ':\\n    if: ([^\\n]+)'))[1] + ');');
  const preflight = condition('preflight'), publish = condition('publish');
  for (const recovery of ['', '{"source":"selected"}']) {
    const inputs = { publish: true, recovery };
    const needs = { eligibility: { result: 'success' }, validation: { result: recovery ? 'skipped' : 'success' }, preflight: { result: 'success' } };
    assert.equal(preflight(inputs, needs, () => true), true);
    assert.equal(publish(inputs, needs, () => true), true);
    assert.equal(publish({ ...inputs, publish: false }, needs, () => true), false);
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      const badEligibility = { ...needs, eligibility: { result } };
      assert.equal(preflight(inputs, badEligibility, () => true), false);
      assert.equal(publish(inputs, badEligibility, () => true), false);
      assert.equal(publish(inputs, { ...needs, preflight: { result } }, () => true), false);
    }
    for (const result of ['success', 'skipped', 'failure', 'cancelled', undefined].filter(result => result !== needs.validation.result)) {
      assert.equal(preflight(inputs, { ...needs, validation: { result } }, () => true), false);
      assert.equal(publish(inputs, { ...needs, validation: { result } }, () => true), false);
    }
  }
  assert.match(workflow, /  publish:[\s\S]*?environment: npm-release/);
});


test('missing original checkout, incomplete GitHub evidence and unrelated source never publish', async t => {
  const f = recoveryFixture(t);
  await assert.rejects(recoverCandidate(f.request, { ...f.options(), sourceRoot: undefined }), /Explicit original source/);
  const options = f.options();
  const api = async path => path.includes('/jobs?') ? { jobs: [] } : options.api(path);
  await assert.rejects(recoverCandidate(f.request, { ...options, api }), /job count/);
  await assert.rejects(recoverCandidate(f.request, { ...f.options(), api: async () => { throw new Error('GitHub unavailable'); } }), /GitHub unavailable/);
  // A separately rooted publisher must not authorize an unrelated original source.
  const other = fixture(t);
  other.git('checkout', '--orphan', 'unrelated');
  write(join(other.root, 'unrelated.txt'), 'disjoint source ancestry');
  other.git('add', '.'); other.git('commit', '-m', 'unrelated root');
  other.manifest.sourceHead = other.git('rev-parse', 'HEAD');
  await assert.rejects(recoverCandidate(f.request, { ...f.options(), publisherRoot: other.root, env: { ...f.env, GITHUB_SHA: other.manifest.sourceHead, GITHUB_WORKFLOW_SHA: other.manifest.sourceHead }, api: async path => {
    if (path === 'actions/runs/456/attempts/2') return { ...f.evidence.current, head_sha: other.manifest.sourceHead };
    return f.options().api(path);
  } }));
  assert.equal(f.counts().lookups, 0);
});
