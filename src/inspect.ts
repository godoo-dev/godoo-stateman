// Recursive adaptation of odoo-toolbox src/engine/flatten.ts, Marc Fargas,
// 01512004814df8887a457e5ed9d6c5769fe3b730. SPDX-License-Identifier: LGPL-3.0-only.
import { dirname, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { isChildrenRef } from './dsl/children.js';
import { isContentMarker, isTranslatedMarker } from './dsl/markers.js';
import { isResourceDefinition } from './dsl/types.js';
import type { ResourceDefinition, ResourceRef, ParentScope, ModelPolicy } from './dsl/types.js';
import { extractTranslations, renderMarkerValue, defaultReadFile } from './content.js';
import type { TranslationMeta, FileReader } from './content.js';
import { evaluate } from './loader.js';

export interface InspectedResource {
  externalId: string;
  model: string;
  values: Record<string, unknown>;
  ref?: ResourceDefinition['ref'];
  removeUnmanaged?: ResourceDefinition['removeUnmanaged'];
  parentScope?: ParentScope;
  translations?: TranslationMeta;
  options?: ResourceDefinition['options'];
}
export interface Inspection {
  kind: 'offline-inspection';
  /** Lexical identity order, NOT execution order or a reviewed plan. */
  resources: InspectedResource[];
  policies: ModelPolicy[];
  files: string[];
  diagnostics: string[];
}

function validId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(id) && !id.endsWith('.') && !id.includes('..');
}

/** Flatten nested resources recursively, preserving every relation as symbolic references.
 * No lookup/adoption, schema inference, scheduling or mutation is performed.
 */
export function normalizeResources(resources: readonly ResourceDefinition[]): InspectedResource[] {
  interface Context {
    parent: ResourceDefinition;
    field?: string;
    path: string;
    inverseField?: string;
  }
  const definitions = new Set<ResourceDefinition>();
  const declarations = new Map<ResourceDefinition, Context[]>();
  const usages = new Map<ResourceDefinition, Context[]>();
  const edges = new Map<ResourceDefinition, Set<ResourceDefinition>>();
  function record(map: Map<ResourceDefinition, Context[]>, child: ResourceDefinition, context: Context): void {
    const contexts = map.get(child) ?? [];
    contexts.push(context);
    map.set(child, contexts);
  }

  // Discover the complete object graph before choosing any identity. children()
  // is an explicit declaration; an ordinary relation is a use of that definition.
  function discover(definition: ResourceDefinition): void {
    if (definitions.has(definition)) return;
    if (!isResourceDefinition(definition) || typeof definition.model !== 'string' || !definition.model || !definition.values || typeof definition.values !== 'object') throw new Error('Malformed resource definition');
    definitions.add(definition);
    const targets = new Set<ResourceDefinition>();
    edges.set(definition, targets);
    const containers = new Set<object>();
    function scan(value: unknown, path: string, field?: string): void {
      if (isResourceDefinition(value)) {
        targets.add(value);
        record(usages, value, { parent: definition, field, path });
        discover(value);
      } else if (isChildrenRef(value)) {
        if (!Array.isArray(value.resources)) throw new Error(`Malformed children in ${definition.model}.${path}`);
        for (const child of value.resources) {
          if (!isResourceDefinition(child) || child.model !== value.model) throw new Error(`Child model mismatch in ${definition.model}.${path}`);
          targets.add(child);
          record(declarations, child, { parent: definition, path, inverseField: value.inverseField });
          discover(child);
        }
      } else if (value && typeof value === 'object' && !isContentMarker(value)) {
        if (containers.has(value)) throw new Error(`Cyclic field value in ${definition.model}`);
        containers.add(value);
        if (Array.isArray(value)) value.forEach((item, index) => scan(item, `${path}[${index}]`));
        else {
          const proto = Object.getPrototypeOf(value);
          if (proto !== Object.prototype && proto !== null) throw new Error(`Unsupported object in ${definition.model}`);
          for (const [key, item] of Object.entries(value)) scan(item, `${path}.${key}`, key);
        }
        containers.delete(value);
      }
    }
    for (const [key, value] of Object.entries(definition.values)) scan(value, key, key);
  }
  for (const resource of resources) discover(resource);

  // Reject cycles in every discovered component, including components that have
  // no unreferenced root. A repeated DAG edge is a reference, not a cycle.
  const active = new Set<ResourceDefinition>();
  const checked = new Set<ResourceDefinition>();
  function checkCycles(definition: ResourceDefinition): void {
    if (active.has(definition)) throw new Error(`Cyclic nested resource at ${definition.externalId ?? definition.model}`);
    if (checked.has(definition)) return;
    active.add(definition);
    for (const target of edges.get(definition) ?? []) checkCycles(target);
    active.delete(definition);
    checked.add(definition);
  }
  for (const definition of definitions) checkCycles(definition);

  const canonical = new Map<ResourceDefinition, { externalId: string; parentScope?: ParentScope }>();
  const identities = new Map<string, ResourceDefinition>();
  function identity(definition: ResourceDefinition): { externalId: string; parentScope?: ParentScope } {
    const existing = canonical.get(definition);
    if (existing) return existing;
    const rawId = definition.externalId;
    if (rawId !== undefined && !validId(rawId)) throw new Error(`Resource ${definition.model} needs a stable externalId`);
    const declared = declarations.get(definition) ?? [];
    let owner: Context | undefined;
    if (declared.length) {
      owner = declared[0];
      if (declared.some(context => context.parent !== owner!.parent || context.path !== owner!.path || context.inverseField !== owner!.inverseField)) throw new Error(`Ambiguous ownership for ${rawId ?? definition.model}`);
      if (rawId === undefined) throw new Error(`Resource ${definition.model} needs a stable externalId; unnamed list members are unsupported`);
    } else if (!rawId?.includes('.')) {
      // Without an explicit children() declaration, preserve the legacy inline
      // form only when its defining parent (and unnamed scalar field) is unique.
      // Never pick a parent from export order or a first reference.
      const candidates = (usages.get(definition) ?? []).filter(context => rawId !== undefined || context.field !== undefined);
      owner = candidates[0];
      if (owner && candidates.some(context => context.parent !== owner!.parent || (rawId === undefined && context.path !== owner!.path))) throw new Error(`Ambiguous ownership for ${rawId ?? definition.model}`);
    }
    const localId = rawId ?? owner?.field;
    if (!validId(localId)) throw new Error(`Resource ${definition.model} needs a stable externalId; unnamed list members are unsupported`);
    const parentId = owner ? identity(owner.parent).externalId : undefined;
    const externalId = localId.includes('.') ? localId : parentId ? `${parentId}.${localId}` : localId;
    if (!externalId.includes('.')) throw new Error(`Root identity must be qualified: ${externalId}`);
    const previous = identities.get(externalId);
    if (previous && previous !== definition) throw new Error(`Duplicate resource identity: ${externalId}`);
    identities.set(externalId, definition);
    const value = {
      externalId,
      ...(parentId ? { parentScope: { parentExternalId: parentId, ...(owner?.inverseField ? { inverseField: owner.inverseField } : {}) } } : {}),
    };
    canonical.set(definition, value);
    return value;
  }
  for (const definition of definitions) identity(definition);

  // Only now emit reference markers. Reusing a definition never assigns a new
  // ID or replaces the inverse scope established by its declaration.
  const ref = (definition: ResourceDefinition): ResourceRef => Object.freeze({ __type: 'resourceRef', externalId: identity(definition).externalId });
  function walk(value: unknown): unknown {
    if (isResourceDefinition(value)) return ref(value);
    if (isChildrenRef(value)) return value.resources.map(ref);
    if (value && typeof value === 'object') {
      if (isContentMarker(value)) return value;
      if (Array.isArray(value)) return value.map(walk);
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
    }
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Unsupported field value');
    return value;
  }
  return [...definitions].map(definition => ({
    ...identity(definition), model: definition.model,
    values: Object.fromEntries(Object.entries(definition.values).map(([key, value]) => [key, walk(value)])),
    ...(definition.ref ? { ref: definition.ref } : {}),
    ...(definition.options ? { options: definition.options } : {}),
    ...(definition.removeUnmanaged ? { removeUnmanaged: definition.removeUnmanaged } : {}),
  })).sort((a, b) => a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0);
}

export interface LoadOptions { contentRoot?: string; readFile?: FileReader; }
/** Render in-memory definitions through the same offline pipeline as file loading. */
export async function inspectResources(definitions: readonly ResourceDefinition[], options: LoadOptions = {}): Promise<Inspection> {
  const resources = normalizeResources(definitions);
  await renderResources(resources, resolve(options.contentRoot ?? '.'), options.readFile ?? defaultReadFile);
  return { kind: 'offline-inspection', resources, policies: [], files: [], diagnostics: [] };
}

async function renderResources(resources: InspectedResource[], contentRoot: string, readFile: FileReader): Promise<void> {
  async function render(value: unknown): Promise<unknown> {
    if (isTranslatedMarker(value)) throw new Error('translated() must be a direct resource field');
    if (isContentMarker(value)) return renderMarkerValue(value, contentRoot, readFile);
    if (Array.isArray(value)) return Promise.all(value.map(render));
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await render(item)])));
    return value;
  }
  for (const resource of resources) {
    const content = await extractTranslations(resource.values, contentRoot, readFile);
    resource.values = await render(content.resolvedValues) as Record<string, unknown>;
    if (content.translations.entries.length) resource.translations = content.translations;
  }
}
/** Offline loading: content paths use the supplied contentRoot, or input directory/file's directory. */
export async function loadResources(path: string, options: LoadOptions = {}): Promise<Inspection> {
  const input = resolve(path);
  const contentRoot = resolve(options.contentRoot ?? ((await stat(input)).isDirectory() ? input : dirname(input)));
  const evaluation = await evaluate(input);
  const resources = normalizeResources(evaluation.resources);
  await renderResources(resources, contentRoot, options.readFile ?? defaultReadFile);
  return {
    kind: 'offline-inspection', resources, policies: evaluation.policies, files: evaluation.files,
    diagnostics: [
      'Offline inspection only: identities and relations are symbolic, not validated against Odoo.',
      'Use plan with an explicit connection for schema, identity, dependency and prerequisite validation.',
      ...(evaluation.policies.length || resources.some(r => r.removeUnmanaged) ? ['Legacy removal policies are preserved as declarations only and grant no deletion authority.'] : []),
    ],
  };
}
