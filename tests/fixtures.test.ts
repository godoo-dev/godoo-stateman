import { describe, expect, it } from 'vitest';
import { createFixture, serializeFixture, parseFixture } from '../src/fixtures.js';
import type { Inspection } from '../src/inspect.js';

function input(): Inspection {
  return {
    kind: 'offline-inspection', files: ['/private/source/file.ts'], diagnostics: [], policies: [],
    resources: [
      { externalId: 'seed.project', model: 'project.project', values: { name: 'Synthetic', secret: 'exclude me', tag_ids: [{ __type: 'resourceRef', externalId: 'seed.tag' }] } },
      { externalId: 'seed.tag', model: 'project.tags', values: { name: 'Fixture', color: 4 } },
    ],
  };
}
describe('portable desired-state fixtures', () => {
  it('roundtrips rendered relations and excludes requested fields and source paths', () => {
    const source = input();
    const fixture = createFixture(source, { namespaces: ['seed'], excludeFields: { 'project.project': ['secret'] } });
    const json = serializeFixture(fixture);
    expect(json).not.toContain('exclude me');
    expect(json).not.toContain('/private');
    const loaded = parseFixture(json);
    expect(loaded.resources[0].values.tag_ids).toEqual([{ __type: 'resourceRef', externalId: 'seed.tag' }]);
    expect(loaded.files).toEqual([]);
    expect(source.resources[0].values.secret).toBe('exclude me');
    expect(serializeFixture(createFixture(loaded, { namespaces: ['seed'] }))).toBe(json);
  });
  it('uses deterministic lexical resource/key order independently of input order', () => {
    const source = input();
    const a = serializeFixture(createFixture(source, { namespaces: ['seed'] }));
    source.resources.reverse();
    source.resources[1].values = Object.fromEntries(Object.entries(source.resources[1].values).reverse());
    expect(serializeFixture(createFixture(source, { namespaces: ['seed'] }))).toBe(a);
  });
  it('requires explicit namespace coverage and unique qualified identities', () => {
    expect(() => createFixture(input(), { namespaces: [] })).toThrow('namespaces');
    expect(() => createFixture(input(), { namespaces: ['other'] })).toThrow('outside');
    const source = input();
    source.resources.push(source.resources[0]);
    expect(() => createFixture(source, { namespaces: ['seed'] })).toThrow('duplicate');
  });
  it('bounds input bytes, resources and nested depth', () => {
    expect(() => createFixture(input(), { namespaces: ['seed'], maxResources: 1 })).toThrow('count');
    expect(() => createFixture(input(), { namespaces: ['seed'], maxDepth: 1 })).toThrow('maxDepth');
    expect(() => createFixture(input(), { namespaces: ['seed'], maxBytes: 10 })).toThrow('maxBytes');
    expect(() => parseFixture(' '.repeat(101), { maxBytes: 100 })).toThrow('maxBytes');
    expect(() => parseFixture('{}', { maxDepth: 1000 })).toThrow('maxDepth');
  });
  it('rejects unrendered executable/authoring markers and non-JSON values', () => {
    const source = input();
    for (const value of [{ __type: 'mdFile', path: '/private/file' }, () => 1, NaN, new Date()]) {
      source.resources[0].values.name = value;
      expect(() => createFixture(source, { namespaces: ['seed'] })).toThrow();
    }
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    source.resources[0].values.name = cyclic;
    expect(() => createFixture(source, { namespaces: ['seed'] })).toThrow('cyclic');
  });
  it('rejects prototype keys, schema extensions and unsupported versions', () => {
    const fixture = createFixture(input(), { namespaces: ['seed'] });
    const json = serializeFixture(fixture);
    expect(() => parseFixture(json.replace('"color": 4', '"__proto__": {"polluted":true}'))).toThrow('unsafe');
    expect(() => parseFixture(json.replace('"version": 1', '"version": 2'))).toThrow('version');
    expect(() => parseFixture(json.replace('"version": 1', '"unknown": 1, "version": 1'))).toThrow('unsupported');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('preserves explicit adoption without importing database record IDs', () => {
    const source = input();
    source.resources[0].ref = { __type: 'lookup', model: 'project.project', domain: { name: 'Synthetic' } };
    const parsed = parseFixture(serializeFixture(createFixture(source, { namespaces: ['seed'] })));
    expect(parsed.resources[0].ref).toEqual(source.resources[0].ref);
    source.resources[0].ref = { __type: 'lookup', model: 'res.partner', domain: {} };
    expect(() => createFixture(source, { namespaces: ['seed'] })).toThrow('model mismatch');
  });
  it('retains explicit managed dependency and parent closure, rejecting missing parents', () => {
    const source = input();
    Object.assign(source.resources[0], { dependsOn: ['seed.tag'], onMissing: 'error' });
    const loaded = parseFixture(serializeFixture(createFixture(source, { namespaces: ['seed'] })));
    expect(loaded.resources[0]).toMatchObject({ dependsOn: ['seed.tag'], onMissing: 'error' });
    source.resources[0].parentScope = { parentExternalId: 'seed.missing', inverseField: 'parent_id' };
    expect(() => createFixture(source, { namespaces: ['seed'] })).toThrow('managed parent');
    delete source.resources[0].parentScope;
    Object.assign(source.resources[0], { dependsOn: ['seed.missing'] });
    expect(() => createFixture(source, { namespaces: ['seed'] })).toThrow('missing managed dependency');
  });
  it('does not turn legacy removal/translation policies into portable authorization', () => {
    const source = input();
    source.resources[0].removeUnmanaged = { tag_ids: true };
    expect(() => createFixture(source, { namespaces: ['seed'] })).toThrow('removal');
    delete source.resources[0].removeUnmanaged;
    source.policies.push({ __type: 'model', model: 'project.project', removeOrphans: true });
    expect(() => createFixture(source, { namespaces: ['seed'] })).toThrow('removal');
  });
});
