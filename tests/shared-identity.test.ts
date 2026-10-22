import { describe, expect, it } from 'vitest';
import { children, normalizeResources, resource } from '../src/index.js';
import type { ResourceDefinition } from '../src/index.js';

const ref = (externalId: string) => ({ __type: 'resourceRef', externalId });
function graph(id: string) {
  const ready = resource('stage', id, { name: 'Ready' });
  const project = resource('project', 'fixture.project', {
    stages: children('stage', 'project_ids', [ready]),
    default_stage_id: ready,
  });
  const task = resource('task', 'fixture.task', { stage_id: ready, stages: [ready] });
  return { ready, project, task };
}

describe('canonical shared definition identity', () => {
  for (const id of ['ready', 'fixture.ready']) {
    for (const reversed of [false, true]) {
      it(`reuses declared ${id}, including aliases, with references ${reversed ? 'before' : 'after'} owner`, () => {
        const { ready, project, task } = graph(id);
        const expected = id.includes('.') ? id : 'fixture.project.ready';
        const inputs = reversed ? [task, ready, project, ready] : [project, ready, task, ready];
        const result = normalizeResources(inputs);
        expect(result).toHaveLength(3);
        const byId = Object.fromEntries(result.map(r => [r.externalId, r]));
        expect(byId['fixture.task'].values.stage_id).toEqual(ref(expected));
        expect(byId['fixture.task'].values.stages).toEqual([ref(expected)]);
        expect(byId['fixture.project'].values.stages).toEqual([ref(expected)]);
        expect(byId['fixture.project'].values.default_stage_id).toEqual(ref(expected));
        expect(byId[expected].parentScope).toEqual({ parentExternalId: 'fixture.project', inverseField: 'project_ids' });
        expect(normalizeResources([...inputs].reverse())).toEqual(result);
      });
    }
  }
  it('uses a deep declared child identity when its references precede both ancestors', () => {
    const leaf = resource('stage', 'leaf', {});
    const branch = resource('group', 'branch', { stages: children('stage', 'group_id', [leaf]) });
    const root = resource('project', 'fixture.root', { groups: children('group', 'project_id', [branch]) });
    const task = resource('task', 'fixture.task', { stage_id: leaf, group_id: branch });
    const res = normalizeResources([task, leaf, branch, root]);
    expect(res.find(r => r.externalId === 'fixture.task')?.values).toEqual({ stage_id: ref('fixture.root.branch.leaf'), group_id: ref('fixture.root.branch') });
    expect(res.find(r => r.externalId === 'fixture.root.branch.leaf')?.parentScope).toEqual({ parentExternalId: 'fixture.root.branch', inverseField: 'group_id' });
  });
  it('reuses an implicit local inline child within its one declaring parent', () => {
    const child = resource('stage', 'ready', {});
    const parent = resource('project', 'fixture.project', { stages: [child], default_stage: child });
    const res = normalizeResources([child, parent]);
    expect(res).toHaveLength(2);
    expect(res[0].values.default_stage).toEqual(ref('fixture.project.ready'));
  });
  it('rejects distinct definitions claiming the canonical child identity', () => {
    const { project } = graph('ready');
    const duplicate = resource('stage', 'fixture.project.ready', { name: 'Other' });
    for (const input of [[project, duplicate], [duplicate, project]]) expect(() => normalizeResources(input)).toThrow('Duplicate resource identity: fixture.project.ready');
  });
  it('rejects distinct definitions with the same local identity under one owner', () => {
    const a = resource('stage', 'ready', {});
    const b = resource('stage', 'ready', {});
    const owner = resource('project', 'fixture.project', { stages: children('stage', 'project_ids', [a, b]) });
    expect(() => normalizeResources([owner])).toThrow('Duplicate resource identity');
  });
  for (const id of ['ready', 'fixture.ready']) {
    it(`rejects genuinely conflicting children ownership for ${id}`, () => {
      const child = resource('stage', id, {});
      const a = resource('project', 'fixture.a', { stages: children('stage', 'project_ids', [child]) });
      const b = resource('project', 'fixture.b', { stages: children('stage', 'project_ids', [child]) });
      for (const input of [[a, b], [b, a]]) expect(() => normalizeResources(input)).toThrow('Ambiguous ownership');
    });
  }
  it('rejects conflicting inverse declarations and ambiguous implicit local ownership', () => {
    const child = resource('stage', 'ready', {});
    const owner = resource('project', 'fixture.project', {
      stages: children('stage', 'first_id', [child]), other: children('stage', 'second_id', [child]),
    });
    expect(() => normalizeResources([owner])).toThrow('Ambiguous ownership');
    const a = resource('project', 'fixture.a', { stage: child });
    const b = resource('project', 'fixture.b', { stage: child });
    expect(() => normalizeResources([b, a])).toThrow('Ambiguous ownership');
  });
  it('continues to reject cyclic definition graphs beside valid roots', () => {
    const fields: Record<string, unknown> = {};
    const a: ResourceDefinition = { __type: 'resource', model: 'x', externalId: 'fixture.cycle', values: fields };
    fields.self = a;
    expect(() => normalizeResources([resource('x', 'fixture.safe', {}), a])).toThrow('Cyclic');
  });
});
