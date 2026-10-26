import type { FieldMetadata, Row, Schema, StateClient, StateConnection } from '@godoo-dev/stateman';

const scalar = (type: string): FieldMetadata => ({ type });
export const fakeSchema: Schema = {
  'project.project': { name: scalar('char'), active: scalar('boolean'), type_ids: { type: 'many2many', relation: 'project.task.type' }, task_ids: { type: 'one2many', relation: 'project.task', relation_field: 'project_id' }, payload: scalar('json') },
  'project.task': { name: scalar('char'), project_id: { type: 'many2one', relation: 'project.project', required: true } },
  'project.task.type': { name: scalar('char'), sequence: scalar('integer'), project_ids: { type: 'many2many', relation: 'project.project' } },
  'ir.actions.server': { name: scalar('char'), code: scalar('text'), state: scalar('selection') },
  'ir.cron': { name: scalar('char'), active: scalar('boolean'), ir_actions_server_id: { type: 'many2one', relation: 'ir.actions.server', required: true } },
  'document.page': { name: scalar('char'), content: scalar('html'), parent_id: { type: 'many2one', relation: 'document.page' }, tag_ids: { type: 'many2many', relation: 'document.page.tag' } },
  'document.page.tag': { name: scalar('char') },
  x: { name: scalar('char'), active: scalar('boolean'), parent_id: { type: 'many2one', relation: 'x' }, items: { type: 'many2many', relation: 'x' }, payload: scalar('json'), state: scalar('selection') },
  'ir.model.data': { module: scalar('char'), name: scalar('char'), model: scalar('char'), res_id: scalar('integer'), noupdate: scalar('boolean') },
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Small independent in-memory Odoo simulation; no planner imports or RPC service. */
export class FakeClient implements StateClient {
  data: Record<string, Row[]> = {};
  schema = clone(fakeSchema);
  mutations: { method: string; model: string; id: number; values?: Row }[] = [];
  events: string[] = [];
  nextId = 1;
  failure?: (method: string, model: string, values?: Row) => unknown;
  schemaError?: Error;
  uid = 7;
  version = '18.0';
  connection(): StateConnection {
    return { client: this, identity: async () => ({ url: 'http://fake.test/', database: 'fixture', uid: this.uid }),
      serverInfo: async () => ({ version: this.version }),
      inspectAddons: async names => ({ closureComplete: true, modules: names.map(name => ({ name, status: 'installed', state: 'installed', dependencies: [] })), diagnostics: [] }) };
  }
  seed(model: string, values: Row, externalId?: string): number {
    const id = this.nextId++;
    const row: Row = { id };
    for (const [name, field] of Object.entries(this.schema[model])) row[name] = ['many2many', 'one2many'].includes(field.type) ? [] : field.type === 'boolean' ? true : false;
    Object.assign(row, clone(values)); (this.data[model] ??= []).push(row);
    if (externalId) {
      const dot = externalId.indexOf('.');
      this.seed('ir.model.data', { module: externalId.slice(0, dot), name: externalId.slice(dot + 1), model, res_id: id, noupdate: true });
    }
    return id;
  }
  async call<T = unknown>(model: string, method: string): Promise<T> {
    if (method !== 'fields_get') throw new Error(`Unexpected non-read method ${method}`);
    if (this.schemaError) throw this.schemaError;
    if (!this.schema[model]) throw new Error(`Unknown model ${model}`);
    return clone(this.schema[model]) as T;
  }
  async searchRead(model: string, criteria: any[] = [], options: { fields?: string[]; limit?: number; context?: Row } = {}): Promise<Row[]> {
    const rows = (this.data[model] ?? []).filter(row => criteria.every(([field, operator, expected]) => {
      const actual = row[field];
      if (operator === '=') return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
      if (operator === 'in') return Array.isArray(actual) ? actual.some(value => expected.includes(value)) : expected.includes(actual);
      throw new Error(`Unsupported fake domain ${operator}`);
    })).slice(0, options.limit);
    return rows.map(row => Object.fromEntries(['id', ...(options.fields ?? Object.keys(row))].map(name => [name, clone(row[name] ?? false)])));
  }
  async create(model: string, values: Row): Promise<number> {
    this.events.push(`create:${model}`);
    const error = this.failure?.('create', model, values); if (error) throw error;
    if (values.state === 'invalid') throw new Error('Invalid selection value');
    const id = this.seed(model, {});
    this.assign(model, id, values);
    this.mutations.push({ method: 'create', model, id, values: clone(values) });
    return id;
  }
  async write(model: string, ids: number | number[], values: Row): Promise<boolean> {
    this.events.push(`write:${model}`);
    const error = this.failure?.('write', model, values); if (error === false) return false; if (error) throw error;
    if (values.state === 'invalid') throw new Error('Invalid selection value');
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      this.assign(model, id, values);
      this.mutations.push({ method: 'write', model, id, values: clone(values) });
    }
    return true;
  }
  assign(model: string, id: number, values: Row): void {
    const row = this.data[model].find(row => row.id === id)!;
    for (const [field, value] of Object.entries(values)) {
      if (['many2many', 'one2many'].includes(this.schema[model][field].type)) {
        const links = new Set(row[field] as number[]);
        for (const [command, target] of value as number[][]) {
          if (command === 6) { links.clear(); continue; } // Empty initial membership on an exact create.
          if (command === 4) links.add(target); else if (command === 3) links.delete(target); else throw new Error('Unexpected relation command');
          // Simulate the real project/stage inverse relation independently.
          const inverse = model === 'project.project' && field === 'type_ids' ? ['project.task.type', 'project_ids'] : model === 'project.task.type' && field === 'project_ids' ? ['project.project', 'type_ids'] : null;
          if (inverse) {
            const remote = this.data[inverse[0]].find(row => row.id === target)!;
            const remoteIds = new Set(remote[inverse[1]] as number[]);
            if (command === 4) remoteIds.add(id); else remoteIds.delete(id);
            remote[inverse[1]] = [...remoteIds];
          }
        }
        row[field] = [...links];
      } else {
        row[field] = clone(value);
        if (model === 'project.task' && field === 'project_id') {
          for (const project of this.data['project.project'] ?? []) {
            const tasks = new Set(project.task_ids as number[]);
            if (project.id === value) tasks.add(id); else tasks.delete(id);
            project.task_ids = [...tasks];
          }
        }
      }
    }
  }
  async unlink(model: string, ids: number | number[]): Promise<boolean> {
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      const error = this.failure?.('unlink', model); if (error) throw error;
      this.data[model] = this.data[model].filter(row => row.id !== id);
      this.data['ir.model.data'] = (this.data['ir.model.data'] ?? []).filter(row => row.model !== model || row.res_id !== id);
      this.mutations.push({ method: 'unlink', model, id });
    }
    return true;
  }
}
