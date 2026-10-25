import { describe, expect, it } from 'vitest';
import { OdooAccessError, OdooNetworkError, OdooSafetyError } from '@godoo-dev/client';
import { apply, children, drift, inspectResources, lookup, plan, ref, resource } from '../src/index.js';
import type { RecoveryReceipt, ResourceDefinition } from '../src/index.js';
import { FakeClient } from './fake-client.js';

function journal(client: FakeClient) {
  const receipts = new Map<string, RecoveryReceipt>();
  return { receipts, async save(receipt: RecoveryReceipt) {
    client.events.push(`save:${receipt.state}`); receipts.set(receipt.externalId, structuredClone(receipt));
  } };
}
function representative(): ResourceDefinition[] {
  const category = resource('document.page', 'fixture.category', { name: 'Category' });
  const tag = resource('document.page.tag', 'fixture.tag', { name: 'Managed tag' });
  const action = resource('ir.actions.server', 'fixture.action', { name: 'Action', state: 'code', code: "env.ref('fixture.project')" }, { dependsOn: ['fixture.project'] });
  const nested = resource('ir.actions.server', 'action', { name: 'Cron action', state: 'code', code: "env.ref('fixture.action')" }, { dependsOn: ['fixture.action'] });
  return [resource('project.project', 'fixture.project', { name: 'Project', type_ids: children('project.task.type', 'project_ids', [
    resource('project.task.type', 'ready', { name: 'Ready', sequence: 1 }, { onMissing: 'create' }),
  ]) }), resource('ir.cron', 'fixture.cron', { name: 'Cron', active: true, ir_actions_server_id: nested }),
  action, resource('document.page', 'fixture.page', { name: 'Page', content: '<p>Body</p>', parent_id: category, tag_ids: [tag, lookup('document.page.tag', { name: 'Manual tag' })] })];
}

describe('concrete resource planning and convergence', () => {
  it('is deterministic/read-only and applies real nested/inverse/list relations before final cron activation', async () => {
    const client = new FakeClient(); client.seed('document.page.tag', { name: 'Manual tag' });
    const resources = representative(), connection = client.connection(), sink = journal(client);
    const reviewed = await plan(resources, connection, { requiredAddons: ['project'] });
    expect(await plan([...resources].reverse(), connection, { requiredAddons: ['project'] })).toEqual(reviewed);
    expect(client.mutations).toEqual([]);
    expect(reviewed.operations.at(-1)?.type).toBe('activate');
    expect(reviewed.operations.filter(op => op.type === 'create').every(op => !op.id)).toBe(true);
    const result = await apply(JSON.parse(JSON.stringify(reviewed)), connection, { journal: sink });
    expect(result.ok, result.results.filter(r => r.status === 'failed').map(r => r.message).join('\n')).toBe(true);
    expect(result.drift?.operations).toEqual([]);
    expect(client.events.slice(0, 4)).toEqual(['save:pending', 'create:project.project', 'save:record-created', 'create:ir.model.data']);
    expect(client.mutations.at(-1)).toMatchObject({ model: 'ir.cron', values: { active: true } });
    const project = client.data['project.project'][0], stage = client.data['project.task.type'][0];
    expect(project.type_ids).toEqual([stage.id]); expect(stage.project_ids).toEqual([project.id]);
    expect(client.data['document.page'].find(row => row.name === 'Page')?.tag_ids).toHaveLength(2);
    const before = client.mutations.length;
    const again = await apply(await plan(resources, connection), connection);
    expect(again.ok).toBe(true); expect(client.mutations).toHaveLength(before);
    const inspection = await inspectResources(resources);
    inspection.resources.find(r => r.externalId === 'fixture.page')!.values.name = 'Updated';
    const changed = await plan(inspection, connection);
    expect(changed.operations.map(op => op.type)).toEqual(['deactivate', 'update', 'activate']);
    expect((await apply(changed, connection)).ok).toBe(true);
    expect((await drift(inspection, connection)).converged).toBe(true);
  });
  it('resolves same-model and recursive JSON references without changing symbolic input', async () => {
    const client = new FakeClient(), sink = journal(client);
    const defs = [resource('x', 'fixture.root', { name: 'Root' }), resource('x', 'fixture.child', { name: 'Child', parent_id: ref('fixture.root'), payload: { nested: [ref('fixture.root')] }, items: [ref('fixture.root')] })];
    const result = await apply(await plan(defs, client.connection()), client.connection(), { journal: sink });
    expect(result.ok).toBe(true);
    const [root, child] = client.data.x;
    expect(child.parent_id).toBe(root.id); expect(child.payload).toEqual({ nested: [root.id] }); expect(child.items).toEqual([root.id]);
  });
  it('includes subset closure and rejects missing definitions and cycles before writes', async () => {
    const client = new FakeClient();
    const defs = [resource('x', 'fixture.b', { parent_id: ref('fixture.a') }, { dependsOn: ['fixture.c'] }), resource('x', 'fixture.a', {}), resource('x', 'fixture.c', {}), resource('x', 'fixture.unrelated', {})];
    expect((await plan(defs, client.connection(), { select: ['fixture.b'] })).order).toEqual(['fixture.a', 'fixture.c', 'fixture.b']);
    await expect(plan([defs[0]], client.connection())).rejects.toMatchObject({ code: 'MISSING_DEPENDENCY' });
    await expect(plan([resource('x', 'fixture.a', { parent_id: ref('fixture.b') }), resource('x', 'fixture.b', { parent_id: ref('fixture.a') })], client.connection())).rejects.toMatchObject({ code: 'RESOURCE_CYCLE' });
    expect(client.mutations).toEqual([]);
  });
  it('creates required M2O inverses before linking O2M children and scopes adoption to the actual parent', async () => {
    const client = new FakeClient();
    const other = client.seed('project.project', { name: 'Other' });
    const manual = client.seed('project.task', { name: 'Same', project_id: other });
    const defs = [resource('project.project', 'fixture.project', { name: 'Project', task_ids: children('project.task', 'project_id', [
      resource('project.task', 'task', { _ref: lookup('project.task', { name: 'Same' }), name: 'Same' }, { onMissing: 'create' }),
    ]) })];
    const result = await apply(await plan(defs, client.connection()), client.connection(), { journal: journal(client) });
    expect(result.ok).toBe(true); expect(client.data['project.task']).toHaveLength(2);
    const managed = client.data['project.task'].find(row => row.id !== manual)!;
    expect(managed.project_id).not.toBe(other);
    expect((await plan(defs, client.connection())).operations).toEqual([]);
    await expect(plan(defs, client.connection(), { unlink: [{ externalId: 'fixture.project', field: 'task_ids', ids: [managed.id as number] }] })).rejects.toMatchObject({ code: 'UNLINK_UNSAFE' });
  });
  it('fails schema/version/addon preflight and distinguishes denied metadata from absence or transport', async () => {
    const client = new FakeClient(), defs = [resource('x', 'fixture.x', { unknown: 'value' })];
    await expect(plan(defs, client.connection())).rejects.toMatchObject({ code: 'FIELD_UNAVAILABLE' });
    const denied = new OdooAccessError('metadata denied'); client.schemaError = denied;
    await expect(plan([resource('x', 'fixture.x', {})], client.connection())).rejects.toMatchObject({ code: 'METADATA_INACCESSIBLE', cause: denied });
    const network = new OdooNetworkError('disconnected', new Error('offline')); client.schemaError = network;
    await expect(plan([resource('x', 'fixture.x', {})], client.connection())).rejects.toBe(network);
    client.schemaError = undefined; client.version = '19.0';
    await expect(plan([], client.connection())).rejects.toMatchObject({ code: 'VERSION_UNSUPPORTED' });
    await expect(plan([], client.connection(), { odooMajorVersions: [19] })).resolves.toMatchObject({ operations: [] });
    client.version = '17.0';
    await expect(plan([], client.connection(), { odooMajorVersions: [17] })).rejects.toMatchObject({ code: 'VERSION_UNSUPPORTED' });
    client.version = '18.0';
    const connection = client.connection(); delete connection.inspectAddons;
    await expect(plan([], connection, { requiredAddons: ['project'] })).rejects.toMatchObject({ code: 'ADDON_INSPECTION_UNAVAILABLE' });
    connection.inspectAddons = async () => ({ closureComplete: false, modules: [{ name: 'project', status: 'inaccessible', dependencies: null }], diagnostics: [{ code: 'access-denied', message: 'permission unknown' }] });
    await expect(plan([], connection, { requiredAddons: ['project'] })).rejects.toThrow('inaccessible');
    expect(client.mutations).toEqual([]);
  });
});

describe('identity, adoption and ownership', () => {
  it('requires explicit create-on-missing, rejects ambiguity/model collisions and duplicate record claims', async () => {
    const client = new FakeClient();
    const declaration = resource('x', 'fixture.x', { _ref: lookup('x', { name: 'Existing' }), name: 'Existing' });
    await expect(plan([declaration], client.connection())).rejects.toMatchObject({ code: 'LOOKUP_MISSING' });
    expect((await plan([resource('x', 'fixture.x', { _ref: lookup('x', { name: 'Existing' }), name: 'Existing' }, { onMissing: 'create' })], client.connection())).operations[0].type).toBe('create');
    client.seed('x', { name: 'Existing' }); client.seed('x', { name: 'Existing' });
    await expect(plan([declaration], client.connection())).rejects.toMatchObject({ code: 'AMBIGUOUS_LOOKUP' });
    client.seed('document.page.tag', { name: 'Wrong' }, 'fixture.wrong');
    await expect(plan([resource('x', 'fixture.wrong', {})], client.connection())).rejects.toMatchObject({ code: 'IDENTITY_COLLISION' });
    const same = client.seed('x', { name: 'One' }, 'fixture.one');
    client.seed('ir.model.data', { module: 'fixture', name: 'two', model: 'x', res_id: same });
    await expect(plan([resource('x', 'fixture.one', {}), resource('x', 'fixture.two', {})], client.connection())).rejects.toMatchObject({ code: 'IDENTITY_COLLISION' });
    expect(client.mutations).toEqual([]);
  });
  it('adopts a foreign-owned record for explicit configuration but protects all other aliases from deletion/archive', async () => {
    const client = new FakeClient(), id = client.seed('x', { name: 'Foreign' }, 'tecnativa.original');
    const defs = [resource('x', 'fixture.adopted', { _ref: lookup('x', { name: 'Foreign' }), name: 'Configured' })];
    const reviewed = await plan(defs, client.connection()); expect(reviewed.operations[0].type).toBe('adopt');
    expect((await apply(reviewed, client.connection())).ok).toBe(true); expect(client.data.x).toHaveLength(1);
    const owned = [{ externalId: 'fixture.adopted', model: 'x', id }];
    for (const action of ['archive', 'delete'] as const) await expect(plan([], client.connection(), { owned, removals: [{ ...owned[0], action }] })).rejects.toMatchObject({ code: 'FOREIGN_OWNERSHIP' });
    expect(client.data.x[0].name).toBe('Configured');
  });
  it('preserves unowned M2M targets, explicitly unlinks only reviewed IDs and performs owned archive/delete', async () => {
    const client = new FakeClient(); const a = client.seed('x', { name: 'Manual' }), b = client.seed('x', { name: 'Managed' }, 'fixture.b');
    const parent = client.seed('x', { name: 'Parent', items: [a, b] }, 'fixture.parent');
    const defs = [resource('x', 'fixture.parent', { name: 'Parent', items: [ref('fixture.b')], removeUnmanaged: { items: true } }), resource('x', 'fixture.b', { name: 'Managed' })];
    const ordinary = await plan(defs, client.connection()); expect(ordinary.operations).toEqual([]); expect(ordinary.diagnostics.join(' ')).toContain('ignored');
    const unlinked = await apply(await plan(defs, client.connection(), { unlink: [{ externalId: 'fixture.parent', field: 'items', ids: [a] }] }), client.connection());
    expect(unlinked.ok).toBe(true); expect(client.data.x.find(row => row.id === parent)!.items).toEqual([b]); expect(client.data.x.some(row => row.id === a)).toBe(true);
    const owned = [{ externalId: 'fixture.b', model: 'x', id: b }];
    await expect(plan([], client.connection(), { removals: [{ ...owned[0], action: 'delete' }] })).rejects.toMatchObject({ code: 'OWNERSHIP_REQUIRED' });
    expect((await apply(await plan([], client.connection(), { owned, removals: [{ ...owned[0], action: 'archive' }] }), client.connection())).ok).toBe(true);
    expect(client.data.x.find(row => row.id === b)!.active).toBe(false);
    expect((await apply(await plan([], client.connection(), { owned, removals: [{ ...owned[0], action: 'delete' }] }), client.connection())).ok).toBe(true);
    expect(client.data.x.some(row => row.id === b)).toBe(false); expect(client.data.x.some(row => row.id === a)).toBe(true);
  });
});

describe('stale plans and recoverable partial RPCs', () => {
  it('rejects modified/stale target, state and schema before writes', async () => {
    const client = new FakeClient(); client.seed('x', { name: 'Before' }, 'fixture.x');
    const reviewed = await plan([resource('x', 'fixture.x', { name: 'After' })], client.connection());
    const modified = structuredClone(reviewed); modified.operations[0].values.name = 'Poison';
    await expect(apply(modified, client.connection())).rejects.toMatchObject({ code: 'PLAN_MODIFIED' });
    client.data.x[0].name = 'Changed';
    await expect(apply(reviewed, client.connection())).rejects.toMatchObject({ code: 'STALE_PLAN' });
    client.data.x[0].name = 'Before'; client.uid = 8;
    await expect(apply(reviewed, client.connection())).rejects.toMatchObject({ code: 'STALE_PLAN' });
    client.uid = 7; client.schema.x.name.required = true;
    await expect(apply(reviewed, client.connection())).rejects.toMatchObject({ code: 'STALE_PLAN' }); expect(client.mutations).toEqual([]);
  });
  it('retains safety errors and reports skipped work, failed writes and suppressed cron activation', async () => {
    const client = new FakeClient(), sink = journal(client);
    const blocked = new OdooSafetyError({ name: 'odoo.create', level: 'WRITE', model: 'x', description: 'blocked' });
    client.failure = (_method, model) => model === 'x' ? blocked : undefined;
    const result = await apply(await plan([resource('x', 'fixture.a', {}), resource('x', 'fixture.b', {}, { dependsOn: ['fixture.a'] })], client.connection()), client.connection(), { journal: sink, stopOnError: false });
    expect(result.ok).toBe(false); expect(result.results[0].error).toBe(blocked); expect(result.skipped).toBe(1);
    const other = new FakeClient(); other.seed('document.page.tag', { name: 'Manual tag' });
    const inspection = await inspectResources(representative()); inspection.resources.find(r => r.externalId === 'fixture.action')!.values.state = 'invalid';
    const rejected = await apply(await plan(inspection, other.connection()), other.connection(), { journal: journal(other), stopOnError: false });
    expect(rejected.ok).toBe(false); expect(rejected.failed).toBeGreaterThan(0);
    expect(rejected.results.find(r => r.operation.type === 'activate')?.status).toBe('skipped');
    expect(other.data['ir.cron']?.every(row => row.active === false) ?? true).toBe(true);
  });
  it('persists created IDs before XML-ID writes, retries adoption without duplicate create and rejects uncertain pending receipts', async () => {
    const client = new FakeClient(), sink = journal(client), defs = [resource('x', 'fixture.x', { name: 'One' })];
    client.failure = (_method, model) => model === 'ir.model.data' ? new Error('identity write rejected') : undefined;
    const reviewed = await plan(defs, client.connection());
    await expect(apply(reviewed, client.connection())).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_REQUIRED' });
    const first = await apply(reviewed, client.connection(), { journal: sink });
    expect(first.ok).toBe(false); expect(first.results[0]).toMatchObject({ status: 'failed', partial: true, id: 1 });
    expect(sink.receipts.get('fixture.x')).toMatchObject({ state: 'record-created', id: 1 });
    expect(client.events).toEqual(['save:pending', 'create:x', 'save:record-created', 'create:ir.model.data']);
    client.failure = undefined;
    const retry = await plan(defs, client.connection(), { recovery: [...sink.receipts.values()] });
    expect(retry.operations[0].type).toBe('adopt'); expect(retry.operations.some(op => op.type === 'create')).toBe(false);
    expect((await apply(retry, client.connection(), { journal: sink })).ok).toBe(true); expect(client.data.x).toHaveLength(1);
    const pending = { ...first.recovery[0], state: 'pending' as const, id: undefined };
    await expect(plan(defs, client.connection(), { recovery: [pending] })).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
  });
  it('stops before the next RPC when durable receipt storage fails', async () => {
    const client = new FakeClient();
    const result = await apply(await plan([resource('x', 'fixture.x', {})], client.connection()), client.connection(), { journal: { async save(receipt) { if (receipt.state === 'record-created') throw new Error('disk full'); } } });
    expect(result.ok).toBe(false); expect(client.data.x).toHaveLength(1); expect(client.data['ir.model.data']).toBeUndefined();
    expect(result.recovery[0]).toMatchObject({ state: 'record-created', id: 1 });
  });
  it('fails false write returns and requires fresh convergence instead of equating RPC completion with success', async () => {
    const client = new FakeClient(); client.seed('x', { name: 'Old' }, 'fixture.x');
    client.failure = method => method === 'write' ? false : undefined;
    const reviewed = await plan([resource('x', 'fixture.x', { name: 'New' })], client.connection());
    const result = await apply(reviewed, client.connection());
    expect(result.ok).toBe(false); expect(result.results[0]).toMatchObject({ status: 'failed', error: { code: 'WRITE_REJECTED' } });
    expect(result.drift?.operations).toHaveLength(1);
  });
});
