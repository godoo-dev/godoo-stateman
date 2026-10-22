import type { Inspection, InspectedResource } from './inspect.js';

/** Portable desired state, never an export of records or database IDs. */
export interface StateFixture {
  format: 'godoo-state-fixture';
  version: 1;
  namespaces: string[];
  resources: InspectedResource[];
}
export interface FixtureBounds {
  maxResources?: number;
  maxDepth?: number;
  maxBytes?: number;
}
export interface FixtureOptions extends FixtureBounds {
  namespaces: readonly string[];
  /** Omit sensitive/unportable fields before serialization. */
  excludeFields?: Readonly<Record<string, readonly string[]>>;
}
const qualified = /^[A-Za-z0-9_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_][A-Za-z0-9_-]*)+$/;
const modelName = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
const contentTypes = new Set(['md', 'mdFile', 'html', 'css', 'translated', 'resource', 'children']);
function fail(message: string): never { throw new Error(`Invalid state fixture: ${message}`); }

function limits(bounds: FixtureBounds) {
  const value = (key: keyof FixtureBounds, fallback: number, ceiling: number) => {
    const n = bounds[key] ?? fallback;
    if (!Number.isSafeInteger(n) || n < 1 || n > ceiling) fail(`${key} must be within 1..${ceiling}`);
    return n;
  };
  return { maxResources: value('maxResources', 1000, 10000), maxDepth: value('maxDepth', 24, 64), maxBytes: value('maxBytes', 5_000_000, 50_000_000) };
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${path} must be an object`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(`${path} must contain plain JSON`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`unsupported ${path}.${key}`);
}
function xmlid(value: unknown, path: string): string {
  if (typeof value !== 'string' || !qualified.test(value)) return fail(`${path} needs a qualified XML ID`);
  return value;
}

/** Validate and clone JSON with bounded recursion, without evaluating any code. */
function clone(value: unknown, maxDepth: number, path: string, depth = 0, active = new Set<object>()): unknown {
  if (depth > maxDepth) fail(`${path} exceeds maxDepth`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') return fail(`${path} is not finite JSON`);
  if (active.has(value)) return fail(`${path} is cyclic`);
  active.add(value);
  try {
    if (Array.isArray(value)) return value.map((item, i) => clone(item, maxDepth, `${path}[${i}]`, depth + 1, active));
    const input = object(value, path);
    if (typeof input.__type === 'string' && contentTypes.has(input.__type)) fail(`${path} has unrendered authoring content`);
    if (input.__type === 'resourceRef') {
      keys(input, ['__type', 'externalId'], path);
      xmlid(input.externalId, path);
    }
    if (input.__type === 'lookup') {
      keys(input, ['__type', 'model', 'domain'], path);
      if (typeof input.model !== 'string' || !modelName.test(input.model)) fail(`${path} has an invalid lookup model`);
      if (!input.domain || typeof input.domain !== 'object') fail(`${path} has an invalid lookup domain`);
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      if (unsafe.has(key)) fail(`${path}.${key} is unsafe`);
      result[key] = clone(input[key], maxDepth, `${path}.${key}`, depth + 1, active);
    }
    return result;
  } finally { active.delete(value); }
}

function validate(value: unknown, bounds: FixtureBounds): StateFixture {
  const bound = limits(bounds);
  const root = object(value, 'fixture');
  keys(root, ['format', 'version', 'namespaces', 'resources'], 'fixture');
  if (root.format !== 'godoo-state-fixture' || root.version !== 1) fail('unsupported format/version');
  if (!Array.isArray(root.namespaces) || !root.namespaces.length || root.namespaces.length > 100) fail('namespaces must be explicit');
  const namespaces = [...new Set(root.namespaces.map((ns: unknown) => {
    if (typeof ns !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(ns)) return fail('invalid namespace');
    return ns;
  }))].sort();
  if (!Array.isArray(root.resources) || root.resources.length > bound.maxResources) fail('resource count exceeds maxResources');
  const ids = new Set<string>();
  const resources = root.resources.map((value: unknown) => {
    const raw = object(value, 'resource');
    keys(raw, ['externalId', 'model', 'values', 'ref', 'parentScope', 'options'], 'resource');
    const id = xmlid(raw.externalId, 'resource.externalId');
    if (!namespaces.some(ns => id.startsWith(`${ns}.`))) fail(`${id} is outside the declared namespaces`);
    if (ids.has(id)) fail(`duplicate identity ${id}`);
    ids.add(id);
    if (typeof raw.model !== 'string' || !modelName.test(raw.model)) fail(`${id} has an invalid model`);
    object(raw.values, `${id}.values`);
    if (raw.ref !== undefined) {
      const ref = object(raw.ref, `${id}.ref`);
      if (ref.__type !== 'lookup' || ref.model !== raw.model) fail(`${id} adoption lookup model mismatch`);
    }
    if (raw.parentScope !== undefined) {
      const scope = object(raw.parentScope, `${id}.parentScope`);
      keys(scope, ['parentExternalId', 'inverseField'], `${id}.parentScope`);
      xmlid(scope.parentExternalId, `${id}.parentScope`);
      if (scope.inverseField !== undefined && (typeof scope.inverseField !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(scope.inverseField))) fail(`${id} has an invalid inverse field`);
    }
    if (raw.options !== undefined) {
      const options = object(raw.options, `${id}.options`);
      keys(options, ['dependsOn', 'onMissing'], `${id}.options`);
      if (options.dependsOn !== undefined && (!Array.isArray(options.dependsOn) || options.dependsOn.some((id: unknown) => typeof id !== 'string' || !qualified.test(id)))) fail(`${id} has invalid explicit dependencies`);
      if (options.onMissing !== undefined && options.onMissing !== 'create' && options.onMissing !== 'error') fail(`${id} has an invalid onMissing policy`);
    }
    return clone(raw, bound.maxDepth, id) as InspectedResource;
  }).sort((a, b) => a.externalId.localeCompare(b.externalId, 'en'));
  for (const resource of resources) {
    const dependencies = (resource as InspectedResource & { options?: { dependsOn?: string[] } }).options?.dependsOn ?? [];
    for (const dependency of dependencies) if (!ids.has(dependency)) fail(`${resource.externalId} needs missing managed dependency ${dependency}`);
    if (resource.parentScope?.parentExternalId && !ids.has(resource.parentScope.parentExternalId)) fail(`${resource.externalId} needs its managed parent`);
  }
  const result: StateFixture = { format: 'godoo-state-fixture', version: 1, namespaces, resources };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > bound.maxBytes) fail('serialized size exceeds maxBytes');
  return result;
}

/** Capture rendered desired state only. Does not read Odoo or infer ownership. */
export function createFixture(inspection: Inspection, options: FixtureOptions): StateFixture {
  if (inspection.kind !== 'offline-inspection') fail('expected a rendered offline inspection');
  if (inspection.policies.length) fail('legacy model-removal policies cannot be packaged as fixtures');
  const resources = inspection.resources.map(resource => {
    if (resource.removeUnmanaged && Object.keys(resource.removeUnmanaged).length) fail(`${resource.externalId} has a legacy removal policy`);
    if (resource.translations?.entries.length) fail(`${resource.externalId} has unsupported field translations; use explicit language records`);
    const { removeUnmanaged: _remove, translations: _translations, ...rest } = resource;
    const omitted = new Set(options.excludeFields?.[resource.model] ?? []);
    return { ...rest, values: Object.fromEntries(Object.entries(resource.values).filter(([field]) => !omitted.has(field))) };
  });
  return validate({ format: 'godoo-state-fixture', version: 1, namespaces: [...options.namespaces], resources }, options);
}

export function serializeFixture(fixture: StateFixture, bounds: FixtureBounds = {}): string {
  const output = `${JSON.stringify(validate(fixture, bounds), null, 2)}\n`;
  if (Buffer.byteLength(output, 'utf8') > limits(bounds).maxBytes) fail('serialized size exceeds maxBytes');
  return output;
}

/** Parse untrusted JSON within bounds; resource planning still performs live validation. */
export function parseFixture(json: string, bounds: FixtureBounds = {}): Inspection {
  if (Buffer.byteLength(json, 'utf8') > limits(bounds).maxBytes) fail('input exceeds maxBytes');
  const fixture = validate(JSON.parse(json), bounds);
  return { kind: 'offline-inspection', resources: fixture.resources, policies: [], files: [], diagnostics: ['Portable desired-state fixture; identities, schema and ownership require ordinary live planning.'] };
}
