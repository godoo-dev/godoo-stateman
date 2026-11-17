// Characterization of plan() fail-closed paths and complete plan output, pinned
// before refactoring plan() for the complexity limit. A snapshot change means a
// behaviour change; fix the code, do not update the snapshot.
import { describe, expect, it, vi } from 'vitest';
import { OdooRpcError } from '@godoo-dev/client';
import { companyValues, exact, inspectResources, lookup, plan, ref, resource, translated } from '@godoo-dev/stateman';
import type { Inspection, PlanOptions, Row, StateConnection } from '@godoo-dev/stateman';
import { FakeClient } from './fake-client.js';
import { ScopedClient } from './scoped-client.js';

async function outcome(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return 'planned';
  } catch (error) {
    const { code, message } = error as { code?: string; message: string };
    return { code, message };
  }
}
async function rendered(defs: unknown[]): Promise<Inspection> {
  return inspectResources(defs as Parameters<typeof inspectResources>[0]);
}
function scoped(): { client: ScopedClient; company: number; other: number; context: Row } {
  const client = new ScopedClient();
  const company = client.seed('res.company', { name: 'Company A' });
  const other = client.seed('res.company', { name: 'Company B' });
  client.seed('res.users', { company_ids: [company, other] });
  client.uid = client.data['res.users'][0].id as number;
  return { client, company, other, context: { allowed_company_ids: [company, other] } };
}

const cases: Record<string, () => Promise<unknown>> = {
  'non-inspection input': async () => plan({ kind: 'other' } as unknown as Inspection, new FakeClient().connection()),
  'model-wide orphan removal': async () => {
    const input = await rendered([resource('x', 'c.a', { name: 'A' })]);
    input.policies.push({ model: 'x', removeOrphans: true } as never);
    return plan(input, new FakeClient().connection());
  },
  'resource without model': async () => {
    const input = await rendered([resource('x', 'c.a', { name: 'A' })]);
    (input.resources[0] as { model?: string }).model = '';
    return plan(input, new FakeClient().connection());
  },
  'duplicate rendered identity': async () => {
    const input = await rendered([resource('x', 'c.a', { name: 'A' })]);
    input.resources.push(structuredClone(input.resources[0]));
    return plan(input, new FakeClient().connection());
  },
  'invalid onMissing policy': async () => {
    const input = await rendered([resource('x', 'c.a', { name: 'A' })]);
    input.resources[0].options = { onMissing: 'replace' } as never;
    return plan(input, new FakeClient().connection());
  },
  'addon module resource': async () => plan([resource('ir.module.module', 'c.module', { state: 'installed' })], new FakeClient().connection()),
  'missing server version': async () => {
    const connection: StateConnection = { ...new FakeClient().connection(), serverInfo: async () => ({}) as never };
    return plan([resource('x', 'c.a', { name: 'A' })], connection);
  },
  'missing model': async () => {
    const client = new FakeClient();
    client.schemaError = new OdooRpcError('missing', { data: { name: 'builtins.KeyError', arguments: ['x'] } } as never);
    return plan([resource('x', 'c.a', { name: 'A' })], client.connection());
  },
  'malformed schema': async () => {
    const client = new FakeClient();
    client.schema.x.name = {} as never;
    return plan([resource('x', 'c.a', { name: 'A' })], client.connection());
  },
  'malformed search result': async () => {
    const client = new FakeClient();
    client.searchRead = async () => ({}) as never;
    return plan([resource('x', 'c.a', { name: 'A' })], client.connection());
  },
  'path through scalar field': async () => plan([resource('x', 'c.a', { parent_id: lookup('x', { 'name.id': 'A' }) })], new FakeClient().connection()),
  'non-tuple domain term is accepted': async () => {
    const client = new FakeClient();
    client.seed('x', { name: 'A' });
    return plan([resource('x', 'c.a', { parent_id: lookup('x', [['name', '=', 'A']]) })], client.connection());
  },
  'manual field metadata unreadable': async () => {
    const client = new FakeClient();
    client.schema.x.x_score = { type: 'integer' };
    client.schema['ir.model.fields'] = { model: { type: 'char' }, name: { type: 'char' }, state: { type: 'char' }, compute: { type: 'text' } };
    return plan([resource('x', 'c.a', { x_score: 1 })], client.connection());
  },
  'cron without boolean active': async () => {
    const client = new FakeClient();
    client.schema['ir.cron'].active = { type: 'char' };
    return plan([resource('ir.cron', 'c.cron', { name: 'Cron' })], client.connection());
  },
  'cron active not boolean': async () => plan([resource('ir.cron', 'c.cron', { name: 'Cron', active: 'yes' })], new FakeClient().connection()),
  'system field': async () => plan([resource('x', 'c.a', { create_uid: 1 })], new FakeClient().connection()),
  'empty company values': async () => {
    const { client, context } = scoped();
    return plan([resource('x', 'c.a', { property: companyValues([]) })], client.connection(), { context });
  },
  'inverse to unrelated model': async () => {
    const input = await rendered([resource('x', 'c.parent', { name: 'P' }), resource('x', 'c.child', { name: 'C' })]);
    input.resources[0].parentScope = undefined;
    input.resources[1].parentScope = { parentExternalId: 'c.parent', inverseField: 'name' } as never;
    return plan(input, new FakeClient().connection());
  },
  'receipt for another connection': async () => plan([resource('x', 'c.a', { name: 'A' })], new FakeClient().connection(), {
    recovery: [{ version: 1, target: { url: 'http://other.test/', database: 'other', uid: 1 }, externalId: 'c.a', model: 'x', state: 'pending' }],
  } as PlanOptions),
  'duplicate receipts': async () => {
    const target = { url: 'http://fake.test/', database: 'fixture', uid: 7 };
    const receipt = { version: 1, target, externalId: 'c.a', model: 'x', state: 'pending' };
    return plan([resource('x', 'c.a', { name: 'A' })], new FakeClient().connection(), { recovery: [receipt, receipt] } as PlanOptions);
  },
  'receipt conflicting with XML ID': async () => {
    const client = new FakeClient();
    const id = client.seed('x', { name: 'A' }, 'c.a');
    const target = { url: 'http://fake.test/', database: 'fixture', uid: 7 };
    return plan([resource('x', 'c.a', { name: 'A' })], client.connection(), { recovery: [{ version: 1, target, externalId: 'c.a', model: 'x', state: 'complete', id: id + 100 }] } as PlanOptions);
  },
  'cyclic parent scope': async () => {
    const input = await rendered([resource('x', 'c.a', { name: 'A' }), resource('x', 'c.b', { name: 'B' })]);
    input.resources[0].parentScope = { parentExternalId: 'c.b', inverseField: 'parent_id' } as never;
    input.resources[1].parentScope = { parentExternalId: 'c.a', inverseField: 'parent_id' } as never;
    return plan(input, new FakeClient().connection());
  },
  'adoption lookup on another model': async () => {
    const input = await rendered([resource('x', 'c.a', { name: 'A' })]);
    input.resources[0].ref = lookup('project.project', { name: 'A' }) as never;
    return plan(input, new FakeClient().connection());
  },
  'reference to unselected resource': async () => {
    const input = await rendered([resource('x', 'c.a', { name: 'A' })]);
    input.resources[0].values.parent_id = { __type: 'resourceRef', externalId: 'c.missing' };
    return plan(input, new FakeClient().connection(), { select: ['c.a'] });
  },
  'lookup on wrong relation model': async () => plan([resource('x', 'c.a', { parent_id: lookup('project.project', { name: 'P' }) })], new FakeClient().connection()),
  'ref to wrong relation model': async () => plan([resource('project.project', 'c.p', { name: 'P' }), resource('x', 'c.a', { parent_id: ref('c.p') })], new FakeClient().connection()),
  'unrendered marker': async () => {
    const input = await rendered([resource('x', 'c.a', { name: 'A' })]);
    input.resources[0].values.payload = { __type: 'md', source: 'x' };
    return plan(input, new FakeClient().connection());
  },
  'company not authorized': async () => {
    const { client, context } = scoped();
    const outsider = client.seed('res.company', { name: 'Outsider' });
    client.seed('x', { name: 'A' }, 'c.a');
    return plan([resource('x', 'c.a', { property: companyValues([{ company: outsider, value: false }]) })], client.connection(), { context });
  },
  'company outside base context': async () => {
    const { client, company } = scoped();
    client.seed('x', { name: 'A' }, 'c.a');
    return plan([resource('x', 'c.a', { property: companyValues([{ company, value: false }]) })], client.connection(), { context: { allowed_company_ids: [999] } });
  },
  'duplicate company entry': async () => {
    const { client, company, context } = scoped();
    client.seed('x', { name: 'A' }, 'c.a');
    return plan([resource('x', 'c.a', { property: companyValues([{ company, value: false }, { company, value: false }]) })], client.connection(), { context });
  },
  'duplicate company entry on create': async () => {
    const { client, company, context } = scoped();
    return plan([resource('x', 'c.a', { property: companyValues([{ company, value: false }, { company, value: false }]) })], client.connection(), { context });
  },
  'exact target partitioned by company_ids': async () => {
    const { client, context } = scoped();
    client.schema['x'].company_ids = { type: 'many2many', relation: 'res.company' };
    return plan([resource('x', 'c.a', { items: exact([]) })], client.connection(), { context });
  },
  'exact target with unsupported company field': async () => {
    const { client, context } = scoped();
    client.schema['x'].company_id = { type: 'char' };
    return plan([resource('x', 'c.a', { items: exact([]) })], client.connection(), { context });
  },
  'translation of relation field': async () => {
    const input = await rendered([resource('x', 'c.a', { name: translated('A', { es_ES: 'B' }) })]);
    input.resources[0].translations!.entries[0].field = 'parent_id';
    input.resources[0].values.parent_id = 'A';
    return plan(input, new ScopedClient().connection());
  },
};

// Several faults at once: the first check that fires is part of the contract.
const ordered: Record<string, () => Promise<unknown>> = {
  'invalid policy and duplicate identity': async () => {
    const input = await rendered([resource('x', 'c.a', { name: 'A' })]);
    input.resources.push({ ...structuredClone(input.resources[0]), options: { onMissing: 'replace' } as never });
    return plan(input, new FakeClient().connection());
  },
  'system field and wrong relation model': async () => plan([resource('x', 'c.a', { create_uid: 1, parent_id: lookup('project.project', { name: 'P' }) })], new FakeClient().connection()),
  'receipt collision and missing dependency': async () => {
    const target = { url: 'http://fake.test/', database: 'fixture', uid: 7 };
    const receipt = { version: 1, target, externalId: 'c.a', model: 'x', state: 'pending' };
    const input = await rendered([resource('x', 'c.a', { name: 'A' })]);
    input.resources[0].values.parent_id = { __type: 'resourceRef', externalId: 'c.missing' };
    return plan(input, new FakeClient().connection(), { recovery: [receipt, receipt] } as PlanOptions);
  },
  'unsupported version and module resource': async () => {
    const client = new FakeClient(); client.version = '17.0';
    return plan([resource('ir.module.module', 'c.module', { state: 'installed' })], client.connection());
  },
  'cron policy and system field': async () => plan([resource('ir.cron', 'c.cron', { name: 'Cron', active: 'yes', write_date: false })], new FakeClient().connection()),
};

describe('plan() fail-closed characterization', () => {
  for (const [name, run] of Object.entries({ ...cases, ...ordered })) {
    it(name, async () => {
      // Physical reads before the failure are pinned as a multiset.
      const calls: string[] = [];
      const read = vi.spyOn(FakeClient.prototype, 'searchRead');
      const call = vi.spyOn(FakeClient.prototype, 'call');
      try {
        const result = await outcome(run);
        for (const args of read.mock.calls) calls.push(JSON.stringify(['search_read', ...args]));
        for (const args of call.mock.calls) calls.push(JSON.stringify(['call', ...args]));
        expect({ result, calls: calls.sort() }).toMatchSnapshot();
      } finally { read.mockRestore(); call.mockRestore(); }
    });
  }
});

type Call = { kind: string; model: string; domain?: unknown; fields?: unknown; limit?: unknown; context?: unknown };
function recorded<T extends FakeClient>(client: T): { client: T; calls: () => string[] } {
  const log: Call[] = [];
  const read = client.searchRead.bind(client), call = client.call.bind(client);
  client.searchRead = async (model, domain = [], options = {}) => {
    log.push({ kind: 'search_read', model, domain, fields: options.fields, limit: options.limit, context: options.context });
    return read(model, domain, options);
  };
  client.call = (async (model: string, method: string, ...rest: unknown[]) => {
    log.push({ kind: method, model });
    return (call as (...args: unknown[]) => Promise<unknown>)(model, method, ...rest);
  }) as typeof client.call;
  // Order across parallel reads is free; the multiset of physical reads is pinned.
  return { client, calls: () => log.map(entry => JSON.stringify(entry)).sort() };
}

describe('plan() output characterization', () => {
  it('creates a parent with declared children, references and a disabled cron', async () => {
    const { client, calls } = recorded(new FakeClient());
    client.seed('ir.actions.server', { name: 'Existing', code: 'old', state: 'code' }, 'c.action');
    const defs = [
      resource('ir.actions.server', 'c.action', { name: 'Existing', code: 'new', state: 'code' }),
      resource('ir.cron', 'c.cron', { name: 'Cron', ir_actions_server_id: ref('c.action') }),
      resource('document.page', 'c.root', { name: 'Root', content: '<p>Root<br></p>' }),
      resource('document.page', 'c.child', { name: 'Child', parent_id: ref('c.root'), tag_ids: [ref('c.tag')] }),
      resource('document.page.tag', 'c.tag', { name: 'Tag' }),
    ];
    const reviewed = await plan(defs, client.connection());
    expect({ plan: reviewed, calls: calls() }).toMatchSnapshot();
  });
  it('updates, adopts, links, unlinks, removes and toggles existing state', async () => {
    const { client, calls } = recorded(new FakeClient());
    const keep = client.seed('x', { name: 'Keep' });
    const drop = client.seed('x', { name: 'Drop' });
    client.seed('x', { name: 'Old', items: [keep, drop] }, 'c.root');
    client.seed('x', { name: 'Adoptable' });
    const removed = client.seed('x', { name: 'Gone' }, 'c.gone');
    const action = client.seed('ir.actions.server', { name: 'Action', code: 'x', state: 'code' }, 'c.action');
    client.seed('ir.cron', { name: 'Cron', active: true, ir_actions_server_id: action }, 'c.cron');
    const defs = [
      resource('x', 'c.root', { name: 'New', items: [keep, lookup('x', { name: 'Adoptable' })], payload: { a: [1, { b: lookup('x', { name: 'Keep' }) }] } }),
      resource('x', 'c.adopted', { _ref: lookup('x', { name: 'Adoptable' }), name: 'Adoptable', parent_id: ref('c.root') }),
      resource('ir.actions.server', 'c.action', { name: 'Action', code: 'y', state: 'code' }),
      resource('ir.cron', 'c.cron', { name: 'Cron', ir_actions_server_id: ref('c.action') }),
    ];
    const reviewed = await plan(defs, client.connection(), {
      unlink: [{ externalId: 'c.root', field: 'items', ids: [drop] }],
      owned: [{ externalId: 'c.gone', model: 'x', id: removed }],
      removals: [{ externalId: 'c.gone', model: 'x', id: removed, action: 'archive' }],
    });
    expect({ plan: reviewed, calls: calls() }).toMatchSnapshot();
  });
  it('plans company values, exact membership and translations', async () => {
    const { client, company, other, context } = scoped();
    const { calls } = recorded(client);
    const a = client.seed('x', { name: 'A' }), b = client.seed('x', { name: 'B' });
    client.seed('x', { name: 'Root', items: [b] }, 'c.root');
    const defs = [
      resource('x', 'c.root', {
        name: 'Root',
        items: exact([a]),
        property: companyValues([{ company, value: a }, { company: other, value: false }]),
        description: translated('Text', { es_ES: 'Texto', ca_ES: 'Text català' }),
      }),
      resource('x', 'c.new', { name: 'New', body: translated('<p>Body</p>', { es_ES: '<p>Cuerpo</p>' }), items: exact([ref('c.root')]) }),
    ];
    const reviewed = await plan(defs, client.connection(), { context: { ...context, lang: false } });
    expect({ plan: reviewed, calls: calls() }).toMatchSnapshot();
  });
});
