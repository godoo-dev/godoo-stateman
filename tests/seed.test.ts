import { expect, it } from 'vitest';
import { createFixture } from '../src/fixtures.js';
import { inspectResources } from '../src/inspect.js';
import { resource } from '../src/dsl/resource.js';
import { seedFixture } from '../src/seed.js';
import { FakeClient } from './fake-client.js';
import type { RecoveryReceipt } from '../src/state-types.js';

it('seeds portable state, returns fresh XML-ID bindings and reapplies without mutations', async () => {
  const client = new FakeClient();
  const fixture = createFixture(await inspectResources([resource('x', 'seed.root', { name: 'Portable' })]), { namespaces: ['seed'] });
  const receipts = new Map<string, RecoveryReceipt>();
  const journal = { save: async (receipt: RecoveryReceipt) => { receipts.set(receipt.externalId, receipt); } };
  const first = await seedFixture(fixture, client.connection(), { journal });
  expect(first.ok).toBe(true);
  expect(first.bindings['seed.root']).toBe(client.data.x[0].id);
  const mutations = client.mutations.length;
  const next = await seedFixture(fixture, client.connection(), { journal, plan: { recovery: [...receipts.values()] } });
  expect(next.ok).toBe(true);
  expect(next.bindings).toEqual(first.bindings);
  expect(client.mutations).toHaveLength(mutations);
});

it('reports failed seeds as unsuccessful and preserves recovery evidence', async () => {
  const client = new FakeClient();
  const fixture = createFixture(await inspectResources([resource('x', 'seed.root', { state: 'invalid' })]), { namespaces: ['seed'] });
  const result = await seedFixture(fixture, client.connection(), { journal: { save: async () => undefined } });
  expect(result.ok).toBe(false);
  expect(result.result.failed).toBe(1);
  expect(result.result.recovery[0].state).toBe('pending');
});
