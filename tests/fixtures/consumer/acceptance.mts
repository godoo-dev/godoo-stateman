import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { apply, children, drift, loadResources, plan, resource, normalizeResources, createSchemaContext } from '@godoo-dev/stateman';
import type { Inspection, ResourceDefinition } from '@godoo-dev/stateman';

const root = import.meta.dirname;
const inspection: Inspection = await loadResources(resolve(root, 'resources'));
assert.equal(inspection.kind, 'offline-inspection');
assert.equal(inspection.resources.length, 10);
const byId = Object.fromEntries(inspection.resources.map(resource => [resource.externalId, resource]));
assert.deepEqual(byId['bgbl.example_cron'].values.ir_actions_server_id, { __type: 'resourceRef', externalId: 'bgbl.example_cron.action' });
const prelude = readFileSync(resolve(root, 'resources/helpers/prelude.py'), 'utf8');
const body = readFileSync(resolve(root, 'resources/action.py'), 'utf8');
assert.equal(byId['bgbl.example_cron.action'].values.code, prelude + '\n' + body);
assert.equal(byId['bgbl.example_guide_es'].values.content, '<h1>Example guide</h1>\n<p>Use <strong>reviewed configuration</strong>.</p>');
assert.deepEqual(byId['bgbl.example_project.ready'].parentScope, { parentExternalId: 'bgbl.example_project', inverseField: 'project_ids' });
assert.equal(byId['bgbl.example_guide_es'].values.content, byId['bgbl.example_guide_en'].values.content);
const definitions: ResourceDefinition[] = [resource('x', 'fixture.x', { name: 'Example' })];
assert.equal(normalizeResources(definitions)[0].externalId, 'fixture.x');
assert.equal(typeof createSchemaContext, 'function');
assert.equal(typeof plan, 'function'); assert.equal(typeof apply, 'function'); assert.equal(typeof drift, 'function');

const packageRoot = resolve(dirname(fileURLToPath(import.meta.resolve('@godoo-dev/stateman'))), '..');
const bin = resolve(packageRoot, 'bin/stateman.js');
const cli = JSON.parse(execFileSync(process.execPath, [bin, 'inspect', resolve(root, 'resources')], { encoding: 'utf8' })) as Inspection;
assert.deepEqual(cli, inspection);
const loaded = JSON.parse(execFileSync(process.execPath, [bin, 'load', resolve(root, 'resources/project.ts')], { encoding: 'utf8' })) as Inspection;
assert.deepEqual(loaded.resources.map(r => r.externalId), ['bgbl.example_project', 'bgbl.example_project.done', 'bgbl.example_project.ready']);
assert.match(execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' }), /trusted TypeScript/);
writeFileSync(resolve(root, 'must-not-execute.ts'), "throw new Error('POISON_MODULE_EXECUTED');\n");
for (const command of ['plan', 'apply', 'drift', 'verify', 'snapshot', 'export', 'import']) {
  const failed = spawnSync(process.execPath, [bin, command, resolve(root, 'must-not-execute.ts')], { encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /CONNECTION_REQUIRED|USAGE/);
  assert.doesNotMatch(failed.stderr, /POISON_MODULE_EXECUTED/);
  assert.equal(failed.stdout, '');
}
assert.equal(spawnSync(process.execPath, [bin, 'inspect', resolve(root, 'missing')]).status, 1);
assert.equal(existsSync(resolve(root, 'node_modules/@godoo-dev/testcontainers')), false);
assert.equal(existsSync(resolve(packageRoot, 'src/inspect.ts')), true);
const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
assert.equal(manifest.dependencies['@godoo-dev/client'], '0.6.1');
assert.equal(manifest.dependencies['@godoo-dev/introspection'], '0.2.2');
assert.equal(manifest.dependencies['@godoo-dev/testcontainers'], undefined);
for (const [variant, childId] of [['local', 'ready'], ['qualified', 'fixture.ready']]) {
  const expectedId = childId.includes('.') ? childId : 'fixture.project.ready';
  const ready = resource('stage', childId, { name: 'Ready' });
  const project = resource('project', 'fixture.project', { stages: children('stage', 'project_ids', [ready]), default_stage_id: ready });
  const task = resource('task', 'fixture.task', { stage_id: ready, stages: [ready] });
  const first = normalizeResources([task, ready, project, ready]);
  const second = normalizeResources([project, ready, task, ready]);
  assert.deepEqual(first, second);
  assert.equal(first.length, 3);
  const byId = Object.fromEntries(first.map(r => [r.externalId, r]));
  assert.deepEqual(byId['fixture.task'].values.stage_id, { __type: 'resourceRef', externalId: expectedId });
  assert.deepEqual(byId['fixture.project'].values.default_stage_id, { __type: 'resourceRef', externalId: expectedId });
  assert.deepEqual(byId[expectedId].parentScope, { parentExternalId: 'fixture.project', inverseField: 'project_ids' });
  assert.throws(() => normalizeResources([project, resource('stage', expectedId, {})]), /Duplicate resource identity/);
  const input = resolve(root, 'shared-identity', variant);
  const api = await loadResources(input);
  const cli = JSON.parse(execFileSync(process.execPath, [bin, 'inspect', input], { encoding: 'utf8' })) as Inspection;
  assert.deepEqual(cli, api);
  assert.deepEqual(api.resources, first);
}
console.log('PASS: fresh tarball offline API/CLI, representative resources, canonical children, Markdown/Python payloads, explicit connection boundary, source/rights packaging, runtime-only dependencies');
