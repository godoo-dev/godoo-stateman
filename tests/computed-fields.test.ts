import { describe, expect, it } from 'vitest';
import { apply, computedField, lookup, plan, resource } from '../src/index.js';
import type { Row, RecoveryReceipt } from '../src/index.js';
import { fieldFixture } from './fields-client.js';

const values = { name: 'x_allocation', label: 'Allocation', type: 'json' as const, compute: "for record in self:\n    record['x_allocation'] = {'net': 1}\n", depends: ['name'], readonly: true as const, store: false as const };
const field = () => computedField('x', 'test.allocation', values);
const journal = () => { const receipts: RecoveryReceipt[] = []; return { receipts, save: async (receipt: RecoveryReceipt) => { const i = receipts.findIndex(r => r.externalId === receipt.externalId); if (i < 0) receipts.push(receipt); else receipts[i] = receipt; } }; };

describe('protected computed-field resources', () => {
  it('creates, checks readiness, converges, reviews source diff and detects drift', async () => {
    const fake = fieldFixture(), log = journal();
    const input = [field()];
    expect((await apply(await plan(input, fake.connection()), fake.connection(), { journal: log })).ok).toBe(true);
    expect((await plan(input, fake.connection(), { recovery: log.receipts })).operations).toEqual([]);
    const changed = computedField('x', 'test.allocation', { ...values, compute: values.compute.replace('1', '2') });
    const p = await plan([changed], fake.connection());
    expect(p.operations[0].before?.compute).toBe(values.compute);
    expect(p.operations[0].values.compute).toContain("'net': 2");
    fake.data['ir.model.fields'][0].compute = '# manual drift';
    await expect(apply(p, fake.connection())).rejects.toMatchObject({ code: 'STALE_PLAN' });
  });
  it('checks raw resources, all binding modes, identity/storage and deletion', async () => {
    const fake = fieldFixture(), log = journal();
    await apply(await plan([field()], fake.connection()), fake.connection(), { journal: log });
    const id = fake.data['ir.model.fields'][0].id as number;
    for (const changes of [{ store: true }, { ttype: 'text' }, { name: 'x_rename' }, { model_id: 123 }]) {
      await expect(plan([resource('ir.model.fields', 'test.allocation', changes)], fake.connection())).rejects.toBeTruthy();
    }
    await expect(plan([resource('ir.model.fields', 'test.allocation', { compute: false })], fake.connection())).rejects.toMatchObject({ code: 'FIELD_SHAPE_UNSUPPORTED' });
    await expect(plan([], fake.connection(), { removals: [{ externalId: 'test.allocation', model: 'ir.model.fields', id, action: 'delete' }], owned: [{ externalId: 'test.allocation', model: 'ir.model.fields', id }] })).rejects.toMatchObject({ code: 'FIELD_REMOVAL_UNSUPPORTED' });
    fake.data['ir.model.fields'][0].state = 'base';
    await expect(plan([resource('ir.model.fields', 'test.allocation', { field_description: 'Alias' })], fake.connection())).rejects.toMatchObject({ code: 'FIELD_BASE_PROTECTED' });
  });
  it('requires explicit adoption, preserves unrelated fields, validates depends and normalizes commas', async () => {
    const fake = fieldFixture(), log = journal();
    await apply(await plan([field()], fake.connection()), fake.connection(), { journal: log });
    await expect(plan([computedField('x', 'test.other', values)], fake.connection())).rejects.toMatchObject({ code: 'FIELD_NAME_TAKEN' });
    fake.data['ir.model.data'] = [];
    const adopted = computedField('x', 'test.adopted', { ...values, _ref: lookup('ir.model.fields', { model: 'x', name: 'x_allocation' }) });
    const p = await plan([adopted], fake.connection());
    expect(p.operations.map(o => o.type)).toEqual(['adopt']);
    await apply(p, fake.connection());
    expect(fake.data['ir.model.fields']).toHaveLength(1);
    await expect(plan([computedField('x', 'test.adopted', { ...values, depends: ['name.invalid'] })], fake.connection())).rejects.toMatchObject({ code: 'FIELD_DEPENDS_INVALID' });
    fake.data['ir.model.fields'][0].depends = ' name , ';
    expect((await plan([adopted], fake.connection())).operations).toEqual([]);
  });
  it('never projects or filters manual computed values; distinguishes pending and missing schema', async () => {
    const fake = fieldFixture();
    const read = fake.searchRead.bind(fake);
    fake.searchRead = async (model, criteria, options) => {
      if (model === 'x' && (options?.fields?.includes('x_allocation') || criteria?.some(t => t[0] === 'x_allocation'))) throw new Error('Computed Python would execute');
      return read(model, criteria, options);
    };
    const consumer = resource('x', 'test.consumer', { name: 'C', x_allocation: {} });
    await expect(plan([field(), consumer], fake.connection())).rejects.toMatchObject({ code: 'FIELD_PENDING' });
    await expect(plan([consumer], fake.connection())).rejects.toMatchObject({ code: 'FIELD_UNAVAILABLE' });
    await apply(await plan([field()], fake.connection()), fake.connection(), { journal: journal() });
    await expect(plan([consumer], fake.connection())).rejects.toMatchObject({ code: 'COMPUTED_VALUE_UNSUPPORTED' });
    await expect(plan([resource('x', 'test.lookup', { _ref: lookup('x', { x_allocation: 1 }), name: 'X' })], fake.connection())).rejects.toMatchObject({ code: 'COMPUTED_VALUE_UNSUPPORTED' });
  });
  it('retains uncertain create receipts and skips dependent resources when readiness fails', async () => {
    const fake = fieldFixture(), log = journal();
    const call = fake.call.bind(fake);
    let afterCreate = false;
    const create = fake.create.bind(fake);
    fake.create = async (model, values) => { const id = await create(model, values); if (model === 'ir.model.fields') afterCreate = true; return id; };
    fake.call = async <T>(model: string, method: string) => { const result = await call<Row>(model, method); if (model === 'x' && afterCreate) delete result.x_allocation; return result as T; };
    const input = [field(), resource('x', 'test.consumer', { name: 'C' }, { dependsOn: ['test.allocation'] })];
    const result = await apply(await plan(input, fake.connection()), fake.connection(), { journal: log, stopOnError: false });
    expect(result.results.find(r => r.operation.externalId === 'test.allocation')?.status).toBe('failed');
    expect(result.results.find(r => r.operation.externalId === 'test.consumer')?.status).toBe('skipped');
    expect(log.receipts[0]).toMatchObject({ state: 'complete' });
    expect(fake.data['ir.model.fields']).toHaveLength(1);
  });
  it.each([{ readonly: false }, { compute: false }, { store: true }])('refuses to convert an incompatible existing field: %j', async changes => {
    const fake = fieldFixture(), log = journal();
    await apply(await plan([field()], fake.connection()), fake.connection(), { journal: log });
    Object.assign(fake.data['ir.model.fields'][0], changes);
    await expect(plan([field()], fake.connection())).rejects.toMatchObject({ code: 'FIELD_INCOMPATIBLE' });
  });
  it('requires investigation after a committed field create loses its RPC response', async () => {
    const fake = fieldFixture(), log = journal(), create = fake.create.bind(fake);
    fake.create = async (model, values) => {
      const id = await create(model, values);
      if (model === 'ir.model.fields') throw new Error('Lost response after commit');
      return id;
    };
    const input = [field(), resource('x', 'test.consumer', { name: 'Consumer' }, { dependsOn: ['test.allocation'] })];
    const result = await apply(await plan(input, fake.connection()), fake.connection(), { journal: log, stopOnError: false });
    expect(result.ok).toBe(false);
    expect(result.results.find(r => r.operation.externalId === 'test.consumer')?.status).toBe('skipped');
    expect(log.receipts[0]).toMatchObject({ state: 'pending' });
    await expect(plan(input, fake.connection(), { recovery: log.receipts })).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    // Caller investigates the uncertain outcome and supplies the verified ID.
    const verified = { ...log.receipts[0], state: 'record-created' as const, id: fake.data['ir.model.fields'][0].id as number };
    const retry = await plan(input, fake.connection(), { recovery: [verified] });
    expect(retry.operations.some(o => o.model === 'ir.model.fields' && o.type === 'create')).toBe(false);
    fake.create = create;
    expect((await apply(retry, fake.connection(), { journal: log })).ok).toBe(true);
    expect(fake.data['ir.model.fields']).toHaveLength(1);
  });
});
