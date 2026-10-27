import { companyValues, exact, lookup, resource, translated } from '@godoo-dev/stateman';
import type { Row } from '@godoo-dev/stateman';
import { ScopedClient } from './scoped-client.js';

/** Fictional catalog; counts physical calls at the client boundary, without caching. */
export function planningWorkload(size: number) {
  const store = new ScopedClient();
  const companies = Array.from({ length: 9 }, (_, i) => store.seed('res.company', { name: `Company ${i}` }));
  store.uid = store.seed('res.users', { company_ids: companies });
  const properties = Array.from({ length: 7 }, (_, i) => `property_${i}`);
  store.schema['catalog.product'] = {
    name: { type: 'char', translate: true },
    taxes: { type: 'many2many', relation: 'catalog.tax', store: true },
    suggestions: { type: 'many2many', relation: 'catalog.product', store: true },
    ...Object.fromEntries(properties.map((name, i) => [name, i < 4
      ? { type: 'many2one', relation: 'catalog.account', company_dependent: true }
      : { type: 'float', company_dependent: true }])),
  };
  store.schema['catalog.tax'] = { name: { type: 'char' }, company_id: { type: 'many2one', relation: 'res.company' } };
  store.schema['catalog.account'] = { name: { type: 'char' } };
  const account = store.seed('catalog.account', { name: 'Shared account' });
  const taxes = companies.map((company, i) => store.seed('catalog.tax', { name: `Tax ${i}`, company_id: company }));
  const ids: number[] = [];
  const definitions = Array.from({ length: size }, (_, i) => {
    const name = `Product ${i}`;
    ids.push(store.seed('catalog.product', {
      name, taxes, ...Object.fromEntries(properties.map((p, index) => [p, index < 4 ? account : index])),
    }, `catalog.product_${i}`));
    return resource('catalog.product', `catalog.product_${i}`, {
      name: translated(name, { es_ES: `Producto ${i}`, ca_ES: `Producte ${i}` }),
      taxes: exact(taxes.map(id => lookup('catalog.tax', { id }))), suggestions: exact([]),
      ...Object.fromEntries(properties.map((p, index) => [p, companyValues(companies.map((_, c) => ({
        company: lookup('res.company', { name: `Company ${c}` }),
        value: index < 4 ? lookup('catalog.account', { name: 'Shared account' }) : index,
      })))])),
    });
  });
  for (const [i, id] of ids.entries()) for (const [lang, prefix] of [['es_ES', 'Producto'], ['ca_ES', 'Producte']]) {
    store.languages.set(`catalog.product:${id}:name:${lang}`, `${prefix} ${i}`);
  }
  const calls: { model: string; domain: any[]; fields: string[]; context: Row; limit?: number; order?: string }[] = [];
  const schemas: string[] = [];
  const read = store.searchRead.bind(store), call = store.call.bind(store);
  store.searchRead = async (model, domain = [], options = {}) => {
    calls.push(JSON.parse(JSON.stringify({ model, domain, ...options })));
    return read(model, domain, options);
  };
  store.call = async <T = unknown>(model: string, method: string) => { schemas.push(model); return call<T>(model, method); };
  return { store, definitions, companies, ids, calls, schemas, properties, options: { context: { allowed_company_ids: companies, lang: false, custom: 'preserve' } } };
}
