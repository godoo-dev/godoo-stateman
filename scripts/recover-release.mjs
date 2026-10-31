import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hash, promoteCandidate, requireReleaseSource, verifyCandidate } from './release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const repository = 'godoo-dev/godoo-stateman';
const workflowPath = '.github/workflows/release.yml';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const gh = path => execFileSync('gh', ['api', `repos/${repository}/${path}`], { maxBuffer: 64 * 1024 * 1024 });

export function parseRecovery(input) {
  const request = JSON.parse(input);
  assert.deepEqual(Object.keys(request).sort(), ['source', 'runId', 'attempt', 'packageArtifactId', 'odooArtifactId', 'archiveSha256', 'manifestSha256'].sort(), 'Exact recovery inputs required');
  assert.match(request.source, /^[a-f0-9]{40}$/, 'Full original source SHA required');
  for (const name of ['runId', 'attempt', 'packageArtifactId', 'odooArtifactId']) {
    assert.equal(typeof request[name], 'string', `${name} must be a decimal string`);
    assert.match(request[name], /^[1-9][0-9]*$/, `Invalid ${name}`);
    assert(Number.isSafeInteger(Number(request[name])), `Unsafe ${name}`);
  }
  assert.notEqual(request.packageArtifactId, request.odooArtifactId, 'Distinct artifacts required');
  for (const name of ['archiveSha256', 'manifestSha256']) assert.match(request[name], /^[a-f0-9]{64}$/, `Invalid ${name}`);
  return request;
}

export function requireRecoveryWorkflow(env) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Recovery requires native GitHub Actions');
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.equal(env.GITHUB_REF, 'refs/heads/main');
  assert.equal(env.GITHUB_WORKFLOW_REF, `${repository}/${workflowPath}@refs/heads/main`, 'Unexpected recovery workflow');
  assert.equal(env.GITHUB_WORKFLOW_SHA, env.GITHUB_SHA, 'Recovery workflow source mismatch');
  assert.match(env.GITHUB_SHA, /^[a-f0-9]{40}$/);
  for (const name of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) assert.match(env[name], /^[1-9][0-9]*$/);
}

function checkRun(run, { runId, attempt, source }, workflowId) {
  assert.equal(String(run.id), runId, 'Run identity mismatch');
  assert.equal(String(run.run_attempt), attempt, 'Run attempt mismatch');
  assert.equal(run.head_sha, source, 'Run source mismatch');
  assert.equal(run.path, workflowPath, 'Run workflow mismatch');
  assert.equal(run.event, 'workflow_dispatch');
  assert.equal(run.head_branch, 'main');
  assert.equal(run.repository?.full_name, repository);
  assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.repository.id, run.head_repository.id);
  assert.equal(run.workflow_id, workflowId, 'Workflow identity mismatch');
}

export function validateRecoveryEvidence(request, { original, current, jobs, artifacts }, env) {
  requireRecoveryWorkflow(env);
  checkRun(current, { runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, source: env.GITHUB_SHA }, original.workflow_id);
  assert.equal(current.status, 'in_progress', 'Recovery run is not active');
  assert.equal(current.conclusion, null);
  assert.notEqual(request.runId, env.GITHUB_RUN_ID, 'Recovery must be a distinct run');
  checkRun(original, request, current.workflow_id);
  assert.equal(original.repository.id, current.repository.id, 'Original repository identity mismatch');
  assert.equal(original.status, 'completed');
  assert.equal(original.conclusion, 'failure', 'Only a failed original publication may recover');
  const required = ['eligibility', 'validation / offline', 'validation / package', 'validation / odoo18 / integration', 'validation / required', 'preflight', 'publish'];
  const selected = {};
  for (const name of required) {
    const matches = jobs.filter(job => job.name === name);
    assert.equal(matches.length, 1, `Missing or ambiguous original job: ${name}`);
    const job = matches[0];
    assert.equal(String(job.run_id), request.runId, 'Job run mismatch');
    assert.equal(String(job.run_attempt), request.attempt, 'Job attempt mismatch');
    assert.equal(job.head_sha, request.source, 'Job source mismatch');
    assert.equal(job.status, 'completed');
    assert.equal(job.conclusion, name === 'publish' ? 'failure' : 'success', `Original job did not qualify: ${name}`);
    selected[name] = job;
  }
  return [
    ['packageArtifactId', 'stateman-candidate-', selected['validation / package']],
    ['odooArtifactId', 'stateman-odoo18-', selected['validation / odoo18 / integration']],
  ].map(([key, prefix, job]) => {
    const artifact = artifacts[key];
    assert.equal(String(artifact.id), request[key], 'Artifact identity mismatch');
    assert.equal(artifact.name, prefix + request.source, 'Artifact name mismatch');
    assert.equal(artifact.expired, false, 'Original artifact expired');
    assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/, 'Immutable artifact digest required');
    const run = artifact.workflow_run;
    assert.equal(String(run?.id), request.runId, 'Artifact run mismatch');
    assert.equal(run.head_sha, request.source, 'Artifact source mismatch');
    assert.equal(run.head_branch, 'main');
    assert.equal(run.repository_id, original.repository.id);
    assert.equal(run.head_repository_id, original.repository.id);
    // Artifact metadata has no attempt field. Its creation must fall within this
    // exact attempt's successful producer job, in addition to the manifest binding.
    const created = Date.parse(artifact.created_at);
    assert(Number.isFinite(created) && created >= Date.parse(job.started_at) && created <= Date.parse(job.completed_at), 'Artifact was not created by the selected attempt');
    return artifact;
  });
}

export async function githubRecoveryEvidence(request, env, api = async path => JSON.parse(gh(path))) {
  const original = await api(`actions/runs/${request.runId}/attempts/${request.attempt}`);
  const current = await api(`actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`);
  const jobs = [];
  for (let page = 1; ; page++) {
    const result = await api(`actions/runs/${request.runId}/attempts/${request.attempt}/jobs?per_page=100&page=${page}`);
    assert(Array.isArray(result.jobs));
    assert(Number.isSafeInteger(result.total_count) && result.total_count >= 0, 'Incomplete GitHub job count');
    jobs.push(...result.jobs);
    if (jobs.length >= result.total_count) break;
    assert(result.jobs.length > 0, 'Incomplete GitHub jobs response');
  }
  const artifacts = {};
  for (const key of ['packageArtifactId', 'odooArtifactId']) artifacts[key] = await api(`actions/artifacts/${request[key]}`);
  const evidence = { original, current, jobs, artifacts };
  validateRecoveryEvidence(request, evidence, env);
  return evidence;
}

export function unpackArtifact(bytes, artifact, destination, kind) {
  assert.equal('sha256:' + sha256(bytes), artifact.digest, 'Downloaded GitHub artifact digest mismatch');
  const scratch = mkdtempSync(join(tmpdir(), 'stateman-recovery-zip-'));
  try {
    const zip = join(scratch, 'artifact.zip');
    writeFileSync(zip, bytes);
    const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
    const allowed = kind === 'package'
      ? /^(manifest\.json|installed-(files|package|package-lock|dependency-tree)\.json|godoo-dev-stateman-[0-9][a-zA-Z0-9.+-]*\.tgz)$/
      : /^(odoo18-(result|cleanup)\.json|odoo18-container\.log|mis-(prerequisites|matrices)\.json|mis-example\.(pdf|xlsx))$/;
    assert.equal(new Set(names).size, names.length, 'Duplicate artifact paths');
    assert(names.every(name => allowed.test(name)), 'Unexpected artifact contents');
    mkdirSync(destination, { recursive: true });
    // Extract bytes by approved flat name, never ZIP-supplied filesystem types/paths.
    for (const name of names) writeFileSync(join(destination, name), execFileSync('unzip', ['-p', zip, name], { maxBuffer: 64 * 1024 * 1024 }), { flag: 'wx' });
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

export function verifyRecoveryCandidate(directory, request, { sourceRoot, publisherRoot = root, env = process.env } = {}) {
  requireRecoveryWorkflow(env);
  assert(typeof sourceRoot === 'string' && isAbsolute(sourceRoot), 'Explicit original source checkout required');
  assert.equal(git(publisherRoot, 'rev-parse', 'HEAD'), env.GITHUB_SHA, 'Recovery checkout source mismatch');
  assert.equal(git(publisherRoot, 'status', '--porcelain'), '', 'Recovery checkout must be clean');
  git(publisherRoot, 'merge-base', '--is-ancestor', request.source, env.GITHUB_SHA);
  assert.equal(hash(join(directory, 'manifest.json')), request.manifestSha256, 'Original manifest hash mismatch');
  const candidate = verifyCandidate(directory, { root: sourceRoot, env: {
    ...env, GITHUB_SHA: request.source, GITHUB_RUN_ID: request.runId, GITHUB_RUN_ATTEMPT: request.attempt,
  } });
  assert.equal(candidate.artifact.sha256, request.archiveSha256, 'Original archive hash mismatch');
  return candidate;
}

export async function recoverCandidate(request, { directory, sourceRoot, publisherRoot = root, env = process.env, api, download = async artifact => gh(`actions/artifacts/${artifact.id}/zip`), guard = () => requireReleaseSource(publisherRoot, env), fetchImpl, publish } = {}) {
  request = parseRecovery(JSON.stringify(request));
  requireRecoveryWorkflow(env);
  guard();
  const evidence = await githubRecoveryEvidence(request, env, api);
  const artifacts = [evidence.artifacts.packageArtifactId, evidence.artifacts.odooArtifactId];
  // Each invocation uses a fresh destination. No retained/operator-supplied proof
  // can override either immutable GitHub download.
  mkdirSync(directory, { recursive: false });
  for (let i = 0; i < artifacts.length; i++) unpackArtifact(await download(artifacts[i]), artifacts[i], directory, i === 0 ? 'package' : 'odoo');
  const candidate = verifyRecoveryCandidate(directory, request, { sourceRoot, publisherRoot, env });
  const receipt = {
    original: { ...request, artifacts: artifacts.map(({ id, digest }) => ({ id, digest })) },
    recovery: { source: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, workflow: env.GITHUB_WORKFLOW_REF },
    artifact: candidate.artifact,
  };
  if (publish) {
    assert.equal(env.GODOO_PUBLISH, 'true', 'Explicit recovery publication required');
    guard();
    receipt.result = await promoteCandidate(candidate, { fetchImpl, publish });
  } else receipt.result = 'verified';
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  assert(['guard', 'verify', 'publish'].includes(mode) && process.argv.length === 3, 'Usage: node scripts/recover-release.mjs guard|verify|publish');
  const request = parseRecovery(process.env.GODOO_RECOVERY);
  requireRecoveryWorkflow(process.env);
  if (mode === 'guard') requireReleaseSource();
  else {
    const area = mkdtempSync(join(tmpdir(), 'stateman-recovery-'));
    try {
      const receipt = await recoverCandidate(request, {
        directory: join(area, 'candidate'), sourceRoot: process.env.GODOO_RECOVERY_SOURCE_DIR,
        ...(mode === 'publish' ? { publish: archive => execFileSync('npm', ['publish', archive, '--ignore-scripts', '--access', 'public', '--registry', 'https://registry.npmjs.org', '--provenance'], { stdio: 'inherit' }) } : {}),
      });
      console.log(JSON.stringify(receipt));
      if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, '```json\n' + JSON.stringify(receipt, null, 2) + '\n```\n', { flag: 'a' });
    } finally { rmSync(area, { recursive: true, force: true }); }
  }
}
