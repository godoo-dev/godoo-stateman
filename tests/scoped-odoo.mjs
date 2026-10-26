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
    const filtered = await plan(desired(exact([taxA])), connection, scope);
    assert.deepEqual(filtered.operations.find(op => op.type === 'unlink').values, { taxes_id: [[3, hiddenTax, 0]] });
    assert.equal((await apply(filtered, connection)).ok, true);
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
    writeFileSync(cliInput, `import {resource,exact,companyValues} from '@godoo-dev/stateman'; export const service=resource('product.template','stateman_scope.service',{taxes_id:exact([${taxA}]),property_account_income_id:companyValues([{company:${companyB},value:false}])});`);
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
    return { exactRelations: true, companyValues: true, companies, product, accountB, checks: ['real product taxes additive/exact/empty/new-target/stale/unlink-only/preservation/no-op', 'income property A/B/C effective context and undeclared preservation', 'contextual stale refusal, translation coexistence, durable created-account retry', 'actual restricted-user refusal, explicit false and zero-write repeat', 'installed CLI scoped authoring, saved JSON plan/apply/drift and zero-write repeat'] };
  } finally { if (journalOpen) await journal.close(); }
}
