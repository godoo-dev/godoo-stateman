// Adapted from Marc Fargas, odoo-toolbox at 01512004814df8887a457e5ed9d6c5769fe3b730.
// SPDX-License-Identifier: LGPL-3.0-only. See NOTICE.md.
import type { ResourceDefinition } from './types.js';

/**
 * A children wrapper that declares child resources for a one2many field.
 *
 * When the parent resource has an externalId, each child's externalId is
 * automatically prefixed with the parent's externalId during offline normalization.
 *
 * @example
 * resource('project.project', 'example.fiscal', {
 *   type_ids: children('project.task.type', [
 *     resource('project.task.type', 'nuevo', { name: 'Nuevo' }),
 *     resource('project.task.type', 'done', { name: 'Done' }),
 *   ]),
 * })
 */
export interface ChildrenRef {
  readonly __type: 'children';
  readonly model: string;
  /** Inverse relation field on the child model (e.g., 'project_id' or 'project_ids').
   * Preserved for future schema-aware scoping; no cardinality is inferred offline. */
  readonly inverseField?: string;
  readonly resources: ResourceDefinition[];
}

export function isChildrenRef(v: unknown): v is ChildrenRef {
  return typeof v === 'object' && v !== null && (v as any).__type === 'children';
}

export function children(model: string, resources: ResourceDefinition[]): ChildrenRef;
export function children(
  model: string,
  inverseField: string,
  resources: ResourceDefinition[]
): ChildrenRef;
export function children(
  model: string,
  inverseFieldOrResources: string | ResourceDefinition[],
  maybeResources?: ResourceDefinition[]
): ChildrenRef {
  if (typeof inverseFieldOrResources === 'string') {
    return Object.freeze({
      __type: 'children' as const,
      model,
      inverseField: inverseFieldOrResources,
      resources: maybeResources!,
    });
  }
  return Object.freeze({ __type: 'children' as const, model, resources: inverseFieldOrResources });
}
