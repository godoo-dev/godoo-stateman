import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { OdooClient } from '@godoo-dev/client';
import { apply, children, createSchemaContext, drift, loadResources, lookup, normalizeResources, plan, resource } from '../src/index.js';
const fixture = resolve(import.meta.dirname, 'fixtures/consumer/resources');

describe('representative offline consumer', () => {
  it('loads arrays/helpers/re-exports exactly once, rendering Markdown and assembling Python', async () => {
    const inspection = await loadResources(fixture);
    expect(inspection.kind).toBe('offline-inspection');
    expect(inspection.resources).toHaveLength(10);
    expect(new Set(inspection.resources.map(r => r.externalId)).size).toBe(10);
    const byId = Object.fromEntries(inspection.resources.map(r => [r.externalId, r]));
    expect(byId['example.example_project'].values.type_ids).toEqual([
      { __type: 'resourceRef', externalId: 'example.example_project.ready' },
      { __type: 'resourceRef', externalId: 'example.example_project.done' },
    ]);
    expect(byId['example.example_project.ready'].parentScope).toEqual({ parentExternalId: 'example.example_project', inverseField: 'project_ids' });
    expect(byId['example.example_cron'].values.ir_actions_server_id).toEqual({ __type: 'resourceRef', externalId: 'example.example_cron.action' });
    expect(byId['example.example_cron'].values.active).toBe(false);
    const code = String(byId['example.example_cron.action'].values.code);
    expect(code).toContain('FIXTURE_LABEL = "example"\n\n# Sanitized fixture body');
    expect(code).toContain('message = FIXTURE_LABEL');
    expect(byId['example.example_guide_es'].values.content).toBe('<h1>Example guide</h1>\n<p>Use <strong>reviewed configuration</strong>.</p>');
    expect(byId['example.example_guide_es'].values.tag_ids).toEqual([
      lookup('document.page.tag', { name: 'es' }),
      { __type: 'resourceRef', externalId: 'example.example_tag_es' },
    ]);
    expect(byId['example.example_guide_en'].values.parent_id).toEqual({ __type: 'resourceRef', externalId: 'example.example_category' });
    expect(await loadResources(fixture)).toEqual(inspection);
  });
  it('renders nested content markers', async () => {
    const inspection = await loadResources(resolve(import.meta.dirname, 'fixtures/content.ts'));
    expect(inspection.resources[0].values.payload).toEqual({ sections: ['<h1>Nested</h1>'] });
    expect(inspection.resources[0].values.title).toBe('Example');
    expect(inspection.resources[0].translations?.entries).toEqual([{ field: 'title', lang: 'es_ES', value: '<p><strong>Ejemplo</strong></p>' }]);
  });
});

describe('deterministic nested identities', () => {
  it('preserves child identities across input reordering and never uses array indices', () => {
    const a = resource('stage', 'ready', { name: 'Ready' });
    const b = resource('stage', 'done', { name: 'Done' });
    const run = (stages: typeof a[]) => normalizeResources([resource('project', 'fixture.project', { stages: children('stage', stages) })]);
    expect(run([a, b]).map(r => r.externalId)).toEqual(run([b, a]).map(r => r.externalId));
    expect(() => run([resource('stage', { name: 'Unnamed' })])).toThrow('stable externalId');
  });
  it('derives unnamed scalar nested identity from the field, recursively', () => {
    const res = normalizeResources([resource('cron', 'fixture.cron', {
      action: resource('action', { nested: resource('other', 'inner', { name: 'Leaf' }) }),
    })]);
    expect(res.map(r => r.externalId)).toEqual(['fixture.cron', 'fixture.cron.action', 'fixture.cron.action.inner']);
    expect(res[1].values.nested).toEqual({ __type: 'resourceRef', externalId: 'fixture.cron.action.inner' });
  });
  it('handles nested resources inside lists and plain objects while retaining list lookups', () => {
    const res = normalizeResources([resource('x', 'fixture.x', {
      items: [resource('x', 'one', { target: lookup('x', { name: 'existing' }) }), lookup('x', { name: 'other' })],
      object: { item: resource('y', 'two', { name: 'Two' }) },
    })]);
    expect(res.map(r => r.externalId)).toEqual(['fixture.x', 'fixture.x.one', 'fixture.x.two']);
    expect((res[0].values.items as unknown[])[1]).toEqual(lookup('x', { name: 'other' }));
  });
  it('keeps explicitly qualified IDs and rejects collisions and mismatched child models', () => {
    const qualified = resource('x', 'fixture.shared', { name: 'Shared' });
    expect(normalizeResources([resource('x', 'fixture.parent', { items: [qualified] })]).map(r => r.externalId)).toContain('fixture.shared');
    expect(() => normalizeResources([resource('x', 'fixture.same', {}), resource('y', 'fixture.same', {})])).toThrow('Duplicate');
    expect(() => normalizeResources([resource('x', 'fixture.root', { children: children('y', [resource('z', 'child', {})]) })])).toThrow('model mismatch');
    expect(() => normalizeResources([resource('x', 'local', {})])).toThrow('qualified');
  });
  it('rejects cycles including disconnected cycles before serializing output', () => {
    const fields: Record<string, unknown> = {};
    const a = { __type: 'resource' as const, model: 'x', externalId: 'fixture.cycle', values: fields };
    fields.self = a;
    expect(() => normalizeResources([a])).toThrow('Cyclic');
    expect(() => normalizeResources([resource('x', 'fixture.safe', {}), a])).toThrow('Cyclic');
    const cyclic: unknown[] = []; cyclic.push(cyclic);
    expect(() => normalizeResources([resource('x', 'fixture.x', { cyclic })])).toThrow('Cyclic');
  });
  it('retains empty child relations and rejects lossy JSON values', () => {
    expect(normalizeResources([resource('x', 'fixture.x', { empty: children('y', []) })])[0].values.empty).toEqual([]);
    for (const invalid of [undefined, NaN, Infinity, 1n, () => 1, new Date()]) {
      expect(() => normalizeResources([resource('x', 'fixture.x', { invalid })])).toThrow('Unsupported');
    }
  });
});

describe('invalid-plan boundary and library seam', () => {
  it('rejects malformed reviewed plans before touching a client', async () => {
    const hostile = new Proxy({}, { get() { throw new Error('client touched'); } });
    await expect(apply({} as never, hostile as never)).rejects.toMatchObject({ code: 'INVALID_PLAN' });
  });
  it('constructs godoo introspection with no connection or credentials', () => {
    const client = new OdooClient({ url: 'http://127.0.0.1:1', database: 'offline', username: 'unused', password: 'unused' });
    const context = createSchemaContext(client);
    expect(context.client).toBe(client);
    expect(context.introspector).toBeDefined();
  });
});
