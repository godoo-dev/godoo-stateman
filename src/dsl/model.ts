// Adapted from Marc Fargas, odoo-toolbox at 01512004814df8887a457e5ed9d6c5769fe3b730.
// SPDX-License-Identifier: LGPL-3.0-only. See NOTICE.md.
import type { ModelPolicy } from './types.js';

export function model(
  modelName: string,
  policy: { removeOrphans?: boolean; archiveOrphans?: boolean }
): ModelPolicy {
  return Object.freeze({
    __type: 'model' as const,
    model: modelName,
    ...(policy.removeOrphans !== undefined ? { removeOrphans: policy.removeOrphans } : {}),
    ...(policy.archiveOrphans !== undefined ? { archiveOrphans: policy.archiveOrphans } : {}),
  });
}
