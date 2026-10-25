import { expect, it } from 'vitest';
import { apply, children, plan, resource, translated } from '../src/index.js';
import type { PlanOptions } from '../src/index.js';
import { FakeClient } from './fake-client.js';

const relations = [
  { name: 'M2M/M2O', parentModel: 'x', field: 'items', childModel: 'x', inverse: 'parent_id', many: false },
  { name: 'O2M/M2O', parentModel: 'project.project', field: 'task_ids', childModel: 'project.task', inverse: 'project_id', many: false },
  { name: 'M2M/M2M', parentModel: 'project.project', field: 'type_ids', childModel: 'project.task.type', inverse: 'project_ids', many: true },
];

for (const relation of relations) {
  for (const parentChanges of [false, true]) {
    it.each([true, false])(`waits for an already-linked ${relation.name} child when parent changes=${parentChanges} (stopOnError=%s)`, async stopOnError => {
      const client = new FakeClient();
      const parent = client.seed(relation.parentModel, { name: 'Parent' }, 'review.b_parent');
      const child = client.seed(relation.childModel, {
        name: 'Before', [relation.inverse]: relation.many ? [parent] : parent,
      }, 'review.b_parent.child');
      client.data[relation.parentModel][0][relation.field] = [child];
      const dependent = client.seed('x', { name: 'Before' }, 'review.a_dependent');
      const independent = client.seed('x', { name: 'Before' }, 'review.z_independent');
      const definitions = [
        resource(relation.parentModel, 'review.b_parent', {
          name: parentChanges ? 'Parent after' : 'Parent',
          [relation.field]: children(relation.childModel, relation.inverse, [resource(relation.childModel, 'child', { name: 'Refused' })]),
        }),
        resource('x', 'review.a_dependent', { name: 'After' }, { dependsOn: ['review.b_parent'] }),
        resource('x', 'review.z_independent', { name: 'After' }),
      ];
      const reviewed = await plan(definitions, client.connection());
      expect(reviewed.operations.filter(op => op.externalId === 'review.b_parent').map(op => op.type)).toEqual(parentChanges ? ['update'] : []);
      client.failure = (_method, _model, values) => values?.name === 'Refused' ? new Error('child refused') : undefined;
      const result = await apply(reviewed, client.connection(), { stopOnError });
      expect(result.results.find(r => r.operation.externalId === 'review.b_parent.child')?.status).toBe('failed');
      expect(result.results.find(r => r.operation.externalId === 'review.a_dependent')?.status).toBe('skipped');
      expect(client.data.x.find(row => row.id === dependent)?.name).toBe('Before');
      expect(client.data.x.find(row => row.id === independent)?.name).toBe(stopOnError ? 'Before' : 'After');
      client.failure = undefined;
      const retry = await apply(await plan(definitions, client.connection()), client.connection());
      expect(retry.ok).toBe(true);
      const order = retry.results.map(r => r.operation.externalId);
      expect(order.indexOf('review.b_parent.child')).toBeLessThan(order.indexOf('review.a_dependent'));
      expect((await plan(definitions, client.connection())).operations).toEqual([]);
    });
  }
}

it.each([false, true])('includes desired child work through a bridge with mutations=%s', async bridgeChanges => {
  const client = new FakeClient();
  const parent = client.seed('x', { name: 'Parent' }, 'review.c_parent');
  const child = client.seed('x', { name: 'Before', parent_id: parent }, 'review.c_parent.child');
  client.data.x.find(row => row.id === parent)!.items = [child];
  const bridge = client.seed('x', { name: 'Before' }, 'review.b_bridge');
  const dependent = client.seed('x', { name: 'Before' }, 'review.a_dependent');
  const definitions = [
    resource('x', 'review.c_parent', { name: 'Parent', items: children('x', 'parent_id', [resource('x', 'child', { name: 'Refused' })]) }),
    resource('x', 'review.b_bridge', { name: bridgeChanges ? 'After' : 'Before' }, { dependsOn: ['review.c_parent'] }),
    resource('x', 'review.a_dependent', { name: 'After' }, { dependsOn: ['review.b_bridge'] }),
  ];
  const reviewed = await plan(definitions, client.connection());
  client.failure = (_method, _model, values) => values?.name === 'Refused' ? new Error('child refused') : undefined;
  const result = await apply(reviewed, client.connection(), { stopOnError: false });
  expect(result.results.find(r => r.operation.externalId === 'review.a_dependent')?.status).toBe('skipped');
  expect(client.data.x.find(row => row.id === bridge)?.name).toBe('Before');
  expect(client.data.x.find(row => row.id === dependent)?.name).toBe('Before');
});

it.each(['link', 'translation', 'unlink'] as const)('includes deferred child %s work when its parent has no mutation', async work => {
  const client = new FakeClient();
  const parent = client.seed('x', {}, 'review.b_parent');
  const child = client.seed('x', { name: 'Child', parent_id: parent }, 'review.b_parent.child');
  const tag = client.seed('x', {});
  client.data.x.find(row => row.id === parent)!.items = [child];
  if (work === 'unlink') client.data.x.find(row => row.id === child)!.items = [tag];
  const dependent = client.seed('x', { name: 'Before' }, 'review.a_dependent');
  const childValues = work === 'translation' ? { name: translated('Child', { en_US: 'Refused' }) }
    : work === 'link' ? { name: 'Child', items: [tag] } : { name: 'Child' };
  const definitions = [
    resource('x', 'review.b_parent', { items: children('x', 'parent_id', [resource('x', 'child', childValues)]) }),
    resource('x', 'review.a_dependent', { name: 'After' }, { dependsOn: ['review.b_parent'] }),
  ];
  const options: PlanOptions = work === 'unlink' ? { unlink: [{ externalId: 'review.b_parent.child', field: 'items', ids: [tag] }] } : {};
  const reviewed = await plan(definitions, client.connection(), options);
  expect(reviewed.operations.some(op => op.externalId === 'review.b_parent')).toBe(false);
  client.failure = (_method, _model, values) => values?.name === 'Refused' || values?.items ? new Error('child work refused') : undefined;
  const result = await apply(reviewed, client.connection(), { stopOnError: false });
  expect(result.results.find(r => r.operation.externalId === 'review.b_parent.child')?.status).toBe('failed');
  expect(result.results.find(r => r.operation.externalId === 'review.a_dependent')?.status).toBe('skipped');
  expect(client.data.x.find(row => row.id === dependent)?.name).toBe('Before');
});

for (const parentExists of [false, true]) {
  it.each([false, true])(`converges a full parent dependency with parent existing=${parentExists}, child existing=%s`, async childExists => {
    const client = new FakeClient();
    const parent = parentExists ? client.seed('project.project', { name: 'Parent' }, 'review.b_parent') : undefined;
    if (childExists) client.seed('project.task', { name: 'Before', project_id: parent ?? false }, 'review.b_parent.child');
    client.seed('x', { name: 'Before' }, 'review.a_dependent');
    const definitions = [
      resource('project.project', 'review.b_parent', { name: 'Parent', task_ids: children('project.task', 'project_id', [resource('project.task', 'child', { name: 'After' })]) }),
      resource('x', 'review.a_dependent', { name: 'After' }, { dependsOn: ['review.b_parent'] }),
    ];
    const result = await apply(await plan(definitions, client.connection()), client.connection(), { journal: { save: async () => {} } });
    expect(result.ok).toBe(true);
    const actualParent = client.data['project.project'][0];
    const actualChild = client.data['project.task'][0];
    expect(actualChild.project_id).toBe(actualParent.id);
    expect(actualParent.task_ids).toEqual([actualChild.id]);
    expect(result.results.at(-1)?.operation.externalId).toBe('review.a_dependent');
    expect((await plan(definitions, client.connection())).operations).toEqual([]);
  });
}

it('rejects an explicit full child-to-parent readiness cycle even when the parent has no mutation', async () => {
  const client = new FakeClient();
  const parent = client.seed('x', {}, 'review.parent');
  const child = client.seed('x', { parent_id: parent, name: 'Before' }, 'review.parent.child');
  client.data.x.find(row => row.id === parent)!.items = [child];
  const definitions = [resource('x', 'review.parent', { items: children('x', 'parent_id', [resource('x', 'child', { name: 'After' }, { dependsOn: ['review.parent'] })]) })];
  await expect(plan(definitions, client.connection())).rejects.toMatchObject({ code: 'RESOURCE_CYCLE' });
  expect(client.mutations).toEqual([]);
});
