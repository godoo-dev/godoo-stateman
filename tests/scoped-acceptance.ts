import assert from 'node:assert/strict';
import { apply, companyValues, drift, exact, lookup, plan, ref, resource, translated } from '@godoo-dev/stateman';
import type { RecoveryReceipt } from '@godoo-dev/stateman';
import { scopedStore } from './scoped-client.js';

/** Also executed unchanged against the tarball in an isolated typed consumer. */
export async function scopedAcceptance() {
  const { store, companies, context } = scopedStore();
  const a = store.seed('x', { name: 'A' }), b = store.seed('x', { name: 'B' });
  const record = store.seed('x', { name: 'Shared', items: [a, b], description: 'Keep' }, 'scope.shared');
  const unrelated = store.seed('x', { name: 'Unrelated', items: [b] });
  const definitions = (items: unknown) => [resource('x', 'scope.shared', { items })];
  assert.equal((await drift(definitions([a]), store.connection())).converged, true);
  await assert.rejects(plan(definitions(exact([a])), store.connection(), { context: { allowed_company_ids: [companies[0]] } }), { code: 'EXACT_VISIBILITY' });
  const reviewed = await plan(definitions(exact([a])), store.connection(), { context });
  assert.equal(reviewed.operations.length, 1);
  assert.deepEqual(reviewed.operations[0].values, { items: [[3, b, 0]] });
  store.data.x.find(row => row.id === record)!.items = [a];
  await assert.rejects(apply(JSON.parse(JSON.stringify(reviewed)), store.connection()), { code: 'STALE_PLAN' });
  store.data.x.find(row => row.id === record)!.items = [a, b];
  assert.equal((await apply(reviewed, store.connection())).ok, true);
  assert.deepEqual(store.data.x.find(row => row.id === record)!.items, [a]);
  assert.deepEqual(store.data.x.find(row => row.id === unrelated)!.items, [b]);
  assert.equal(store.data.x.find(row => row.id === record)!.description, 'Keep');
  assert.ok(store.data.x.find(row => row.id === b));
  assert.equal((await apply(await plan(definitions(exact([a])), store.connection(), { context }), store.connection())).committed, 0);
  assert.equal((await apply(await plan(definitions(exact([])), store.connection(), { context }), store.connection())).ok, true);
  assert.deepEqual(store.data.x.find(row => row.id === record)!.items, []);
  const receipts: RecoveryReceipt[] = [];
  const journal = { save: async (receipt: RecoveryReceipt) => { const index = receipts.findIndex(r => r.externalId === receipt.externalId); if (index < 0) receipts.push(receipt); else receipts[index] = receipt; } };
  const freshTargets = [resource('x', 'scope.shared', { items: exact([ref('scope.new')]) }), resource('x', 'scope.new', { name: 'New target' })];
  store.failure = (_method, _model, values) => values?.items ? new Error('link refused') : undefined;
  const partial = await apply(await plan(freshTargets, store.connection(), { context }), store.connection(), { journal });
  assert.equal(partial.ok, false); assert.equal(receipts[0].state, 'complete');
  store.failure = undefined;
  assert.equal((await apply(await plan(freshTargets, store.connection(), { context, recovery: receipts }), store.connection(), { journal })).ok, true);
  assert.equal(store.data.x.filter(row => row.name === 'New target').length, 1);

  // Effective company values, one stable identity, unchanged undeclared C,
  // contextual relation resolution and ordinary translations on the same record.
  store.effective.set(`x:${record}:property:${companies[0]}`, a);
  store.effective.set(`x:${record}:property:${companies[1]}`, a);
  store.effective.set(`x:${record}:property:${companies[2]}`, b);
  const desired = [resource('x', 'scope.shared', {
    property: companyValues([
      { company: lookup('res.company', { name: 'Company A' }), value: a },
      { company: companies[1], value: ref('scope.account') },
    ]), description: translated('Keep', { es_ES: 'Conservar' }),
  }), resource('x', 'scope.account', { name: 'New account' })];
  const companyPlan = await plan(desired, store.connection(), { context, recovery: receipts });
  await assert.rejects(plan(desired, store.connection(), { context: { allowed_company_ids: [companies[0]] }, recovery: receipts }), { code: 'COMPANY_CONTEXT' });
  assert.deepEqual(companyPlan.operations.filter(op => op.companyId).map(op => op.companyId), [companies[1]]);
  const operation = companyPlan.operations.find(op => op.companyId)!;
  assert.deepEqual(operation.before, { property: a });
  assert.deepEqual(operation.context?.allowed_company_ids, [companies[1], companies[0], companies[2]]);
  assert.equal(operation.context?.custom, 'base');
  store.effective.set(`x:${record}:property:${companies[1]}`, false);
  await assert.rejects(apply(companyPlan, store.connection(), { journal }), { code: 'STALE_PLAN' });
  store.effective.set(`x:${record}:property:${companies[1]}`, a);
  store.failure = (_method, _model, values) => values?.property ? new Error('company write refused') : undefined;
  const failed = await apply(companyPlan, store.connection(), { journal }); assert.equal(failed.ok, false);
  store.failure = undefined;
  const retried = await apply(await plan(desired, store.connection(), { context, recovery: receipts }), store.connection(), { journal });
  assert.equal(retried.ok, true);
  assert.equal(store.data.x.filter(row => row.name === 'New account').length, 1);
  assert.equal(store.effective.get(`x:${record}:property:${companies[0]}`), a);
  assert.equal(store.effective.get(`x:${record}:property:${companies[2]}`), b);
  assert.equal((await apply(await plan(desired, store.connection(), { context, recovery: receipts }), store.connection())).committed, 0);
  const reset = [resource('x', 'scope.shared', { property: companyValues([{ company: companies[1], value: false }]) })];
  assert.equal((await apply(await plan(reset, store.connection(), { context }), store.connection())).ok, true);
  assert.equal(store.effective.get(`x:${record}:property:${companies[1]}`), false);
  assert.equal((await drift(reset, store.connection(), { context })).converged, true);
  return { store, companies, context, record, a, b };
}
