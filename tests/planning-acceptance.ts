import assert from 'node:assert/strict';
import { apply, plan } from '@godoo-dev/stateman';
import { planningWorkload } from './planning-workload.js';

/** Same bounded physical-RPC assertions run through the isolated installed API. */
export async function planningAcceptance() {
  const f = planningWorkload(30);
  const first = await plan(f.definitions, f.store.connection(), f.options);
  assert.equal(first.operations.length, 0);
  assert.equal(new Set(f.calls.map(q => JSON.stringify(q))).size, f.calls.length, 'duplicate physical requests');
  const effectiveReads = f.calls.filter(q => q.model === 'catalog.product' && q.fields.some(n => n.startsWith('property_')) && q.fields.every(n => n === 'id' || n.startsWith('property_')));
  assert.equal(effectiveReads.length, 9, 'one compatible batch per company');
  assert.ok(effectiveReads.every(q => q.fields.length === 8 && q.domain[0][1] === 'in' && q.domain[0][2].length === 30));
  assert.ok(f.calls.length <= 260, `30-record physical request budget: ${f.calls.length}`);
  f.calls.length = 0;
  assert.equal((await plan(f.definitions, f.store.connection(), f.options)).digest, first.digest);
  assert.ok(f.calls.length > 0, 'independent plan must read again');
  f.store.effective.set(`catalog.product:${f.ids[14]}:property_4:${f.companies[3]}`, 99);
  await assert.rejects(apply(first, f.store.connection()), { code: 'STALE_PLAN' });
  assert.equal(f.store.mutations.length, 0);
  const fresh = await plan(f.definitions, f.store.connection(), f.options);
  const change = fresh.operations.find(op => op.companyId === f.companies[3]);
  assert.deepEqual(change?.before, { property_4: 99 });
  assert.equal((await apply(fresh, f.store.connection())).ok, true);
  assert.equal((await apply(await plan(f.definitions, f.store.connection(), f.options), f.store.connection())).committed, 0);
}
