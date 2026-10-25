import { expect, it } from 'vitest';
import { apply, children, plan, ref, resource } from '../src/index.js';
import { FakeClient } from './fake-client.js';

for (const shape of ['short', 'long', 'diamond'] as const) {
  it.each([true, false])(`waits through unchanged ${shape} prerequisites when a deferred link fails (stopOnError=%s)`, async stopOnError => {
    const client = new FakeClient();
    const tag = client.seed('x', { name: 'Tag' });
    client.seed('x', { name: 'Prerequisite' }, 'review.c_prerequisite');
    client.seed('x', { name: 'Bridge' }, 'review.b_bridge');
    client.seed('x', { name: 'Middle' }, 'review.b_middle');
    const dependent = client.seed('x', { name: 'Before' }, 'review.a_dependent');
    const independent = client.seed('x', { name: 'Before' }, 'review.z_independent');
    const throughMiddle = shape !== 'short';
    const definitions = [
      resource('x', 'review.c_prerequisite', { items: [tag] }),
      resource('x', 'review.b_middle', { name: 'Middle' }, { dependsOn: ['review.c_prerequisite'] }),
      resource('x', 'review.b_bridge', { name: 'Bridge' }, { dependsOn: [throughMiddle ? 'review.b_middle' : 'review.c_prerequisite'] }),
      resource('x', 'review.a_dependent', { name: 'After' }, { dependsOn: shape === 'diamond' ? ['review.b_bridge', 'review.b_middle'] : ['review.b_bridge'] }),
      resource('x', 'review.z_independent', { name: 'After' }),
    ];
    const reviewed = await plan(definitions, client.connection());
    expect(reviewed.operations.some(op => op.externalId.startsWith('review.b_'))).toBe(false);
    client.failure = (_method, _model, values) => values?.items ? new Error('relation refused') : undefined;
    const result = await apply(reviewed, client.connection(), { stopOnError });
    expect(result.ok).toBe(false);
    expect(result.results.find(r => r.operation.externalId === 'review.c_prerequisite')?.status).toBe('failed');
    expect(result.results.find(r => r.operation.externalId === 'review.a_dependent')?.status).toBe('skipped');
    expect(client.data.x.find(row => row.id === dependent)?.name).toBe('Before');
    expect(client.data.x.find(row => row.id === independent)?.name).toBe(stopOnError ? 'Before' : 'After');
  });
}

it('propagates readiness through an unchanged many2one reference', async () => {
  const client = new FakeClient();
  const tag = client.seed('x', { name: 'Tag' });
  const prerequisite = client.seed('x', {}, 'review.c_prerequisite');
  const bridge = client.seed('x', { parent_id: prerequisite }, 'review.b_bridge');
  const dependent = client.seed('x', { parent_id: bridge, name: 'Before' }, 'review.a_dependent');
  const definitions = [
    resource('x', 'review.c_prerequisite', { items: [tag] }),
    resource('x', 'review.b_bridge', { parent_id: ref('review.c_prerequisite') }),
    resource('x', 'review.a_dependent', { parent_id: ref('review.b_bridge'), name: 'After' }),
  ];
  const reviewed = await plan(definitions, client.connection());
  client.failure = (_method, _model, values) => values?.items ? new Error('relation refused') : undefined;
  const result = await apply(reviewed, client.connection(), { stopOnError: false });
  expect(result.results.find(r => r.operation.externalId === 'review.a_dependent')?.status).toBe('skipped');
  expect(client.data.x.find(row => row.id === dependent)?.name).toBe('Before');
});

it('converges a diamond of unchanged prerequisites before updating the dependent', async () => {
  const client = new FakeClient();
  const tag = client.seed('x', {});
  client.seed('x', {}, 'review.c_prerequisite');
  client.seed('x', {}, 'review.b_left');
  client.seed('x', {}, 'review.b_right');
  client.seed('x', { name: 'Before' }, 'review.a_dependent');
  const definitions = [
    resource('x', 'review.c_prerequisite', { items: [tag] }),
    resource('x', 'review.b_left', {}, { dependsOn: ['review.c_prerequisite'] }),
    resource('x', 'review.b_right', {}, { dependsOn: ['review.c_prerequisite'] }),
    resource('x', 'review.a_dependent', { name: 'After' }, { dependsOn: ['review.b_left', 'review.b_right'] }),
  ];
  const result = await apply(await plan(definitions, client.connection()), client.connection());
  expect(result.ok).toBe(true);
  expect(client.mutations.map(mutation => Object.keys(mutation.values ?? {}))).toEqual([['items'], ['name']]);
  expect((await plan(definitions, client.connection())).operations).toEqual([]);
});

it.each([false, true])('keeps child inverse identity separate from explicit parent readiness (explicit=%s)', async explicit => {
  const client = new FakeClient();
  const parent = client.seed('x', { name: 'Before' }, 'review.z_parent');
  const child = client.seed('x', { name: 'Child', parent_id: parent }, 'review.z_parent.child');
  client.assign('x', parent, { items: [[4, child, 0]] });
  const dependent = client.seed('x', { name: 'Before' }, 'review.a_dependent');
  const definitions = [
    resource('x', 'review.z_parent', {
      name: 'Refused',
      items: children('x', 'parent_id', [resource('x', 'child', { name: 'Child' }, explicit ? { dependsOn: ['review.z_parent'] } : {})]),
    }),
    resource('x', 'review.a_dependent', { name: 'After' }, { dependsOn: ['review.z_parent.child'] }),
  ];
  const reviewed = await plan(definitions, client.connection());
  expect(reviewed.operations.some(op => op.externalId === 'review.z_parent.child')).toBe(false);
  client.failure = (_method, _model, values) => values?.name === 'Refused' ? new Error('parent update refused') : undefined;
  const result = await apply(reviewed, client.connection(), { stopOnError: false });
  expect(result.results.find(r => r.operation.externalId === 'review.z_parent')?.status).toBe('failed');
  expect(result.results.find(r => r.operation.externalId === 'review.a_dependent')?.status).toBe(explicit ? 'skipped' : 'committed');
  expect(client.data.x.find(row => row.id === dependent)?.name).toBe(explicit ? 'Before' : 'After');
});

it('skips a child update when its transitive prerequisite fails without cycling through its unchanged parent', async () => {
  const client = new FakeClient();
  const parent = client.seed('x', {}, 'review.parent');
  const child = client.seed('x', { name: 'Before', parent_id: parent }, 'review.parent.child');
  client.assign('x', parent, { items: [[4, child, 0]] });
  const tag = client.seed('x', {});
  client.seed('x', {}, 'review.z_prerequisite');
  client.seed('x', {}, 'review.bridge');
  const definitions = [
    resource('x', 'review.parent', {
      items: children('x', 'parent_id', [resource('x', 'child', { name: 'After' }, { dependsOn: ['review.bridge'] })]),
    }),
    resource('x', 'review.bridge', {}, { dependsOn: ['review.z_prerequisite'] }),
    resource('x', 'review.z_prerequisite', { items: [tag] }),
  ];
  const reviewed = await plan(definitions, client.connection());
  expect(reviewed.operations.some(op => op.externalId === 'review.parent')).toBe(false);
  client.failure = (_method, _model, values) => values?.items ? new Error('relation refused') : undefined;
  const result = await apply(reviewed, client.connection(), { stopOnError: false });
  expect(result.results.find(r => r.operation.externalId === 'review.z_prerequisite')?.status).toBe('failed');
  expect(result.results.find(r => r.operation.externalId === 'review.parent.child')?.status).toBe('skipped');
  expect(client.data.x.find(row => row.id === child)?.name).toBe('Before');
});

it.each([false, true])('rejects full readiness through an unchanged child when it would require its own parent link (bridge=%s)', async bridge => {
  const client = new FakeClient();
  const parent = client.seed('x', {}, 'review.parent');
  client.seed('x', { name: 'Child', parent_id: parent }, 'review.parent.child');
  client.seed('x', {}, 'review.bridge');
  const definitions = [
    resource('x', 'review.parent', {
      items: children('x', 'parent_id', [resource('x', 'child', { name: 'Child' }, { dependsOn: [bridge ? 'review.bridge' : 'review.parent'] })]),
    }),
    resource('x', 'review.bridge', {}, { dependsOn: ['review.parent'] }),
  ];
  await expect(plan(definitions, client.connection())).rejects.toMatchObject({ code: 'RESOURCE_CYCLE' });
  expect(client.mutations).toEqual([]);
});
