import { expect, it } from 'vitest';
import { companyValues, lookup, plan, resource } from '@godoo-dev/stateman';
import { planningAcceptance } from './planning-acceptance.js';
import { planningWorkload } from './planning-workload.js';
import { scopedStore } from './scoped-client.js';

it('bounds physical reads and retains independent-plan/apply freshness', planningAcceptance);

it.each(['missing', 'duplicate', 'unexpected', 'field', 'denied'] as const)('refuses incomplete contextual batches: %s', async fault => {
  const f = planningWorkload(3);
  const read = f.store.searchRead.bind(f.store);
  f.store.searchRead = async (model, domain, options) => {
    const rows = await read(model, domain, options);
    if (model === 'catalog.product' && options?.fields?.includes('property_4') && domain?.[0]?.[1] === 'in') {
      if (fault === 'missing') return rows.slice(1);
      if (fault === 'duplicate') return [rows[0], rows[0], ...rows.slice(2)];
      if (fault === 'unexpected') return [{ ...rows[0], id: 999999 }, ...rows.slice(1)];
      if (fault === 'field') delete rows[0].property_4;
      if (fault === 'denied') throw new Error('contextual access denied');
    }
    return rows;
  };
  await expect(plan(f.definitions, f.store.connection(), f.options)).rejects.toThrow();
  expect(f.store.mutations).toEqual([]);
});

it('keeps different company field signatures and omitted-company values separate', async () => {
  const { store, companies, context } = scopedStore();
  store.schema.x.amount = { type: 'float', company_dependent: true };
  const target = store.seed('x', {});
  const a = store.seed('x', { property: target, amount: 0 }, 'scope.a');
  store.seed('x', { property: target }, 'scope.b');
  store.effective.set(`x:${a}:property:${companies[2]}`, false);
  const input = [
    resource('x', 'scope.a', { property: companyValues([{ company: companies[0], value: target }]), amount: companyValues([{ company: companies[1], value: 0 }]) }),
    resource('x', 'scope.b', { property: companyValues([{ company: companies[1], value: target }]) }),
  ];
  const before = await plan(input, store.connection(), { context });
  expect(before.operations).toEqual([]);
  store.effective.set(`x:${a}:amount:${companies[0]}`, 123); // Not declared in this context.
  store.effective.set(`x:${a}:property:${companies[2]}`, target);
  expect((await plan(input, store.connection(), { context })).digest).toBe(before.digest);
  store.effective.set(`x:${a}:amount:${companies[1]}`, 123);
  expect((await plan(input, store.connection(), { context })).digest).not.toBe(before.digest);
});

it('coalesces concurrent repeated lookups into one observation', async () => {
  const { store } = scopedStore();
  const target = store.seed('x', { name: 'Target' });
  store.seed('x', {}, 'scope.root');
  let reads = 0;
  const read = store.searchRead.bind(store);
  store.searchRead = async (model, domain, options) => {
    if (domain?.[0]?.[0] === 'name') { reads++; await new Promise(resolve => setTimeout(resolve, 1)); }
    return read(model, domain, options);
  };
  const result = await plan([resource('x', 'scope.root', { items: Array.from({ length: 50 }, () => lookup('x', { name: 'Target' })) })], store.connection());
  expect(reads).toBe(1);
  expect(result.operations[0].values.items).toHaveLength(50);
  expect(result.observations.filter(o => o.kind === 'search' && (o.value as any).query.domain[0]?.[0] === 'name')).toHaveLength(1);
  expect(target).toBeGreaterThan(0);
});

it('retains deterministic digests under changed asynchronous lookup completion order', async () => {
  const f = planningWorkload(3);
  const read = f.store.searchRead.bind(f.store);
  let reverse = false;
  f.store.searchRead = async (model, domain, options) => {
    if (model === 'catalog.tax' && typeof domain?.[0]?.[2] === 'number') await new Promise(resolve => setTimeout(resolve, (Number(domain[0][2]) % 3) * (reverse ? 2 : 1)));
    return read(model, domain, options);
  };
  const first = await plan(f.definitions, f.store.connection(), f.options);
  reverse = true;
  expect((await plan(f.definitions, f.store.connection(), f.options)).digest).toBe(first.digest);
});

it('propagates coalesced read failures and starts the next plan with fresh reads', async () => {
  const { store } = scopedStore();
  store.seed('x', { name: 'Target' }); store.seed('x', {}, 'scope.root');
  const read = store.searchRead.bind(store);
  let denied = true, reads = 0;
  store.searchRead = async (model, domain, options) => {
    if (domain?.[0]?.[0] === 'name') {
      reads++;
      await new Promise(resolve => setTimeout(resolve, 1));
      if (denied) throw new Error('read forbidden');
    }
    return read(model, domain, options);
  };
  const input = [resource('x', 'scope.root', { items: Array.from({ length: 10 }, () => lookup('x', { name: 'Target' })) })];
  await expect(plan(input, store.connection())).rejects.toThrow('read forbidden');
  expect(reads).toBe(1);
  denied = false;
  expect((await plan(input, store.connection())).operations).toHaveLength(1);
  expect(reads).toBe(2);
});
