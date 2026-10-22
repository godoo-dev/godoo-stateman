import { expect, it } from 'vitest';
import { apply, lookup, plan, resource, translated } from '../src/index.js';
import { FakeClient } from './fake-client.js';

it('pauses an active cron requested disabled before changing its action dependencies', async () => {
  const client = new FakeClient();
  client.seed('ir.actions.server', { code: 'old' }, 'review.action_a');
  client.seed('ir.actions.server', { code: 'old' }, 'review.action_b');
  const cron = client.seed('ir.cron', { active: true }, 'review.cron');
  const defs = [resource('ir.actions.server', 'review.action_a', { code: 'new' }), resource('ir.actions.server', 'review.action_b', { code: 'refused' }), resource('ir.cron', 'review.cron', { active: false }, { dependsOn: ['review.action_a', 'review.action_b'] })];
  const reviewed = await plan(defs, client.connection());
  expect(reviewed.operations[0]).toMatchObject({ type: 'deactivate', externalId: 'review.cron' });
  client.failure = (_method, _model, values) => values?.code === 'refused' ? new Error('refused') : undefined;
  const result = await apply(reviewed, client.connection());
  expect(result.ok).toBe(false);
  expect(client.data['ir.cron'].find(row => row.id === cron)?.active).toBe(false);
  expect(client.mutations[0]).toMatchObject({ model: 'ir.cron', values: { active: false } });
});

it('waits for a prerequisite relation-only change and skips the dependent on failure', async () => {
  const client = new FakeClient();
  const tag = client.seed('x', { name: 'Target' });
  client.seed('x', { name: 'Prerequisite' }, 'review.prerequisite');
  const child = client.seed('x', { name: 'Before' }, 'review.dependent');
  const independent = client.seed('x', { name: 'Before' }, 'review.z_independent');
  const reviewed = await plan([resource('x', 'review.prerequisite', { items: [tag] }), resource('x', 'review.dependent', { name: 'After' }, { dependsOn: ['review.prerequisite'] }), resource('x', 'review.z_independent', { name: 'After' })], client.connection());
  client.failure = (_method, _model, values) => values?.items ? new Error('relation refused') : undefined;
  const result = await apply(reviewed, client.connection(), { stopOnError: false });
  expect(result.results.find(r => r.operation.externalId === 'review.dependent')?.status).toBe('skipped');
  expect(client.data.x.find(row => row.id === child)?.name).toBe('Before');
  expect(client.data.x.find(row => row.id === independent)?.name).toBe('After');
});

it.each(['pending', 'record-created', 'complete'])('hard-halts on %s journal failure even when independent work may continue', async state => {
  const client = new FakeClient();
  const existing = client.seed('x', { name: 'Before' }, 'review.z_existing');
  const error = new Error('durable storage unavailable');
  const reviewed = await plan([resource('x', 'review.a_new', { name: 'New' }), resource('x', 'review.z_existing', { name: 'After' })], client.connection());
  const result = await apply(reviewed, client.connection(), { stopOnError: false, journal: { save: async receipt => { if (receipt.state === state) throw error; } } });
  expect(result.ok).toBe(false);
  expect(result.results[0].error).toBe(error);
  expect(result.results[1].status).toBe('skipped');
  expect(client.data.x.find(row => row.id === existing)?.name).toBe('Before');
  if (state !== 'pending') expect(result.recovery[0].id).toBeGreaterThan(0);
});

it('binds identical lookup observations independently of parallel response timing', async () => {
  const client = new FakeClient();
  client.seed('x', { name: 'A' }); client.seed('x', { name: 'B' });
  client.seed('x', {}, 'review.parent');
  const read = client.searchRead.bind(client);
  let delayed = 'A';
  client.searchRead = async (model, criteria = [], options = {}) => {
    if (criteria.some(([key, , value]) => key === 'name' && value === delayed)) await new Promise(resolve => setTimeout(resolve, 10));
    return read(model, criteria, options);
  };
  const defs = [resource('x', 'review.parent', { items: [lookup('x', { name: 'A' }), lookup('x', { name: 'B' })] })];
  const reviewed = await plan(defs, client.connection());
  delayed = 'B';
  expect(await plan(defs, client.connection())).toEqual(reviewed);
  expect((await apply(reviewed, client.connection())).ok).toBe(true);
});


it('waits for deferred contextual translation before a dependent update', async () => {
  const client = new FakeClient();
  client.seed('x', { name: 'Before' }, 'review.prerequisite');
  const dependent = client.seed('x', { name: 'Before' }, 'review.dependent');
  const defs = [resource('x', 'review.prerequisite', { name: translated('Before', { en_US: 'Translated' }) }), resource('x', 'review.dependent', { name: 'After' }, { dependsOn: ['review.prerequisite'] })];
  const reviewed = await plan(defs, client.connection());
  client.failure = (_method, _model, values) => values?.name === 'Translated' ? new Error('translation refused') : undefined;
  const result = await apply(reviewed, client.connection(), { stopOnError: false });
  expect(result.results.find(r => r.operation.externalId === 'review.dependent')?.status).toBe('skipped');
  expect(client.data.x.find(row => row.id === dependent)?.name).toBe('Before');
});

it('shares in-flight schema discovery for parallel lookups of another model', async () => {
  const client = new FakeClient();
  client.seed('x', {}, 'review.parent');
  client.seed('document.page.tag', { name: 'A' }); client.seed('document.page.tag', { name: 'B' });
  const call = client.call.bind(client);
  let metadataReads = 0;
  client.call = async (model, method) => {
    if (model === 'document.page.tag') { metadataReads++; await new Promise(resolve => setTimeout(resolve, 5)); }
    return call(model, method);
  };
  await plan([resource('x', 'review.parent', { payload: [lookup('document.page.tag', { name: 'A' }), lookup('document.page.tag', { name: 'B' })] })], client.connection());
  expect(metadataReads).toBe(1);
});
