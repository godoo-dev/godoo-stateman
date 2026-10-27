import { assertId, digest, fail, xmlid } from './state-utils.js';
import type { Row } from './state-types.js';

export type Search = (model: string, domain: any[], names: string[], limit?: number, context?: Row) => Promise<Row[]>;
export interface RecordRead {
  key: string;
  label: string;
  model: string;
  id: number;
  names: string[];
  context?: Row;
}

/** Only identical projections and full contexts share a physical read. */
export async function readRecords(requests: RecordRead[], search: Search): Promise<Map<string, Row>> {
  const groups = new Map<string, { sample: RecordRead; requests: RecordRead[] }>();
  for (const request of requests) {
    request.names = [...new Set(request.names)].sort();
    const key = digest({ model: request.model, names: request.names, context: request.context });
    const group = groups.get(key) ?? { sample: request, requests: [] };
    group.requests.push(request); groups.set(key, group);
  }
  const result = new Map<string, Row>();
  for (const { sample, requests } of groups.values()) {
    const ids = [...new Set(requests.map(r => r.id))].sort((a, b) => a - b);
    const rows = new Map<number, Row>();
    for (let start = 0; start < ids.length; start += 100) {
      const chunk = ids.slice(start, start + 100);
      const read = await search(sample.model, [['id', 'in', chunk]], sample.names, undefined, sample.context);
      for (const row of read) {
        if (!chunk.includes(row.id as number) || rows.has(row.id as number)) fail('INVALID_READ', `Duplicate or unexpected record in ${sample.model} batch`);
        if (sample.names.some(name => !(name in row))) fail('INVALID_READ', `Incomplete field read in ${sample.model} batch`);
        rows.set(row.id as number, row);
      }
    }
    for (const request of requests) {
      const row = rows.get(request.id);
      if (!row) fail('RECORD_UNAVAILABLE', `${request.label}: record ${request.id} is missing or inaccessible`);
      result.set(request.key, row);
    }
  }
  return result;
}

/** A missing key is a legitimate adoption/recovery case; ambiguity never is. */
export async function readIdentities(ids: string[], search: Search): Promise<Map<string, Row | undefined>> {
  const result = new Map<string, Row | undefined>(ids.map(id => [id, undefined]));
  const modules = new Map<string, string[]>();
  for (const id of ids) {
    const { module, name } = xmlid(id);
    const names = modules.get(module) ?? [];
    names.push(name); modules.set(module, names);
  }
  for (const [module, names] of modules) {
    names.sort();
    for (let start = 0; start < names.length; start += 100) {
      const chunk = names.slice(start, start + 100);
      // No global limit: cardinality is checked independently for every key.
      const rows = await search('ir.model.data', [['module', '=', module], ['name', 'in', chunk]], ['module', 'name', 'model', 'res_id']);
      for (const row of rows) {
        if (row.module !== module || typeof row.name !== 'string' || !chunk.includes(row.name) || typeof row.model !== 'string' || !row.model) fail('INVALID_READ', 'Incomplete or unexpected XML-ID batch result');
        assertId(row.res_id, `XML ID ${module}.${row.name}`);
        const id = `${module}.${row.name}`;
        if (result.get(id)) fail('IDENTITY_COLLISION', `Multiple XML-ID bindings for ${id}`);
        result.set(id, row);
      }
    }
  }
  return result;
}

export interface MembershipProbe { key: string; model: string; field: string; id: number; candidates: number[]; }

/** Share identical negative predicates, then diagnose each positive owner alone.
 * Never union owners' different unseen sets or substitute a filtered M2M read.
 */
export async function readMembership(probes: MembershipProbe[], search: Search): Promise<Map<string, number[]>> {
  const groups = new Map<string, MembershipProbe[]>();
  const result = new Map<string, number[]>();
  for (const probe of probes) {
    const key = digest({ model: probe.model, field: probe.field, candidates: probe.candidates });
    const group = groups.get(key) ?? [];
    group.push(probe); groups.set(key, group);
    if (!result.has(probe.key)) result.set(probe.key, []);
  }
  for (const group of groups.values()) {
    const sample = group[0];
    const owners = [...new Set(group.map(probe => probe.id))].sort((a, b) => a - b);
    const positive = new Set<number>();
    for (let start = 0; start < owners.length; start += 100) {
      const chunk = owners.slice(start, start + 100);
      const rows = await search(sample.model, [['id', 'in', chunk], [sample.field, 'in', sample.candidates]], []);
      const seen = new Set<number>();
      for (const row of rows) {
        if (!chunk.includes(row.id as number) || seen.has(row.id as number)) fail('INVALID_READ', 'Duplicate or unexpected membership owner');
        seen.add(row.id as number); positive.add(row.id as number);
      }
    }
    for (const probe of group) if (positive.has(probe.id)) {
      async function discover(candidates: number[], knownMatch = false): Promise<void> {
        if (!candidates.length) return;
        if (!knownMatch) {
          const rows = await search(probe.model, [['id', '=', probe.id], [probe.field, 'in', candidates]], []);
          if (rows.length > 1 || rows.some(row => row.id !== probe.id)) fail('INVALID_READ', 'Invalid membership diagnostic result');
          if (!rows.length) return;
        }
        if (candidates.length === 1) { result.get(probe.key)!.push(candidates[0]); return; }
        const middle = Math.floor(candidates.length / 2);
        await discover(candidates.slice(0, middle));
        await discover(candidates.slice(middle));
      }
      await discover(probe.candidates, true);
    }
  }
  return result;
}
