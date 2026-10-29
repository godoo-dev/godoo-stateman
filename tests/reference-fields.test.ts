import { expect, it } from 'vitest';
import { apply, lookup, plan, ref, resource, translated } from '../src/index.js';
import type { RecoveryReceipt } from '../src/index.js';
import { FakeClient } from './fake-client.js';

function fixture() {
  const client = new FakeClient();
  client.schema['ir.actions.client'] = { name: { type: 'char' }, tag: { type: 'char' } };
  client.schema['ir.ui.menu'] = { name: { type: 'char' }, action: { type: 'reference' } };
  Object.assign(client.schema['ir.ui.menu'].action, { selection: [['ir.actions.client', 'Client'], ['ir.actions.server', 'Server']] });
  const receipts = new Map<string, RecoveryReceipt>();
  const journal = { async save(receipt: RecoveryReceipt) { receipts.set(receipt.externalId, structuredClone(receipt)); } };
  const definitions = [
    resource('ir.ui.menu', 'example.menu', { name: 'Dashboard', action: ref('example.dashboard') }),
    resource('ir.actions.client', 'example.dashboard', { name: 'Dashboard', tag: 'example.dashboard' }),
  ];
  return { client, journal, receipts, definitions, connection: client.connection() };
}

it.each([false, true])('qualifies %s existing targets while ordinary refs remain numeric', async existing => {
  const f = fixture();
  if (existing) {
    f.client.seed('ir.actions.client', { name: 'Dashboard', tag: 'example.dashboard' }, 'example.dashboard');
    f.client.seed('ir.ui.menu', { name: 'Dashboard', action: false }, 'example.menu');
  }
  f.client.schema.x.parent_id.relation = 'ir.actions.client';
  f.client.schema.x.items.relation = 'ir.actions.client';
  f.client.schema.x.polymorphic_id = { type: 'many2one_reference' };
  f.definitions.push(resource('x', 'example.numeric', {
    parent_id: ref('example.dashboard'), items: [ref('example.dashboard')],
    polymorphic_id: ref('example.dashboard'), payload: { nested: [ref('example.dashboard')] },
  }));
  const reviewed = await plan(f.definitions, f.connection, { select: ['example.menu', 'example.numeric'] });
  expect(reviewed.order.indexOf('example.dashboard')).toBeLessThan(reviewed.order.indexOf('example.menu'));
  expect((await apply(JSON.parse(JSON.stringify(reviewed)), f.connection, { journal: f.journal })).ok).toBe(true);
  const id = f.client.data['ir.actions.client'][0].id;
  expect(f.client.data['ir.ui.menu'][0].action).toBe(`ir.actions.client,${id}`);
  expect(f.client.data.x[0]).toMatchObject({ parent_id: id, items: [id], polymorphic_id: id, payload: { nested: [id] } });
  expect((await plan(f.definitions, f.connection)).operations).toEqual([]);
});

it('qualifies field lookups and literal targets, clears false and preserves omitted fields', async () => {
  const f = fixture();
  const id = f.client.seed('ir.actions.client', { name: 'External' });
  f.client.seed('ir.ui.menu', { action: false }, 'example.menu');
  for (const value of [lookup('ir.actions.client', { name: 'External' }), `ir.actions.client,${id}`, false, null]) {
    f.client.data['ir.ui.menu'][0].action = value === false || value === null ? `ir.actions.client,${id}` : false;
    const definitions = [resource('ir.ui.menu', 'example.menu', { action: value })];
    expect((await apply(await plan(definitions, f.connection), f.connection)).ok).toBe(true);
    expect(f.client.data['ir.ui.menu'][0].action).toBe(value === false || value === null ? false : `ir.actions.client,${id}`);
  }
  f.client.data['ir.ui.menu'][0].action = `ir.actions.client,${id}`;
  expect((await plan([resource('ir.ui.menu', 'example.menu', { name: 'Changed' })], f.connection)).operations[0].values).toEqual({ name: 'Changed' });
});

it('rejects Reference translations before any contextual value can bypass validation', async () => {
  const f = fixture();
  const definitions = [resource('ir.ui.menu', 'example.menu', { action: translated('ir.actions.client,1', { es_ES: 'x,123' }) })];
  await expect(plan(definitions, f.connection)).rejects.toMatchObject({ code: 'REFERENCE_TRANSLATION_UNSUPPORTED' });
  expect(f.client.mutations).toEqual([]);
});

it.each([1, 0, true, '', 'ir.actions.client,0', 'ir.actions.client,-1', 'ir.actions.client,01', 'ir.actions.client,1,2',
  'ir.actions.client,1.5', 'ir.actions.client,9007199254740992', [], {}, { nested: ref('example.dashboard') }])(
  'rejects ambiguous or malformed Reference input %j before writes', async value => {
    const f = fixture();
    await expect(plan([...f.definitions.slice(1), resource('ir.ui.menu', 'example.menu', { action: value })], f.connection))
      .rejects.toMatchObject({ code: 'REFERENCE_VALUE' });
    expect(f.client.mutations).toEqual([]);
  });

it('rejects missing, ambiguous, invisible and disallowed targets before writes', async () => {
  const f = fixture();
  const menu = (action: unknown) => [resource('ir.ui.menu', 'example.menu', { action })];
  await expect(plan(menu(ref('example.missing')), f.connection)).rejects.toMatchObject({ code: 'MISSING_DEPENDENCY' });
  await expect(plan(menu('ir.actions.client,999'), f.connection)).rejects.toMatchObject({ code: 'RECORD_UNAVAILABLE' });
  await expect(plan(menu(lookup('ir.actions.client', { name: 'Unknown' })), f.connection)).rejects.toMatchObject({ code: 'LOOKUP_MISSING' });
  f.client.seed('ir.actions.client', { name: 'Duplicate' });
  f.client.seed('ir.actions.client', { name: 'Duplicate' });
  await expect(plan(menu(lookup('ir.actions.client', { name: 'Duplicate' })), f.connection)).rejects.toMatchObject({ code: 'AMBIGUOUS_LOOKUP' });
  for (const action of [ref('example.wrong'), lookup('x', {}), 'x,1']) {
    await expect(plan([...menu(action), resource('x', 'example.wrong', {})], f.connection)).rejects.toMatchObject({ code: 'REFERENCE_MODEL' });
  }
  expect(f.client.mutations).toEqual([]);
});

it.each([undefined, null, 'callable', [['ir.actions.client']], [[17, 'Invalid']], [['ir.actions.client', false]]])(
  'fails closed on unavailable or malformed Reference selection metadata %j', async selection => {
    const f = fixture();
    Object.assign(f.client.schema['ir.ui.menu'].action, { selection });
    await expect(plan(f.definitions, f.connection)).rejects.toMatchObject({ code: 'REFERENCE_METADATA' });
    expect(f.client.mutations).toEqual([]);
  });

it('includes fresh allowed-model metadata and target observations in stale-plan validation', async () => {
  const f = fixture();
  const id = f.client.seed('ir.actions.client', { name: 'External' });
  const definitions = [resource('ir.ui.menu', 'example.menu', { action: `ir.actions.client,${id}` })];
  const reviewed = await plan(definitions, f.connection);
  Object.assign(f.client.schema['ir.ui.menu'].action, { selection: [['ir.actions.client', 'Changed label']] });
  await expect(apply(reviewed, f.connection, { journal: f.journal })).rejects.toMatchObject({ code: 'STALE_PLAN' });
  const refreshed = await plan(definitions, f.connection);
  f.client.data['ir.actions.client'] = [];
  await expect(apply(refreshed, f.connection, { journal: f.journal })).rejects.toMatchObject({ code: 'RECORD_UNAVAILABLE' });
  expect(f.client.mutations).toEqual([]);
});

it('uses the target model when IDs coincide', async () => {
  const f = fixture();
  const server = f.client.seed('ir.actions.server', { name: 'Server' }, 'example.server');
  f.client.nextId = server;
  f.client.seed('ir.actions.client', { name: 'Client' }, 'example.client');
  const definitions = [resource('ir.actions.server', 'example.server', { name: 'Server' }),
    resource('ir.actions.client', 'example.client', { name: 'Client' }),
    resource('ir.ui.menu', 'example.client_menu', { action: ref('example.client') }),
    resource('ir.ui.menu', 'example.server_menu', { action: ref('example.server') })];
  expect((await apply(await plan(definitions, f.connection), f.connection, { journal: f.journal })).ok).toBe(true);
  expect(f.client.data['ir.ui.menu'].map(row => row.action).sort()).toEqual([`ir.actions.client,${server}`, `ir.actions.server,${server}`]);
});

it('requests selection attributes from the actual schema adapter', async () => {
  const f = fixture();
  const original = f.client.call.bind(f.client);
  f.client.call = async <T>(model: string, method: string, _args?: any[], kwargs?: Record<string, unknown>): Promise<T> => {
    expect(kwargs?.attributes).toContain('selection');
    return original<T>(model, method);
  };
  await plan(f.definitions, f.connection);
});
