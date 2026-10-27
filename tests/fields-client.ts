import type { Row } from '@godoo-dev/stateman';
import { FakeClient } from './fake-client.js';

export function fieldFixture(): FakeClient {
  const fake = new FakeClient();
  fake.schema['ir.model'] = { model: { type: 'char' } };
  fake.schema['ir.model.fields'] = Object.fromEntries(['model', 'name', 'state', 'modules', 'ttype', 'compute', 'depends', 'relation', 'related', 'field_description', 'help'].map(name => [name, { type: 'char' }]));
  Object.assign(fake.schema['ir.model.fields'], { model_id: { type: 'many2one', relation: 'ir.model' }, store: { type: 'boolean' }, readonly: { type: 'boolean' }, company_dependent: { type: 'boolean' }, translate: { type: 'boolean' } });
  fake.seed('ir.model', { model: 'x' });
  const originalCreate = fake.create.bind(fake);
  fake.create = async (model, values) => {
    if (model === 'ir.model.fields') {
      const target = fake.data['ir.model'].find(r => r.id === values.model_id)!.model as string;
      values = { modules: false, related: false, relation: false, company_dependent: false, translate: false, ...values, model: target };
      fake.schema[target][values.name as string] = { type: values.ttype as string, store: values.store as boolean, readonly: values.readonly as boolean };
    }
    return originalCreate(model, values);
  };
  return fake;
}
