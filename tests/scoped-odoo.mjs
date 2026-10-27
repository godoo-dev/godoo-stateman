import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OdooClient } from '@godoo-dev/client';
import { apply, companyValues, createConnection, drift, exact, lookup, openRecoveryJournal, plan, ref, resource, translated } from '@godoo-dev/stateman';

/** Synthetic fixtures only, in the environment wholly owned by the native caller. */
export async function scopedOdoo({ client, connection, root, url, database, versionOptions }) {
  const [accountModule] = await client.searchRead('ir.module.module', [['name', '=', 'account']], { fields: ['state'] });
  if (accountModule.state !== 'installed') await client.call('ir.module.module', 'button_immediate_install', [[accountModule.id]]);
  const uid = (await connection.identity()).uid;
  const [user] = await client.searchRead('res.users', [['id', '=', uid]], { fields: ['company_ids'] });
  const companyA = user.company_ids[0];
  const [country] = await client.searchRead('res.country', [['code', '=', 'US']], { fields: [] });
  const companyB = await client.create('res.company', { name: 'Stateman Company B', country_id: country.id });
  const companyC = await client.create('res.company', { name: 'Stateman Company C', country_id: country.id });
  const companies = [...user.company_ids, companyB, companyC];
  await client.write('res.users', [uid], { company_ids: companies.map(id => [4, id, 0]) });
  const context = { lang: 'en_US', allowed_company_ids: [companyB, ...companies.filter(id => id !== companyB)] };
  const scope = { ...versionOptions, context };
  const inCompany = id => ({ ...context, allowed_company_ids: [id, ...companies.filter(other => other !== id)] });
  const accountFields = await client.call('account.account', 'fields_get', [], { attributes: ['type'] });
  const accountValues = (name, code, company) => ({ name, code, account_type: 'income', ...(accountFields.company_ids ? { company_ids: [[4, company, 0]] } : { company_id: company }) });
  const accountA = await client.create('account.account', accountValues('Stateman income A', 'SM1001', companyA), inCompany(companyA));
  const accountC = await client.create('account.account', accountValues('Stateman income C', 'SM1003', companyC), inCompany(companyC));
  const taxGroup = await client.create('account.tax.group', { name: 'Stateman synthetic tax group', company_id: companyB, country_id: country.id }, context);
  const taxValues = name => ({ name, amount: 5, amount_type: 'percent', type_tax_use: 'sale', company_id: companyB, tax_group_id: taxGroup });
  const taxA = await client.create('account.tax', taxValues('Stateman Tax A'), context);
  const taxB = await client.create('account.tax', taxValues('Stateman Tax B'), context);
  const unrelated = await client.create('product.template', { name: 'Stateman unrelated', type: 'service', taxes_id: [[4, taxB, 0]] }, context);
  const standardMetadata = (await client.call('account.account', 'fields_get', [['tax_ids']], { attributes: ['type', 'relation', 'store', 'readonly', 'company_dependent', 'domain', 'context'], context })).tax_ids;
  assert.deepEqual(standardMetadata.context, { append_type_to_tax_name: true });
  assert.equal(standardMetadata.type, 'many2many'); assert.equal(standardMetadata.relation, 'account.tax');
  assert.equal(standardMetadata.store, true); assert.equal(standardMetadata.readonly, false); assert.equal(standardMetadata.company_dependent, false);
  assert.match(standardMetadata.domain, /company_ids/);
  const standardAccount = await client.create('account.account', accountValues('Stateman standard account', 'SM2001', companyB), context);
  const standardDesired = [resource('account.account', 'stateman_scope.standard', { _ref: lookup('account.account', { id: standardAccount }), tax_ids: exact([]) })];
  const names = async extra => (await client.searchRead('account.tax', [['id', '=', taxA]], { fields: ['name', 'display_name'], context: { ...context, ...extra } }))[0];
  const plain = await names({ append_type_to_tax_name: false }), display = await names({ append_type_to_tax_name: true });
  assert.equal(plain.name, display.name); assert.equal(plain.id, display.id); assert.notEqual(plain.display_name, display.display_name);
  await client.write('account.account', [standardAccount], { tax_ids: [[4, taxA, 0]] }, { ...context, append_type_to_tax_name: true });
  assert.deepEqual((await client.searchRead('account.account', [['id', '=', standardAccount]], { fields: ['tax_ids'], context }))[0].tax_ids, [taxA]);
  await client.write('account.account', [standardAccount], { tax_ids: [[3, taxA, 0]] }, { ...context, append_type_to_tax_name: true });
  const standardUnrelated = await client.create('account.account', { ...accountValues('Stateman unrelated account', 'SM2002', companyB), tax_ids: [[4, taxB, 0]] }, context);
  const accountRead = async id => (await client.searchRead('account.account', [['id', '=', id]], { fields: ['name', 'code', 'company_ids', 'tax_ids'], context }))[0];
  const standardBefore = await accountRead(standardAccount);
  const standardDefinitions = ids => [resource('account.account', 'stateman_scope.standard', { _ref: lookup('account.account', { id: standardAccount }), tax_ids: exact(ids) })];
  assert.equal((await apply(await plan(standardDesired, connection, scope), connection)).ok, true);
  for (const ids of [[taxA, taxB], [taxA], [], [taxB]]) {
    const reviewed = await plan(standardDefinitions(ids), connection, scope);
    assert.equal(reviewed.digest, (await plan(standardDefinitions(ids), connection, scope)).digest);
    assert.equal((await apply(JSON.parse(JSON.stringify(reviewed)), connection)).ok, true);
    assert.deepEqual((await accountRead(standardAccount)).tax_ids.sort(), [...ids].sort());
    assert.equal((await drift(standardDefinitions(ids), connection, scope)).converged, true);
    assert.equal((await apply(await plan(standardDefinitions(ids), connection, scope), connection)).committed, 0);
  }
  assert.deepEqual(await accountRead(standardAccount), { ...standardBefore, tax_ids: [taxB] });
  assert.deepEqual((await accountRead(standardUnrelated)).tax_ids, [taxB]);
  assert.equal((await client.searchRead('account.tax', [['id', 'in', [taxA, taxB]]], { fields: [], context })).length, 2);
  const standardReviewed = await plan(standardDefinitions([]), connection, scope);
  await client.write('account.account', [standardAccount], { tax_ids: [[4, taxA, 0]] }, context);
  await assert.rejects(apply(standardReviewed, connection), { code: 'STALE_PLAN' });
  assert.deepEqual((await accountRead(standardAccount)).tax_ids.sort(), [taxA, taxB].sort());
  // Fault adapters alter only returned metadata, retaining real RPC access. They
  // prove revalidation refuses changed contexts/domains before an Odoo write.
  const metadataConnection = modify => ({ ...connection, client: new Proxy(client, { get(target, key) {
    if (key === 'call') return async (...args) => {
      const result = await target.call(...args);
      if (args[0] === 'account.account' && args[1] === 'fields_get') modify(result.tax_ids);
      return result;
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } }) });
  const freshStandard = await plan(standardDefinitions([]), connection, scope);
  for (const rejected of [{ append_type_to_tax_name: false }, { append_type_to_tax_name: true, active_test: false }, { allowed_company_ids: companies }]) {
    const altered = metadataConnection(field => { field.context = rejected; });
    for (const operation of [() => plan(standardDefinitions([]), altered, scope), () => apply(freshStandard, altered)]) {
      await assert.rejects(operation(), error => error.code === 'EXACT_VISIBILITY' && error.message.includes('stateman_scope.standard') && error.message.includes('account.account.tax_ids') && error.message.includes(Object.keys(rejected)[0]));
    }
  }
  await assert.rejects(apply(freshStandard, metadataConnection(field => { field.context = {}; })), { code: 'STALE_PLAN' });
  await assert.rejects(apply(freshStandard, metadataConnection(field => { field.domain = []; })), { code: 'STALE_PLAN' });
  await assert.rejects(plan(standardDefinitions([]), connection, { ...scope, context: { allowed_company_ids: [companyB] } }), { code: 'EXACT_VISIBILITY' });
  assert.deepEqual((await accountRead(standardAccount)).tax_ids.sort(), [taxA, taxB].sort());
  const hiddenRead = { ...connection, client: new Proxy(client, { get(target, key) {
    if (key === 'searchRead') return async (...args) => {
      const rows = await target.searchRead(...args);
      if (args[0] === 'account.account' && args[2]?.fields?.includes('tax_ids')) for (const row of rows) row.tax_ids = row.tax_ids.filter(id => id !== taxA);
      return rows;
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } }) };
  await assert.rejects(plan(standardDefinitions([]), hiddenRead, scope), error => error.code === 'EXACT_VISIBILITY' && error.message.includes('relation reads hide'));
  await assert.rejects(apply(freshStandard, hiddenRead), { code: 'EXACT_VISIBILITY' });
  assert.equal((await apply(freshStandard, connection)).ok, true);
  console.log(JSON.stringify({ standardContext: { metadata: standardMetadata, plain, display, exactEmptyAndNonempty: true, preservation: true, zeroWriteRepeats: true, staleMembershipContextDomain: true, rejectedContexts: true, syntheticOnly: true } }));
  const journal = await openRecoveryJournal(join(root, 'scoped-recovery.json'));
  let journalOpen = true;
  const desired = taxes => [resource('product.template', 'stateman_scope.service', { name: 'Stateman shared service', type: 'service', taxes_id: taxes })];
  try {
    const initial = await apply(await plan(desired(exact([taxA, taxB])), connection, { ...scope, recovery: journal.receipts }), connection, { journal });
    assert.equal(initial.ok, true, JSON.stringify(initial));
    const product = initial.drift.bindings['stateman_scope.service'];
    const [before] = await client.searchRead('product.template', [['id', '=', product]], { fields: ['name', 'type', 'taxes_id'], context });
    assert.equal((await drift(desired([taxA]), connection, scope)).converged, true);
    const reviewed = await plan(desired(exact([taxA])), connection, scope);
    assert.deepEqual(reviewed.operations.find(op => op.type === 'unlink').values, { taxes_id: [[3, taxB, 0]] });
    await client.write('product.template', [product], { taxes_id: [[3, taxA, 0]] }, context);
    await assert.rejects(apply(reviewed, connection), { code: 'STALE_PLAN' });
    await client.write('product.template', [product], { taxes_id: [[4, taxA, 0]] }, context);
    const exactResult = await apply(reviewed, connection);
    assert.equal(exactResult.ok, true, JSON.stringify(exactResult));
    const [after] = await client.searchRead('product.template', [['id', '=', product]], { fields: ['name', 'type', 'taxes_id'], context });
    assert.equal(after.name, before.name); assert.equal(after.type, before.type); assert.deepEqual(after.taxes_id, [taxA]);
    assert.equal((await client.searchRead('account.tax', [['id', '=', taxB]], { fields: ['name'], context })).length, 1);
    assert.deepEqual((await client.searchRead('product.template', [['id', '=', unrelated]], { fields: ['taxes_id'], context }))[0].taxes_id, [taxB]);
    const hiddenTax = await client.create('account.tax', { ...taxValues('Stateman purchase tax'), type_tax_use: 'purchase' }, context);
    await client.write('product.template', [product], { taxes_id: [[4, hiddenTax, 0]] }, context);
    await assert.rejects(plan(desired(exact([taxA])), connection, scope), error => error.code === 'EXACT_VISIBILITY' && error.message.includes(String(hiddenTax)));
    // Odoo's filtered field cannot remove this purchase-tax link via command3.
    // Retire only this synthetic adversarial fixture, then continue ordinary
    // visible sale-tax reconciliation on the shared product.
    await client.unlink('account.tax', [hiddenTax]);
    assert.equal((await apply(await plan(desired(exact([taxA])), connection, scope), connection)).committed, 0);
    assert.equal((await apply(await plan(desired(exact([])), connection, scope), connection)).ok, true);
    assert.deepEqual((await client.searchRead('product.template', [['id', '=', product]], { fields: ['taxes_id'], context }))[0].taxes_id, []);
    await assert.rejects(plan(desired(exact([taxA])), connection, { ...scope, context: { allowed_company_ids: [companyA] } }), { code: 'EXACT_VISIBILITY' });
    const newTaxDesired = [...desired(exact([ref('stateman_scope.newtax')])), resource('account.tax', 'stateman_scope.newtax', taxValues('Stateman new tax'))];
    assert.equal((await apply(await plan(newTaxDesired, connection, { ...scope, recovery: journal.receipts }), connection, { journal })).ok, true);

    await client.write('product.template', [product], { property_account_income_id: accountA }, inCompany(companyA));
    await client.write('product.template', [product], { property_account_income_id: false }, inCompany(companyB));
    await client.write('product.template', [product], { property_account_income_id: accountC }, inCompany(companyC));
    const [spanish] = await client.searchRead('res.lang', [['code', '=', 'es_ES']], { fields: ['active'], context: { active_test: false } });
    if (!spanish.active) await client.write('res.lang', [spanish.id], { active: true });
    const companyDesired = [resource('product.template', 'stateman_scope.service', {
      name: translated('Stateman shared service', { es_ES: 'Servicio compartido Stateman' }),
      property_account_income_id: companyValues([
        { company: lookup('res.company', { name: (await client.searchRead('res.company', [['id', '=', companyA]], { fields: ['name'] }))[0].name }), value: accountA },
        { company: companyB, value: ref('stateman_scope.newaccount') },
      ]),
    }), resource('account.account', 'stateman_scope.newaccount', { name: 'Stateman income B', code: 'SM1002', account_type: 'income' })];
    const companyPlan = await plan(companyDesired, connection, { ...scope, recovery: journal.receipts });
    assert.deepEqual(companyPlan.operations.filter(op => op.companyId).map(op => op.companyId), [companyB]);
    await client.write('product.template', [product], { property_account_income_id: false }, inCompany(companyA));
    await assert.rejects(apply(companyPlan, connection, { journal }), { code: 'STALE_PLAN' });
    await client.write('product.template', [product], { property_account_income_id: accountA }, inCompany(companyA));
    // Inject one failed RPC before sending it, after the new account has committed.
    // Retry uses the durable receipt; actual writes and convergence remain real.
    const fault = { ...connection, client: new Proxy(client, { get(target, key) {
      if (key === 'write') return async (model, ids, values, opContext) => { if ('property_account_income_id' in values) throw new Error('Synthetic contextual write failure'); return target.write(model, ids, values, opContext); };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } }) };
    const failed = await apply(companyPlan, fault, { journal });
    assert.equal(failed.ok, false); assert.ok(failed.results.some(result => result.status === 'failed'));
    const retry = await apply(await plan(companyDesired, connection, { ...scope, recovery: journal.receipts }), connection, { journal });
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.equal(retry.results.filter(result => result.operation.type === 'create').length, 0);
    const accountB = retry.drift.bindings['stateman_scope.newaccount'];
    const readAccount = async company => (await client.searchRead('product.template', [['id', '=', product]], { fields: ['property_account_income_id'], context: inCompany(company) }))[0].property_account_income_id;
    assert.equal((await readAccount(companyA))[0], accountA); assert.equal((await readAccount(companyB))[0], accountB); assert.equal((await readAccount(companyC))[0], accountC);
    assert.equal((await plan(companyDesired, connection, { ...scope, recovery: journal.receipts })).bindings['stateman_scope.service'], product);
    assert.equal((await apply(await plan(companyDesired, connection, { ...scope, recovery: journal.receipts }), connection)).committed, 0);
    const reset = [resource('product.template', 'stateman_scope.service', { property_account_income_id: companyValues([{ company: companyB, value: false }]) })];
    assert.equal((await apply(await plan(reset, connection, scope), connection)).ok, true);
    assert.equal(await readAccount(companyB), false); assert.equal((await readAccount(companyC))[0], accountC);

    // A real separate user with company A only cannot manage B. This is not a
    // credentials probe: this disposable user's password is synthetic test data.
    const [internal] = await client.searchRead('ir.model.data', [['module', '=', 'base'], ['name', '=', 'group_user']], { fields: ['res_id'] });
    await client.create('res.users', { name: 'Stateman restricted', login: 'stateman_restricted', password: 'stateman_disposable', company_id: companyA, company_ids: [[6, 0, [companyA]]], groups_id: [[6, 0, [internal.res_id]]] });
    const restricted = new OdooClient({ url, database, username: 'stateman_restricted', password: 'stateman_disposable' });
    await restricted.authenticate();
    await assert.rejects(plan(reset, createConnection(restricted, { url }), scope));
    assert.equal(await readAccount(companyB), false);
    const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve('@godoo-dev/stateman'))));
    const cliInput = join(root, 'scoped-resources.mjs'), cliOptions = join(root, 'scoped-options.json'), cliPlan = join(root, 'scoped-reviewed.json');
    writeFileSync(cliInput, `import {resource,exact,companyValues} from '@godoo-dev/stateman'; export const service=resource('product.template','stateman_scope.service',{taxes_id:exact([${taxA}]),property_account_income_id:companyValues([{company:${companyB},value:false}])}); export const account=resource('account.account','stateman_scope.standard',{tax_ids:exact([${taxA}])});`);
    writeFileSync(cliOptions, JSON.stringify(scope));
    const shared = ['--connection', join(root, 'connection.mjs'), '--journal', join(root, 'scoped-recovery.json'), '--options', cliOptions];
    const cli = args => JSON.parse(execFileSync(process.execPath, [join(packageRoot, 'bin/stateman.js'), ...args], { cwd: root, encoding: 'utf8' }));
    // Release the journal lock before CLI subprocesses take ownership.
    await journal.close();
    journalOpen = false;
    const saved = cli(['plan', cliInput, ...shared, '--out', cliPlan]);
    assert.ok(saved.operations.some(op => op.type === 'unlink'));
    assert.equal(cli(['apply', cliPlan, ...shared]).ok, true);
    assert.equal(cli(['drift', cliInput, ...shared]).converged, true);
    cli(['plan', cliInput, ...shared, '--out', cliPlan]);
    assert.equal(cli(['apply', cliPlan, ...shared]).committed, 0);
    return { standardAccountingContext: true, exactRelations: true, companyValues: true, companies, product, accountB, checks: ['real product taxes additive/exact/empty/new-target/stale/unlink-only/preservation/no-op', 'income property A/B/C effective context and undeclared preservation', 'contextual stale refusal, translation coexistence, durable created-account retry', 'actual restricted-user refusal, explicit false and zero-write repeat', 'installed CLI scoped authoring, saved JSON plan/apply/drift and zero-write repeat'] };
  } finally { if (journalOpen) await journal.close(); }
}
