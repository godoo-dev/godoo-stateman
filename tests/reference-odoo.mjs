import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, drift, lookup, openRecoveryJournal, plan, readRecoveryJournal, ref, resource } from '@godoo-dev/stateman';

/** Synthetic menu/action records in the native caller's owned database only. */
export async function referenceOdoo({ client, connection, root, versionOptions }) {
  const context = { lang: false, active_test: false, 'ir.ui.menu.full_list': true };
  const metadata = (await client.call('ir.ui.menu', 'fields_get', [['action']], { attributes: ['type', 'selection'], context })).action;
  assert.equal(metadata.type, 'reference');
  assert.ok(metadata.selection.some(([model]) => model === 'ir.actions.client'));
  const bin = join(dirname(fileURLToPath(import.meta.resolve('@godoo-dev/stateman'))), '../bin/stateman.js');
  const input = join(root, 'reference-cli.mjs'), reviewedPath = join(root, 'reference-cli-plan.json');
  const journalPath = join(root, 'reference-cli-recovery.json'), optionsPath = join(root, 'reference-cli-options.json');
  writeFileSync(optionsPath, JSON.stringify({ ...versionOptions, select: ['stateman_reference.menu'], context: { lang: false, 'ir.ui.menu.full_list': true } }));
  const shared = ['--connection', join(root, 'connection.mjs'), '--journal', journalPath, '--options', optionsPath];
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8' }));
  const declare = action => writeFileSync(input, `
import {resource,ref} from '@godoo-dev/stateman';
export const menu=resource('ir.ui.menu','stateman_reference.menu',{name:'Stateman Reference CLI menu',action:${action}});
export const dashboard=resource('ir.actions.client','stateman_reference.dashboard',{name:'Stateman Reference CLI action',tag:'stateman_reference.dashboard'});
`);
  const read = (model, domain, fields) => client.searchRead(model, domain, { fields, context });
  const independentRead = async () => {
    const identities = await read('ir.model.data', [['module', '=', 'stateman_reference'], ['name', 'in', ['dashboard', 'menu']]], ['name', 'model', 'res_id']);
    assert.equal(identities.length, 2);
    const actionBinding = identities.find(row => row.name === 'dashboard'), menuBinding = identities.find(row => row.name === 'menu');
    assert.equal(actionBinding.model, 'ir.actions.client'); assert.equal(menuBinding.model, 'ir.ui.menu');
    const actions = await read('ir.actions.client', [['name', '=', 'Stateman Reference CLI action']], ['name', 'tag']);
    const menus = await read('ir.ui.menu', [['name', '=', 'Stateman Reference CLI menu']], ['name', 'action']);
    assert.equal(actions.length, 1); assert.equal(menus.length, 1);
    assert.equal(actions[0].id, actionBinding.res_id); assert.equal(menus[0].id, menuBinding.res_id);
    assert.equal(actions[0].tag, 'stateman_reference.dashboard');
    return { action: actions[0], menu: menus[0] };
  };
  const noOp = () => {
    assert.deepEqual(run('plan', input, ...shared, '--out', reviewedPath).operations, []);
    const again = run('apply', reviewedPath, ...shared);
    assert.equal(again.ok, true); assert.equal(again.committed, 0);
    assert.equal(run('drift', input, ...shared).converged, true);
  };
  declare("ref('stateman_reference.dashboard')");
  const first = run('plan', input, ...shared, '--out', reviewedPath);
  assert.equal(first.options.context['ir.ui.menu.full_list'], true);
  writeFileSync(join(root, 'reference-cli-create-plan.json'), JSON.stringify(first, null, 2) + '\n');
  assert.deepEqual(first.order, ['stateman_reference.dashboard', 'stateman_reference.menu']);
  assert.deepEqual(first.resources.map(row => row.externalId).sort(), ['stateman_reference.dashboard', 'stateman_reference.menu']);
  assert.equal(first.operations.filter(op => op.type === 'create').length, 2);
  assert.equal(first.schema['ir.ui.menu'].action.type, 'reference');
  assert.ok(first.schema['ir.ui.menu'].action.selection.some(([model]) => model === 'ir.actions.client'));
  const applied = run('apply', reviewedPath, ...shared);
  assert.equal(applied.ok, true, JSON.stringify(applied));
  const created = await independentRead(), qualified = `ir.actions.client,${created.action.id}`;
  assert.equal(created.menu.action, qualified);
  const receipts = await readRecoveryJournal(journalPath);
  assert.deepEqual(receipts.map(row => [row.externalId, row.model, row.id, row.state]).sort(), [
    ['stateman_reference.dashboard', 'ir.actions.client', created.action.id, 'complete'],
    ['stateman_reference.menu', 'ir.ui.menu', created.menu.id, 'complete'],
  ]);
  noOp();
  for (const empty of ['false', 'null']) {
    assert.equal((await independentRead()).menu.action, qualified);
    declare(empty);
    const clear = run('plan', input, ...shared, '--out', reviewedPath);
    assert.equal(clear.operations.length, 1); assert.equal(clear.operations[0].type, 'update');
    assert.equal(clear.operations[0].values.action, false);
    assert.equal(run('apply', reviewedPath, ...shared).ok, true);
    assert.equal((await independentRead()).menu.action, false);
    noOp();
    declare("ref('stateman_reference.dashboard')");
    const assign = run('plan', input, ...shared, '--out', reviewedPath);
    assert.equal(assign.operations.length, 1); assert.equal(assign.operations[0].type, 'update');
    assert.equal(assign.operations[0].values.action, qualified);
    assert.equal(run('apply', reviewedPath, ...shared).ok, true);
    assert.equal((await independentRead()).menu.action, qualified);
    noOp();
  }
  assert.deepEqual(await readRecoveryJournal(journalPath), receipts);

  const externalId = await client.create('ir.actions.client', { name: 'Stateman external Reference action', tag: 'stateman_reference.external' }, context);
  const apiOptions = { ...versionOptions, context };
  const readAction = async () => (await read('ir.ui.menu', [['id', '=', created.menu.id]], ['action']))[0].action;
  for (const value of [lookup('ir.actions.client', { id: externalId }), `ir.actions.client,${externalId}`, qualified]) {
    const desired = [resource('ir.ui.menu', 'stateman_reference.menu', { action: value })];
    assert.equal((await apply(await plan(desired, connection, apiOptions), connection)).ok, true);
    assert.equal(await readAction(), typeof value === 'string' ? value : `ir.actions.client,${externalId}`);
    assert.equal((await drift(desired, connection, apiOptions)).converged, true);
    assert.equal((await apply(await plan(desired, connection, apiOptions), connection)).committed, 0);
  }
  assert.deepEqual((await plan([resource('ir.ui.menu', 'stateman_reference.menu', { name: 'Stateman Reference CLI menu' })], connection, apiOptions)).operations, []);
  assert.equal(await readAction(), qualified);
  const desired = [resource('ir.ui.menu', 'stateman_reference.menu', { action: qualified })];
  const stale = await plan(desired, connection, apiOptions);
  await client.write('ir.ui.menu', [created.menu.id], { action: false }, context);
  await assert.rejects(apply(stale, connection), { code: 'STALE_PLAN' });
  assert.equal(await readAction(), false);
  assert.equal((await apply(await plan(desired, connection, apiOptions), connection)).ok, true);
  assert.equal(await readAction(), qualified);
  const mutations = [];
  const measured = { ...connection, client: new Proxy(client, { get(target, key) {
    const value = Reflect.get(target, key);
    if (['create', 'write', 'unlink'].includes(key)) return async (...args) => { mutations.push([key, ...args]); return value.apply(target, args); };
    return typeof value === 'function' ? value.bind(target) : value;
  } }) };
  const again = await apply(await plan(desired, measured, apiOptions), measured);
  assert.equal(again.ok, true); assert.equal(again.committed, 0); assert.deepEqual(mutations, []);
  // Inject selection changes in returned metadata only; real RPC reads remain.
  const reviewedMetadata = await plan(desired, measured, apiOptions);
  for (const selection of [undefined, [['res.partner', 'Disallowed target']]]) {
    const altered = { ...measured, client: new Proxy(measured.client, { get(target, key) {
      if (key === 'call') return async (...args) => {
        const result = await target.call(...args);
        if (args[0] === 'ir.ui.menu' && args[1] === 'fields_get') result.action.selection = selection;
        return result;
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } }) };
    const code = selection ? 'REFERENCE_MODEL' : 'REFERENCE_METADATA';
    await assert.rejects(plan(desired, altered, apiOptions), { code });
    await assert.rejects(apply(reviewedMetadata, altered), { code });
  }
  assert.deepEqual(mutations, []); assert.equal(await readAction(), qualified);

  // Inject only XML-ID registration failure before sending that RPC. Action
  // creation, durable receipt, retry adoption and menu writes use real Odoo.
  const recoveryPath = join(root, 'reference-fault-recovery.json');
  const recoveryDefinitions = [
    resource('ir.ui.menu', 'stateman_reference.recovered_menu', { name: 'Stateman recovered Reference menu', action: ref('stateman_reference.recovered_action') }),
    resource('ir.actions.client', 'stateman_reference.recovered_action', { name: 'Stateman recovered Reference action', tag: 'stateman_reference.recovered' }),
  ];
  const injected = { ...connection, client: new Proxy(client, { get(target, key) {
    if (key === 'create') return async (model, values, opContext) => {
      if (model === 'ir.model.data' && values.module === 'stateman_reference' && values.name === 'recovered_action') throw new Error('Injected action XML-ID registration failure');
      return target.create(model, values, opContext);
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } }) };
  const failedJournal = await openRecoveryJournal(recoveryPath);
  try {
    const reviewed = await plan(recoveryDefinitions, injected, { ...apiOptions, select: ['stateman_reference.recovered_menu'], recovery: failedJournal.receipts });
    const failed = await apply(JSON.parse(JSON.stringify(reviewed)), injected, { journal: failedJournal, stopOnError: false });
    assert.equal(failed.ok, false); assert.equal(failed.failed, 1);
    const actionResult = failed.results.find(row => row.operation.externalId === 'stateman_reference.recovered_action');
    assert.equal(actionResult.status, 'failed'); assert.equal(actionResult.partial, true);
    assert.match(actionResult.message, /Injected action XML-ID registration failure/);
    assert.equal(failed.results.find(row => row.operation.externalId === 'stateman_reference.recovered_menu').status, 'skipped');
  } finally { await failedJournal.close(); }
  const retained = await readRecoveryJournal(recoveryPath);
  assert.equal(retained.length, 1); assert.equal(retained[0].externalId, 'stateman_reference.recovered_action');
  assert.equal(retained[0].model, 'ir.actions.client'); assert.equal(retained[0].state, 'record-created');
  const recoveredId = retained[0].id;
  assert.ok(recoveredId > 0);
  const actionRows = () => read('ir.actions.client', [['name', '=', 'Stateman recovered Reference action']], ['tag']);
  assert.deepEqual((await actionRows()).map(row => row.id), [recoveredId]);
  assert.deepEqual(await read('ir.model.data', [['module', '=', 'stateman_reference'], ['name', '=', 'recovered_action']], []), []);
  assert.deepEqual(await read('ir.ui.menu', [['name', '=', 'Stateman recovered Reference menu']], []), []);
  // Keep the partial receipt before reopening the same durable store for retry.
  writeFileSync(join(root, 'reference-fault-partial-receipts.json'), JSON.stringify(retained, null, 2) + '\n');
  const retryJournal = await openRecoveryJournal(recoveryPath);
  try {
    assert.deepEqual(retryJournal.receipts, retained);
    const options = () => ({ ...apiOptions, select: ['stateman_reference.recovered_menu'], recovery: retryJournal.receipts });
    const fresh = await plan(recoveryDefinitions, connection, options());
    assert.ok(fresh.operations.some(op => op.externalId === 'stateman_reference.recovered_action' && op.type === 'adopt'));
    assert.ok(!fresh.operations.some(op => op.model === 'ir.actions.client' && op.type === 'create'));
    const retried = await apply(JSON.parse(JSON.stringify(fresh)), connection, { journal: retryJournal, stopOnError: false });
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.deepEqual((await actionRows()).map(row => row.id), [recoveredId]);
    const menuRows = await read('ir.ui.menu', [['name', '=', 'Stateman recovered Reference menu']], ['action']);
    assert.equal(menuRows.length, 1); assert.equal(menuRows[0].action, `ir.actions.client,${recoveredId}`);
    assert.equal((await drift(recoveryDefinitions, connection, options())).converged, true);
    const repeated = await apply(await plan(recoveryDefinitions, connection, options()), connection, { journal: retryJournal });
    assert.equal(repeated.ok, true); assert.equal(repeated.committed, 0);
  } finally { await retryJournal.close(); }
  const completedRecovery = await readRecoveryJournal(recoveryPath);
  assert.deepEqual(completedRecovery.map(row => [row.externalId, row.model, row.state]).sort(), [
    ['stateman_reference.recovered_action', 'ir.actions.client', 'complete'], ['stateman_reference.recovered_menu', 'ir.ui.menu', 'complete'],
  ]);
  const proof = { metadata, selectedCliSavedPlan: true, independentReads: true, receipts, falseAndNullClearedFromNonempty: true,
    existingManagedAssignment: true, externalLookupAndLiteral: true, omittedUnmanaged: true, staleRefused: true,
    zeroCommitAndZeroMutationRepeat: true, injectedSelectionRefusedBeforeWrites: true,
    injectedXmlIdFailure: true, dependentSkippedWithStopOnErrorFalse: true,
    retainedPartialReceipts: retained, completedRecovery, recoveredId, recoveredWithoutDuplicate: true, freshZeroDrift: true };
  writeFileSync(join(root, 'reference-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  return proof;
}
