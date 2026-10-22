// Adapted from Marc Fargas, odoo-toolbox at 01512004814df8887a457e5ed9d6c5769fe3b730.
// SPDX-License-Identifier: LGPL-3.0-only. See NOTICE.md.
import type { LookupRef, RemoveUnmanagedMap, ResourceDefinition } from './types.js';

/**
 * Create a resource definition.
 *
 * @example
 * // Without external ID (existing behavior)
 * resource('res.partner', { _ref: lookup(...), name: 'Acme' })
 *
 * // With external ID
 * resource('project.project', 'bgbl.fiscal_project', { name: 'Fiscal FY' })
 */
export function resource(model: string, definition: Record<string, unknown>): ResourceDefinition;
export function resource(
  model: string,
  externalId: string,
  definition: Record<string, unknown>
): ResourceDefinition;
export function resource(
  model: string,
  externalIdOrDefinition: string | Record<string, unknown>,
  maybeDefinition?: Record<string, unknown>
): ResourceDefinition {
  let externalId: string | undefined;
  let definition: Record<string, unknown>;

  if (typeof externalIdOrDefinition === 'string') {
    externalId = externalIdOrDefinition;
    definition = maybeDefinition!;
  } else {
    definition = externalIdOrDefinition;
  }

  const { _ref, removeUnmanaged, ...values } = definition;
  return Object.freeze({
    __type: 'resource' as const,
    model,
    ...(externalId !== undefined ? { externalId } : {}),
    ...(_ref !== undefined ? { ref: _ref as LookupRef } : {}),
    values: Object.freeze({ ...values }),
    ...(removeUnmanaged !== undefined
      ? { removeUnmanaged: removeUnmanaged as RemoveUnmanagedMap }
      : {}),
  });
}
