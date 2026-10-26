import type { Row } from '@godoo-dev/stateman';
import { FakeClient } from './fake-client.js';

/** Independent context-aware effective-value store. A missing company override
 * reads the fallback; explicit false remains false. Writes affect one company.
 */
export class ScopedClient extends FakeClient {
  effective = new Map<string, unknown>();
  contexts: Row[] = [];
  languages = new Map<string, unknown>();
  hiddenCompany?: number;
  mirrorTranslations = false;
  constructor() {
    super();
    this.schema['res.company'] = { name: { type: 'char' } };
    this.schema['res.users'] = { company_ids: { type: 'many2many', relation: 'res.company' } };
    this.schema.x.items.store = true;
    this.schema.x.property = { type: 'many2one', relation: 'x', company_dependent: true };
    this.schema.x.body = { type: 'html', translate: true };
    this.schema.x.description = { type: 'text', translate: true };
    this.schema['ir.rule'] = { name: { type: 'char' }, 'model_id.model': { type: 'char' }, active: { type: 'boolean' }, perm_read: { type: 'boolean' }, domain_force: { type: 'text' } };
  }
  async searchRead(model: string, criteria: any[] = [], options: { fields?: string[]; limit?: number; context?: Row } = {}): Promise<Row[]> {
    const rows = await super.searchRead(model, criteria, options);
    const company = (options.context?.allowed_company_ids as number[] | undefined)?.[0] ?? 1;
    if (company === this.hiddenCompany && model === 'x') return [];
    return rows.map(row => {
      for (const name of options.fields ?? []) {
        const key = `${model}:${row.id}:${name}:${company}`;
        if (this.schema[model]?.[name]?.company_dependent && this.effective.has(key)) row[name] = this.effective.get(key);
        const langKey = `${model}:${row.id}:${name}:${options.context?.lang}`;
        if (this.languages.has(langKey)) row[name] = this.languages.get(langKey);
      }
      return row;
    });
  }
  async write(model: string, ids: number | number[], values: Row, context: Row = {}): Promise<boolean> {
    const contextual = Object.entries(values).filter(([name]) => this.schema[model][name].company_dependent || context.lang);
    if (!contextual.length) return super.write(model, ids, values);
    const error = this.failure?.('write', model, values); if (error === false) return false; if (error) throw error;
    const company = (context.allowed_company_ids as number[] | undefined)?.[0] ?? 1;
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      for (const [name, value] of contextual) {
        if (this.schema[model][name].company_dependent) this.effective.set(`${model}:${id}:${name}:${company}`, value);
        else {
          this.languages.set(`${model}:${id}:${name}:${context.lang}`, value);
          // Independent inactive-base fixture: contextual translations also
          // overwrite the fallback until the authored default is restored.
          if (this.mirrorTranslations) await super.write(model, id, { [name]: value });
        }
      }
      this.mutations.push({ method: 'write', model, id, values });
      this.contexts.push(context);
    }
    return true;
  }
}

export function scopedStore() {
  const store = new ScopedClient();
  const companies = [store.seed('res.company', { name: 'Company A' }), store.seed('res.company', { name: 'Company B' }), store.seed('res.company', { name: 'Company C' })];
  store.uid = store.seed('res.users', { company_ids: companies });
  return { store, companies, context: { allowed_company_ids: companies, custom: 'base' } };
}
