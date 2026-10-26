import { expect, it } from 'vitest';
import { apply, inspectResources, plan, resource, translated } from '../src/index.js';
import type { Row } from '../src/index.js';
import { FakeClient } from './fake-client.js';

/** Models Odoo 18's inactive-en_US mirroring, independently of planner code. */
class InactiveFallbackClient extends FakeClient {
  translations = new Map<string, unknown>();
  writes: { values: Row; context?: Row }[] = [];
  rejectDefault = false;
  constructor() {
    super(); this.schema.x.description = { type: 'text' }; this.schema.x.body = { type: 'html' };
  }
  override async searchRead(model: string, criteria: any[] = [], options: { fields?: string[]; limit?: number; context?: Row } = {}): Promise<Row[]> {
    const rows = await super.searchRead(model, criteria, options);
    const lang = options.context?.lang;
    if (model === 'x' && typeof lang === 'string' && lang !== 'en_US') for (const row of rows) {
      for (const field of options.fields ?? []) row[field] = this.translations.get(`${row.id}:${lang}:${field}`) ?? row[field];
    }
    return rows;
  }
  override async write(model: string, ids: number | number[], values: Row, context?: Row): Promise<boolean> {
    if (model === 'x') {
      this.writes.push({ values: structuredClone(values), context: structuredClone(context) });
      if (this.rejectDefault && context?.lang === false && 'description' in values) throw new Error('default refused');
    }
    const accepted = await super.write(model, ids, values);
    if (model === 'x' && typeof context?.lang === 'string' && context.lang !== 'en_US') {
      for (const id of Array.isArray(ids) ? ids : [ids]) for (const [field, value] of Object.entries(values)) {
        this.translations.set(`${id}:${context.lang}:${field}`, value);
      }
    }
    return accepted;
  }
}
const options = { context: { lang: false, tz: 'Europe/Madrid' } };
const definitions = () => [resource('x', 'test.template', {
  name: 'Stable', description: translated('Default description', { ca_ES: 'Català', en_GB: 'English', es_ES: 'Castellano' }),
  body: translated('<p>Default</p>', { ca_ES: '<p>Català</p>', en_GB: '<p>English</p>', es_ES: '<p>Castellano</p>' }),
})];

it.each([false, true])('preserves exact defaults and three translations (existing=%s), then writes nothing', async existing => {
  const client = new InactiveFallbackClient();
  if (existing) client.seed('x', { name: 'Stable', description: 'Default description', body: '<p>Default</p>' }, 'test.template');
  const connection = client.connection(), input = definitions();
  const reviewed = await plan(input, connection, options);
  const restore = reviewed.operations.at(-1)!;
  expect(restore).toMatchObject({ key: 'test.template:translation-defaults', type: 'update', values: { description: 'Default description', body: '<p>Default</p>' }, context: { ...options.context, active_test: false } });
  const translations = reviewed.operations.filter(op => op.key.includes(':translation:'));
  expect(translations).toHaveLength(6);
  expect(restore.dependsOn).toEqual(expect.arrayContaining(translations.map(op => op.key)));
  const saved: unknown[] = [];
  const result = await apply(reviewed, connection, { journal: { save: async receipt => { saved.push(receipt); } } });
  expect(result.ok).toBe(true);
  expect(saved.length).toBe(existing ? 0 : 3);
  const id = result.drift!.bindings['test.template'];
  for (const lang of [false, 'en_US', 'ca_ES', 'en_GB', 'es_ES']) {
    const [row] = await client.searchRead('x', [['id', '=', id]], { fields: ['description', 'body'], context: { lang } });
    const text = lang === 'ca_ES' ? 'Català' : lang === 'en_GB' ? 'English' : lang === 'es_ES' ? 'Castellano' : 'Default';
    expect(row.description).toBe(text === 'Default' ? 'Default description' : text);
    expect(row.body).toBe(`<p>${text}</p>`);
  }
  const repeated = await apply(await plan(input, connection, options), connection);
  expect(repeated.ok).toBe(true); expect(repeated.committed).toBe(0);
  // Changing just one language affects only that field's default restoration.
  const changed = await inspectResources(input);
  changed.resources[0].translations!.entries.find(e => e.lang === 'en_GB' && e.field === 'body')!.value = '<p>Changed English</p>';
  const correction = await plan(changed, connection, options);
  expect(correction.operations.map(op => op.values)).toEqual([{ body: '<p>Changed English</p>' }, { body: '<p>Default</p>' }]);
  expect((await apply(correction, connection)).ok).toBe(true);
});

it.each([false, true])('default restoration failure blocks full dependents and activation (stopOnError=%s)', async stopOnError => {
  const client = new InactiveFallbackClient();
  client.seed('x', { name: 'Stable', description: 'Default description', body: '<p>Default</p>' }, 'test.template');
  const dependent = client.seed('x', { name: 'Before' }, 'test.dependent');
  const cron = client.seed('ir.cron', { active: true }, 'test.cron');
  const input = [...definitions(), resource('x', 'test.dependent', { name: 'After' }, { dependsOn: ['test.template'] }), resource('ir.cron', 'test.cron', { active: true })];
  const reviewed = await plan(input, client.connection(), options);
  expect(reviewed.operations.find(op => op.externalId === 'test.dependent')!.dependsOn).toContain('test.template:translation-defaults');
  client.rejectDefault = true;
  const result = await apply(reviewed, client.connection(), { stopOnError });
  expect(result.results.find(r => r.operation.key === 'test.template:translation-defaults')?.status).toBe('failed');
  expect(result.results.find(r => r.operation.externalId === 'test.dependent')?.status).toBe('skipped');
  expect(result.results.find(r => r.operation.type === 'activate')?.status).toBe('skipped');
  expect(client.data.x.find(row => row.id === dependent)!.name).toBe('Before');
  expect(client.data['ir.cron'].find(row => row.id === cron)!.active).toBe(false);
  client.rejectDefault = false;
  const retry = await plan(input, client.connection(), options);
  // Translations committed; retry restores the base through ordinary scalar work.
  expect(retry.operations.some(op => op.key.includes(':translation:'))).toBe(false);
  expect((await apply(retry, client.connection())).ok).toBe(true);
});

it('retains durable creation receipts when the final default update fails', async () => {
  const client = new InactiveFallbackClient(); client.rejectDefault = true;
  const input = definitions(), connection = client.connection();
  const result = await apply(await plan(input, connection, options), connection, { journal: { save: async () => {} } });
  expect(result.ok).toBe(false); expect(result.recovery[0]).toMatchObject({ state: 'complete', externalId: 'test.template' });
  const id = result.recovery[0].id;
  client.rejectDefault = false;
  const retry = await plan(input, connection, { ...options, recovery: result.recovery });
  expect(retry.operations.map(op => op.type)).toEqual(['update']);
  expect((await apply(retry, connection)).ok).toBe(true);
  expect(client.data.x.map(row => row.id)).toEqual([id]);
});

it.each([false, 'en_GB'])('rejects contradictory values for an explicit base language %s', async lang => {
  const client = new InactiveFallbackClient();
  const language = typeof lang === 'string' ? lang : 'en_US';
  await expect(plan([resource('x', 'test.template', { name: translated('Base', { [language]: 'Different' }) })], client.connection(), { context: { lang } })).rejects.toMatchObject({ code: 'TRANSLATION_CONFLICT' });
  expect(client.mutations).toEqual([]);
});

it('refuses manually supplied translations without an authored string default', async () => {
  const client = new InactiveFallbackClient();
  const input = await inspectResources(definitions()); delete input.resources[0].values.body;
  await expect(plan(input, client.connection(), options)).rejects.toMatchObject({ code: 'TRANSLATION_UNSUPPORTED' });
});
