import { expect, it } from 'vitest';
import { apply, exact, plan, resource, translated } from '@godoo-dev/stateman';
import { mixedPlanningWorkload, planningWorkload } from './planning-workload.js';
import { scopedStore } from './scoped-client.js';

it('bounds a mixed three-language, seven-relation catalog with varying projections', async () => {
  const f = mixedPlanningWorkload(300);
  const result = await plan(f.definitions, f.store.connection(), f.options);
  expect(result.operations).toEqual([]);
  expect(f.calls.length).toBeLessThanOrEqual(200);
  expect(new Set(f.calls.map(q => JSON.stringify(q))).size).toBe(f.calls.length);
  const membership = f.calls.filter(q => q.domain[1]?.[1] === 'in' && q.fields.length === 1);
  expect(membership.length).toBeLessThanOrEqual(70);
  const translated = f.calls.filter(q => q.context.lang);
  expect(translated).toHaveLength(15); // Three name chunks and two body chunks, per language.
});

it.each([99, 100, 101])('batches identities, base values and translations at the 100-record boundary: %s', async size => {
  const f = planningWorkload(size);
  const first = await plan(f.definitions, f.store.connection(), f.options);
  const chunks = Math.ceil(size / 100);
  expect(first.operations).toEqual([]);
  expect(f.calls.filter(q => q.model === 'ir.model.data')).toHaveLength(chunks);
  expect(f.calls.filter(q => q.model === 'catalog.product' && q.fields.includes('taxes'))).toHaveLength(chunks);
  expect(f.calls.filter(q => q.model === 'catalog.product' && q.context.lang)).toHaveLength(2 * chunks);
  const seen = f.calls.length;
  expect((await apply(first, f.store.connection())).committed).toBe(0);
  expect(f.calls.length - seen).toBe(2 * seen); // Independent revalidation and final drift.
});

it.each(['base', 'translation', 'identity', 'membership'] as const)('rejects malformed %s batch responses before writes', async kind => {
  for (const fault of ['missing', 'duplicate', 'unexpected', 'field', 'denied'] as const) {
    // A missing identity legitimately invokes adoption; an empty membership
    // query is legitimate negative evidence. Test faults applicable to each.
    if ((kind === 'identity' && fault === 'missing') || (kind === 'membership' && (fault === 'missing' || fault === 'field'))) continue;
    const f = planningWorkload(3);
    if (kind === 'membership') {
      const target = f.ids[1];
      f.store.data['catalog.product'][0].suggestions = [target];
    }
    const read = f.store.searchRead.bind(f.store);
    f.store.searchRead = async (model, domain, options) => {
      const rows = await read(model, domain, options);
      const fields = options?.fields ?? [];
      if (kind === 'membership' && model === 'catalog.product' && fields.includes('suggestions')) for (const row of rows) row.suggestions = [];
      const hit = kind === 'identity' ? model === 'ir.model.data'
        : model === 'catalog.product' && domain?.[0]?.[1] === 'in' && (kind === 'base' ? fields.includes('taxes')
          : kind === 'translation' ? Boolean(options?.context?.lang)
          : domain?.[1]?.[0] === 'suggestions');
      if (!hit) return rows;
      if (fault === 'denied') throw new Error('batch read denied');
      if (fault === 'missing') return rows.slice(1);
      if (fault === 'duplicate') return [...rows, rows[0]];
      if (fault === 'unexpected') return [...rows, { ...rows[0], id: 999999, name: 'unrequested' }];
      delete rows[0][kind === 'identity' ? 'res_id' : kind === 'translation' ? 'name' : 'taxes'];
      return rows;
    };
    await expect(plan(f.definitions, f.store.connection(), f.options), `${kind}/${fault}`).rejects.toThrow();
    expect(f.store.mutations).toEqual([]);
  }
});

it('retains per-key identity ambiguity, model and duplicate-record claim checks inside a batch', async () => {
  for (const fault of ['alias', 'model', 'claim']) {
    const f = planningWorkload(3);
    const rows = f.store.data['ir.model.data'];
    if (fault === 'alias') {
      const { id: _id, ...alias } = rows[0];
      f.store.seed('ir.model.data', alias);
    }
    if (fault === 'model') rows[1].model = 'catalog.tax';
    if (fault === 'claim') rows[1].res_id = rows[0].res_id;
    await expect(plan(f.definitions, f.store.connection(), f.options)).rejects.toMatchObject({ code: 'IDENTITY_COLLISION' });
    expect(f.store.mutations).toEqual([]);
  }
});

it('finds a hidden link on one owner among 101 and refuses a reviewed plan before writes', async () => {
  const f = planningWorkload(101);
  const target = f.store.seed('catalog.product', { name: 'Archived target' });
  const first = await plan(f.definitions, f.store.connection(), f.options);
  const read = f.store.searchRead.bind(f.store);
  f.store.searchRead = async (model, domain, options) => {
    const rows = await read(model, domain, options);
    if (model === 'catalog.product' && options?.fields?.includes('suggestions')) for (const row of rows) row.suggestions = [];
    return rows;
  };
  f.store.data['catalog.product'].find(row => row.id === f.ids[100])!.suggestions = [target];
  await expect(plan(f.definitions, f.store.connection(), f.options)).rejects.toMatchObject({ code: 'EXACT_VISIBILITY', message: expect.stringContaining(String(target)) });
  await expect(apply(first, f.store.connection())).rejects.toMatchObject({ code: 'EXACT_VISIBILITY' });
  expect(f.store.mutations).toEqual([]);
});

it('keeps different owner-visible sets and candidate chunks independent', async () => {
  const { store, context } = scopedStore();
  const targets = Array.from({ length: 1002 }, () => store.seed('x', {}));
  const a = store.seed('x', { items: [targets[0]] }, 'batch.a');
  const b = store.seed('x', { items: [targets[1]] }, 'batch.b');
  const input = [resource('x', 'batch.a', { items: exact([targets[0]]) }), resource('x', 'batch.b', { items: exact([targets[1]]) })];
  expect((await plan(input, store.connection(), { context })).operations).toEqual([]);
  const read = store.searchRead.bind(store);
  store.searchRead = async (model, domain, options) => {
    const rows = await read(model, domain, options);
    if (model === 'x' && options?.fields?.includes('items')) for (const row of rows) row.items = row.id === a ? [targets[0]] : [targets[1]];
    return rows;
  };
  store.data.x.find(row => row.id === b)!.items = [targets[1], targets.at(-1)!];
  await expect(plan(input, store.connection(), { context })).rejects.toMatchObject({ code: 'EXACT_VISIBILITY', message: expect.stringContaining(String(targets.at(-1))) });
});

it('preserves field permissions and fresh translation/base/identity evidence', async () => {
  const { store } = scopedStore();
  store.schema.x.name.translate = true;
  const a = store.seed('x', { name: 'A', body: '<p>A</p>' }, 'batch.a');
  const b = store.seed('x', { name: 'B' }, 'batch.b');
  const input = [resource('x', 'batch.a', { name: translated('A', { es_ES: 'A' }), body: '<p>A</p>' }), resource('x', 'batch.b', { name: translated('B', { es_ES: 'B' }) })];
  const read = store.searchRead.bind(store);
  store.searchRead = async (model, domain, options) => {
    if (model === 'x' && domain?.[0]?.[2]?.includes?.(b) && options?.fields?.includes('body')) throw new Error('undeclared field permission');
    return (await read(model, domain, options)).reverse();
  };
  const first = await plan(input, store.connection(), { context: { lang: false } });
  expect(first.operations).toEqual([]);
  store.data.x.find(row => row.id === b)!.body = 'Unmanaged';
  expect((await plan(input, store.connection(), { context: { lang: false } })).digest).toBe(first.digest);
  for (const fault of ['base', 'translation', 'identity']) {
    const oldBody = store.data.x.find(row => row.id === a)!.body;
    const alias = store.data['ir.model.data'].find(row => row.res_id === a)!;
    if (fault === 'base') store.data.x.find(row => row.id === a)!.body = '<p>Changed</p>';
    if (fault === 'translation') store.languages.set(`x:${b}:name:es_ES`, 'Changed');
    if (fault === 'identity') alias.res_id = store.seed('x', { name: 'A', body: oldBody });
    await expect(apply(first, store.connection())).rejects.toMatchObject({ code: 'STALE_PLAN' });
    store.data.x.find(row => row.id === a)!.body = oldBody;
    store.languages.delete(`x:${b}:name:es_ES`);
    alias.res_id = a;
  }
  expect(store.mutations).toEqual([]);
});
