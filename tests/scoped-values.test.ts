import { describe, expect, it } from 'vitest';
import { apply, companyValues, exact, inspectResources, lookup, plan, ref, resource, translated } from '@godoo-dev/stateman';
import { scopedAcceptance } from './scoped-acceptance.js';
import { scopedStore } from './scoped-client.js';

describe('scoped relation and company values', () => {
  it('reconciles exact sets and company values through failure/recovery', scopedAcceptance);
  it.each(['missing-context', 'partial-companies', 'field-context', 'record-rule', 'target-hidden', 'non-m2m', 'competing-context'] as const)('refuses unsafe exact visibility: %s', async kind => {
    const { store, companies, context } = scopedStore();
    const target = store.seed('x', {});
    store.seed('x', { items: [target] }, 'scope.root');
    let options = { context };
    let field = 'items';
    if (kind === 'missing-context') options = { context: {} as typeof context };
    if (kind === 'partial-companies') options.context = { ...context, allowed_company_ids: [companies[0]] };
    if (kind === 'field-context') store.schema.x.items.context = { allowed_company_ids: [companies[0]] };
    if (kind === 'record-rule') store.seed('ir.rule', { name: 'Hidden rows', 'model_id.model': 'x', active: true, perm_read: true, domain_force: "[('name','=','Visible')]" });
    if (kind === 'target-hidden') store.data.x = store.data.x.filter(row => row.id !== target);
    if (kind === 'non-m2m') field = 'parent_id';
    if (kind === 'competing-context') Object.assign(options.context, { force_company: companies[0] });
    await expect(plan([resource('x', 'scope.root', { [field]: exact([]) })], store.connection(), options)).rejects.toMatchObject({ code: kind === 'non-m2m' ? 'EXACT_UNSUPPORTED' : 'EXACT_VISIBILITY' });
    expect(store.mutations).toHaveLength(0);
  });
  it('accepts only supported company rules and refuses stale authorization/rules', async () => {
    const { store, companies, context } = scopedStore();
    const target = store.seed('x', {});
    store.seed('x', { items: [target] }, 'scope.root');
    const rule = store.seed('ir.rule', { name: 'Company', 'model_id.model': 'x', active: true, perm_read: true, domain_force: "['|', ('company_id', '=', False), ('company_id', 'parent_of', company_ids)]" });
    const desired = [resource('x', 'scope.root', { items: exact([]) })];
    const reviewed = await plan(desired, store.connection(), { context });
    store.data['ir.rule'].find(row => row.id === rule)!.domain_force = '[]';
    await expect(apply(reviewed, store.connection())).rejects.toMatchObject({ code: 'STALE_PLAN' });
    store.data['res.users'][0].company_ids = [companies[0]];
    await expect(apply(reviewed, store.connection())).rejects.toMatchObject({ code: 'EXACT_VISIBILITY' });
  });
  it.each(['not-dependent', 'translated', 'duplicate', 'unauthorized', 'missing', 'ambiguous', 'hidden', 'new-company', 'nested', 'null', 'context', 'required-create'] as const)('refuses unsupported company values: %s', async kind => {
    const { store, companies, context } = scopedStore();
    const target = store.seed('x', {});
    store.seed('x', { property: target }, 'scope.root');
    let company: unknown = companies[1], value: unknown = target;
    let field = 'property';
    let entries: { company: any; value: unknown }[];
    let definitions = [];
    if (kind === 'not-dependent') field = 'parent_id';
    if (kind === 'translated') store.schema.x.property.translate = true;
    if (kind === 'unauthorized') store.data['res.users'][0].company_ids = [companies[0]];
    if (kind === 'missing') company = lookup('res.company', { name: 'Missing' });
    if (kind === 'ambiguous') { store.seed('res.company', { name: 'Company A' }); company = lookup('res.company', { name: 'Company A' }); }
    if (kind === 'hidden') store.hiddenCompany = companies[1];
    if (kind === 'new-company') { definitions.push(resource('res.company', 'scope.newcompany', { name: 'New company' })); company = ref('scope.newcompany'); }
    if (kind === 'nested') value = exact([]);
    if (kind === 'null') value = null;
    if (kind === 'context') Object.assign(context, { force_company: companies[0] });
    if (kind === 'required-create') { store.schema.x.property.required = true; store.data['ir.model.data'] = []; }
    entries = [{ company, value }];
    if (kind === 'duplicate') entries.push({ company, value });
    definitions.push(resource('x', 'scope.root', { [field]: companyValues(entries) }));
    await expect(plan(definitions, store.connection(), { context })).rejects.toBeInstanceOf(Error);
    expect(store.mutations).toHaveLength(0);
  });
  it('rejects nested company translations and translated company metadata before writes', async () => {
    await expect(inspectResources([resource('x', 'scope.root', { property: companyValues([{ company: 1, value: translated('Text', { es_ES: 'Texto' }) }]) })])).rejects.toThrow('translated() must be a direct');
    const { store } = scopedStore();
    store.schema.x.description.company_dependent = true;
    await expect(plan([resource('x', 'scope.root', { description: translated('Text', { es_ES: 'Texto' }) })], store.connection())).rejects.toMatchObject({ code: 'COMPANY_VALUE_UNSUPPORTED' });
  });
  it('includes company resources and newly created targets in selection and full readiness', async () => {
    const { store, companies, context } = scopedStore();
    store.seed('res.company', { name: 'Company managed' }, 'scope.company');
    const managedCompany = store.data['res.company'].find(row => row.name === 'Company managed')!.id as number;
    store.data['res.users'][0].company_ids = [...companies, managedCompany];
    const desired = [resource('res.company', 'scope.company', { name: 'Company managed' }), resource('x', 'scope.account', { name: 'Account' }), resource('x', 'scope.root', { property: companyValues([{ company: ref('scope.company'), value: ref('scope.account') }]) }), resource('x', 'scope.dependent', { name: 'Dependent' }, { dependsOn: ['scope.root'] })];
    const reviewed = await plan(desired, store.connection(), { select: ['scope.dependent'], context: { ...context, allowed_company_ids: [...companies, managedCompany] } });
    expect(reviewed.resources).toHaveLength(4);
    const dependent = reviewed.operations.find(op => op.externalId === 'scope.dependent')!;
    expect(dependent.dependsOn).toContain(`scope.root:company:property:${managedCompany}`);
    const receipts: any[] = [];
    store.failure = (_method, _model, values) => values?.property ? new Error('denied') : undefined;
    const failed = await apply(reviewed, store.connection(), { journal: { save: async receipt => { receipts.push(receipt); } }, stopOnError: false });
    expect(failed.results.find(result => result.operation.externalId === 'scope.dependent')?.status).toBe('skipped');
  });
});

it('refuses hidden relation-read links independently of field domains', async () => {
  const { store, context } = scopedStore();
  const a = store.seed('x', {}), b = store.seed('x', {});
  store.seed('x', { items: [a, b] }, 'scope.root');
  store.schema.x.items.domain = "company_id and [('company_id', '=', company_id)] or []";
  const read = store.searchRead.bind(store);
  store.searchRead = async (model, domain, options) => {
    const rows = await read(model, domain, options);
    if (model === 'x' && options?.fields?.includes('items')) for (const row of rows) row.items = [a];
    return rows;
  };
  for (const domain of ["[('name','=','Filtered')]", [['name', '=', 'Filtered']]]) {
    store.schema.x.items.domain = domain;
    await expect(plan([resource('x', 'scope.root', { items: exact([a]) })], store.connection(), { context })).rejects.toMatchObject({ code: 'EXACT_VISIBILITY', message: expect.stringContaining(String(b)) });
  }
  expect(store.mutations).toHaveLength(0);
});

it('preserves links outside the authorized company partition and retries partial unlinks', async () => {
  const { store, companies, context } = scopedStore();
  store.schema.x.company_id = { type: 'many2one', relation: 'res.company' };
  const foreignCompany = store.seed('res.company', { name: 'Outside authorized scope' });
  const shared = store.seed('x', {}), extra = store.seed('x', { company_id: companies[0] }), foreign = store.seed('x', { company_id: foreignCompany });
  const root = store.seed('x', { items: [extra, foreign] }, 'scope.root');
  const desired = [resource('x', 'scope.root', { items: exact([shared]) })];
  const reviewed = await plan(desired, store.connection(), { context });
  expect(reviewed.operations.map(op => op.type)).toEqual(['link', 'unlink']);
  store.failure = (_method, _model, values) => (values?.items as number[][] | undefined)?.[0][0] === 3 ? new Error('unlink refused') : undefined;
  const partial = await apply(reviewed, store.connection());
  expect(partial.ok).toBe(false);
  expect(store.data.x.find(row => row.id === root)?.items).toEqual([extra, foreign, shared]);
  store.failure = undefined;
  const retry = await apply(await plan(desired, store.connection(), { context }), store.connection());
  expect(retry.ok).toBe(true);
  expect(store.data.x.find(row => row.id === root)?.items).toEqual([foreign, shared]);
  expect(store.data.x.find(row => row.id === extra)).toBeDefined();
});

it('suppresses server M2M defaults only for exact creates', async () => {
  const { store, context } = scopedStore();
  const defaultTarget = store.seed('x', { name: 'Server default' });
  const seed = store.seed.bind(store);
  store.seed = (model, values, externalId) => seed(model, model === 'x' ? { items: [defaultTarget], ...values } : values, externalId);
  const receipts: any[] = [];
  const journal = { save: async (receipt: any) => { receipts.push(receipt); } };
  for (const [id, value, expected] of [['scope.exact', exact([]), []], ['scope.additive', [], [defaultTarget]]] as const) {
    const result = await apply(await plan([resource('x', id, { items: value })], store.connection(), { context }), store.connection(), { journal });
    expect(result.ok).toBe(true);
    const record = result.drift!.bindings[id];
    expect(store.data.x.find(row => row.id === record)!.items).toEqual(expected);
  }
  expect(store.data.x.find(row => row.id === defaultTarget)).toBeDefined();
});
