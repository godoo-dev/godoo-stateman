import { createHash } from 'node:crypto';
import { isLookupRef, isResourceRef } from './dsl/types.js';
import type { LookupDomain } from './dsl/types.js';
import { StateError } from './state-types.js';
import type { ConnectionIdentity, Row } from './state-types.js';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}
export const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const equal = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
export function fail(code: string, message: string): never { throw new StateError(code, message); }
export function assertId(value: unknown, description: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail('INVALID_RECORD_ID', `${description} needs a positive integer record ID`);
}
export function xmlid(value: string): { module: string; name: string } {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*\.[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(value) || value.includes('..') || value.endsWith('.')) fail('INVALID_XML_ID', `Invalid qualified XML ID: ${value}`);
  const dot = value.indexOf('.');
  return { module: value.slice(0, dot), name: value.slice(dot + 1) };
}
export function identity(value: ConnectionIdentity): ConnectionIdentity {
  const url = new URL(value.url);
  if (!['http:', 'https:'].includes(url.protocol)) fail('INVALID_TARGET', 'Connection needs an HTTP(S) URL');
  url.username = ''; url.password = ''; url.search = ''; url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!value.database || typeof value.database !== 'string') fail('INVALID_TARGET', 'Connection database is required');
  assertId(value.uid, 'Authenticated user');
  return { url: url.toString().replace(/\/$/, ''), database: value.database, uid: value.uid };
}
export function domain(value: LookupDomain): any[] {
  if (!value || typeof value !== 'object') fail('INVALID_LOOKUP', 'Lookup needs an explicit domain');
  return Array.isArray(value) ? copy(value) : Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, '=', v]);
}
export function walkRefs(value: unknown, visit: (id: string) => void): void {
  if (isResourceRef(value)) { xmlid(value.externalId); visit(value.externalId); }
  else if (isLookupRef(value)) return;
  else if (Array.isArray(value)) value.forEach(v => walkRefs(v, visit));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => walkRefs(v, visit));
}
export function resolveRefs(value: unknown, ids: Record<string, number>): unknown {
  if (isResourceRef(value)) {
    const id = ids[value.externalId];
    if (!id) fail('UNRESOLVED_REFERENCE', `No committed record for ${value.externalId}`);
    return id;
  }
  if (Array.isArray(value)) return value.map(v => resolveRefs(v, ids));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, ids)]));
  return value;
}
export function sortGraph(graph: Map<string, Set<string>>): string[] {
  const result: string[] = [], active: string[] = [], done = new Set<string>();
  function visit(id: string): void {
    if (active.includes(id)) fail('RESOURCE_CYCLE', `Unsupported resource cycle: ${[...active.slice(active.indexOf(id)), id].join(' -> ')}`);
    if (done.has(id)) return;
    if (!graph.has(id)) fail('MISSING_DEPENDENCY', `Missing managed dependency: ${id}`);
    active.push(id);
    for (const dependency of [...graph.get(id)!].sort()) visit(dependency);
    active.pop(); done.add(id); result.push(id);
  }
  for (const id of [...graph.keys()].sort()) visit(id);
  return result;
}
export function record(value: unknown): value is Row { return !!value && typeof value === 'object' && !Array.isArray(value); }
