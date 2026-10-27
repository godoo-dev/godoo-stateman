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
  store.mirrorTranslations = true;
  store.data.x.find(row => row.id === record)!.body = '<p>Base<br/></p>';
  store.languages.set(`x:${record}:body:es_ES`, '<p>Idioma<br/></p>');
  const combinedContext = { ...context, lang: false };
  const desired = [resource('x', 'scope.shared', {
    items: exact([a]),
    body: translated('<p>Base<br></p>', { es_ES: '<p>Idioma<br></p>' }),
    property: companyValues([
      { company: lookup('res.company', { name: 'Company A' }), value: a },
      { company: companies[1], value: ref('scope.account') },
    ]), description: translated('Keep', { es_ES: 'Conservar' }),
  }), resource('x', 'scope.account', { name: 'New account' })];
  const companyPlan = await plan(desired, store.connection(), { context: combinedContext, recovery: receipts });
  await assert.rejects(plan(desired, store.connection(), { context: { allowed_company_ids: [companies[0]] }, recovery: receipts }), { code: 'EXACT_VISIBILITY' });
  assert.deepEqual(companyPlan.operations.filter(op => op.companyId).map(op => op.companyId), [companies[1]]);
  assert.equal(companyPlan.operations.some(op => 'body' in op.values), false);
  const restore = companyPlan.operations.find(op => op.key.endsWith(':translation-defaults'))!;
  assert.deepEqual(restore.values, { description: 'Keep' });
  assert.equal(restore.context?.lang, false);
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
  const retried = await apply(await plan(desired, store.connection(), { context: combinedContext, recovery: receipts }), store.connection(), { journal });
  assert.equal(retried.ok, true);
  assert.equal(store.data.x.filter(row => row.name === 'New account').length, 1);
  assert.deepEqual(store.data.x.find(row => row.id === record)!.items, [a]);
  assert.equal(store.data.x.find(row => row.id === record)!.description, 'Keep');
  assert.equal(store.languages.get(`x:${record}:description:es_ES`), 'Conservar');
  assert.equal(store.effective.get(`x:${record}:property:${companies[0]}`), a);
  assert.equal(store.effective.get(`x:${record}:property:${companies[2]}`), b);
  assert.equal((await apply(await plan(desired, store.connection(), { context: combinedContext, recovery: receipts }), store.connection())).committed, 0);
  const reset = [resource('x', 'scope.shared', { property: companyValues([{ company: companies[1], value: false }]) })];
  assert.equal((await apply(await plan(reset, store.connection(), { context }), store.connection())).ok, true);
  assert.equal(store.effective.get(`x:${record}:property:${companies[1]}`), false);
  assert.equal((await drift(reset, store.connection(), { context })).converged, true);
  return { store, companies, context, record, a, b };
}

/** Standard accounting display context, also run from the isolated tarball. */
export async function standardContextAcceptance() {
  const { store, context } = scopedStore();
  store.schema['account.tax'] = { name: { type: 'char' } };
  store.schema['account.account'] = { tax_ids: { type: 'many2many', relation: 'account.tax', store: true, context: { append_type_to_tax_name: true } } };
  const a = store.seed('account.tax', { name: 'Tax A' }), b = store.seed('account.tax', { name: 'Tax B' });
  const account = store.seed('account.account', { tax_ids: [a, b] }, 'scope.standard');
  const desired = (ids: number[]) => [resource('account.account', 'scope.standard', { tax_ids: exact(ids) })];
  for (const ids of [[a], [], [b]]) {
    const reviewed = await plan(desired(ids), store.connection(), { context });
    assert.equal(reviewed.digest, (await plan(desired(ids), store.connection(), { context })).digest);
    assert.equal((await apply(JSON.parse(JSON.stringify(reviewed)), store.connection())).ok, true);
    assert.deepEqual(store.data['account.account'].find(row => row.id === account)!.tax_ids, ids);
    assert.equal((await apply(await plan(desired(ids), store.connection(), { context }), store.connection())).committed, 0);
  }
  assert.equal(store.data['account.tax'].length, 2);
  const field = store.schema['account.account'].tax_ids;
  const reviewed = await plan(desired([]), store.connection(), { context });
  field.context = {};
  await assert.rejects(apply(reviewed, store.connection()), { code: 'STALE_PLAN' });
  for (const rejected of [{ append_type_to_tax_name: false }, { append_type_to_tax_name: 1 }, { append_type_to_tax_name: 'true' }, { append_type_to_tax_name: true, active_test: false }, { allowed_company_ids: [1] }, { arbitrary: 'PRIVATE_VALUE' }]) {
    field.context = rejected;
    await assert.rejects(plan(desired([]), store.connection(), { context }), error => {
      const failure = error as Error & { code: string };
      assert.equal(failure.code, 'EXACT_VISIBILITY');
      assert.match(failure.message, /scope.standard.*account.account.tax_ids/);
      assert.ok(failure.message.includes(Object.keys(rejected)[0]));
      assert.ok(!failure.message.includes('PRIVATE_VALUE'));
      return true;
    });
  }
  field.context = { append_type_to_tax_name: true };
  field.relation = 'x';
  await assert.rejects(plan(desired([]), store.connection(), { context }), { code: 'EXACT_VISIBILITY' });
  field.relation = 'account.tax';
  store.schema.x.items.context = { append_type_to_tax_name: true };
  store.seed('x', {}, 'scope.wrong');
  await assert.rejects(plan([resource('x', 'scope.wrong', { items: exact([]) })], store.connection(), { context }), { code: 'EXACT_VISIBILITY' });
  store.schema['account.account'].other_taxes = { ...field };
  await assert.rejects(plan([resource('account.account', 'scope.standard', { other_taxes: exact([]) })], store.connection(), { context }), { code: 'EXACT_VISIBILITY' });
  store.schema.x.tax_ids = { ...field };
  await assert.rejects(plan([resource('x', 'scope.wrong', { tax_ids: exact([]) })], store.connection(), { context }), { code: 'EXACT_VISIBILITY' });
  const beforeRefusals = store.mutations.length;
  for (const malformed of ['append_type_to_tax_name', ['append_type_to_tax_name']]) {
    field.context = malformed as any;
    await assert.rejects(plan(desired([]), store.connection(), { context }), { code: 'EXACT_VISIBILITY' });
  }
  assert.equal(store.mutations.length, beforeRefusals);
  field.context = { append_type_to_tax_name: true };
  store.version = '19.0';
  await assert.rejects(plan(desired([]), store.connection(), { context, odooMajorVersions: [19] }), { code: 'EXACT_VISIBILITY' });
}
