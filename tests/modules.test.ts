import { describe, expect, it } from 'vitest';
import { planModules, applyModules } from '../src/modules.js';
import type { ModuleStageConnection } from '../src/modules.js';

function setup() {
  const states = new Map([['extra', 'uninstalled'], ['dependency', 'uninstalled']]);
  const calls: string[] = [];
  let uid = 2;
  let failure: unknown;
  let invalidationFailure: unknown;
  const adapter: ModuleStageConnection = {
    identity: async () => ({ url: 'http://localhost:1234/', database: 'test', uid }),
    modules: {
      catalogRevision: 0,
      inspectPrerequisites: async () => ({
        modules: [...states].map(([name, state]) => ({ name, state, status: state, dependencies: name === 'extra' ? ['dependency'] : [] })),
        closureComplete: true, diagnostics: [], cycleEdges: [],
      }),
      installModule: async name => {
        calls.push(`install:${name}`);
        adapter.modules = { ...adapter.modules, catalogRevision: adapter.modules.catalogRevision + 1 };
        if (failure) throw failure;
        states.set(name, 'installed'); states.set('dependency', 'installed');
        return { name, state: 'installed', changed: true, schemaInvalidated: true };
      },
      upgradeModule: async name => {
        calls.push(`upgrade:${name}`);
        adapter.modules = { ...adapter.modules, catalogRevision: adapter.modules.catalogRevision + 1 };
        if (failure) throw failure;
        return { name, state: 'installed', changed: true, schemaInvalidated: true };
      },
    },
    invalidateSchema: async () => { calls.push('invalidate'); if (invalidationFailure) throw invalidationFailure; },
  };
  return { adapter, states, calls, setUid: (value: number) => { uid = value; }, setFailure: (value: unknown) => { failure = value; }, setInvalidationFailure: (value: unknown) => { invalidationFailure = value; } };
}
describe('explicit addon stages', () => {
  it('previews read-only closure, applies selected request and invalidates before return', async () => {
    const s = setup();
    const preview = await planModules(s.adapter, [{ name: 'extra', action: 'install' }]);
    expect(s.calls).toEqual([]);
    expect(preview.prerequisites.modules).toHaveLength(2);
    const result = await applyModules(preview, s.adapter);
    expect(result).toMatchObject({ ok: true, requiresReplan: true });
    expect(s.calls).toEqual(['install:extra', 'invalidate']);
    expect(s.states.get('dependency')).toBe('installed');
  });
  it('rejects stale or modified plans and changed targets before mutation', async () => {
    const s = setup();
    const preview = await planModules(s.adapter, [{ name: 'extra', action: 'install' }]);
    s.states.set('extra', 'installed');
    await expect(applyModules(preview, s.adapter)).rejects.toThrow('fresh preview');
    s.states.set('extra', 'uninstalled'); s.setUid(3);
    await expect(applyModules(preview, s.adapter)).rejects.toThrow('fresh preview');
    s.setUid(2); preview.requests[0].action = 'upgrade';
    await expect(applyModules(preview, s.adapter)).rejects.toThrow('changed after review');
    expect(s.calls).toEqual([]);
  });
  it('invalidates after ambiguous failure, preserves original error and skips remainder', async () => {
    const s = setup();
    const preview = await planModules(s.adapter, [{ name: 'dependency', action: 'install' }, { name: 'extra', action: 'install' }]);
    const original = new Error('transport lost after dispatch'); s.setFailure(original);
    const result = await applyModules(preview, s.adapter);
    expect(result).toMatchObject({ ok: false, requiresReplan: true });
    expect(result.results[0].error).toBe(original);
    expect(result.results[1].status).toBe('skipped');
    expect(s.calls).toEqual(['install:dependency', 'invalidate']);
  });
  it('treats invalidation failure as unsuccessful even after committed operation', async () => {
    const s = setup();
    const preview = await planModules(s.adapter, [{ name: 'extra', action: 'install' }]);
    const error = new Error('cache persistence failed'); s.setInvalidationFailure(error);
    const result = await applyModules(preview, s.adapter);
    expect(result.ok).toBe(false);
    expect(result.results[0].invalidationError).toBe(error);
  });
  it('rejects unknown closure, unsupported requests and uninstalled upgrade', async () => {
    const s = setup();
    await expect(planModules(s.adapter, [{ name: 'extra', action: 'upgrade' }])).rejects.toThrow('not installed');
    s.states.set('dependency', 'unknown');
    await expect(planModules(s.adapter, [{ name: 'extra', action: 'install' }])).rejects.toThrow('complete');
    await expect(planModules(s.adapter, [{ name: 'extra', action: 'install' }, { name: 'extra', action: 'upgrade' }])).rejects.toThrow('once');
  });
});
