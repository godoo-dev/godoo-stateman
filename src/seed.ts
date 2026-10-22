import { plan } from './plan.js';
import { apply } from './apply.js';
import { parseFixture, serializeFixture } from './fixtures.js';
import type { FixtureBounds, StateFixture } from './fixtures.js';
import type { ApplyResult, PlanOptions, RecoveryJournal, StateConnection } from './state-types.js';

export interface SeedOptions {
  journal: RecoveryJournal;
  plan?: PlanOptions;
  bounds?: FixtureBounds;
  stopOnError?: boolean;
}
export interface SeedResult {
  ok: boolean;
  /** Freshly observed target bindings; empty if fresh verification failed. */
  bindings: Record<string, number>;
  result: ApplyResult;
}

/** Writable convenience for deliberately selected test environments. The normal
 * plan/apply API remains available when a separate review is needed.
 */
export async function seedFixture(fixture: StateFixture | string, connection: StateConnection, options: SeedOptions): Promise<SeedResult> {
  const desired = parseFixture(typeof fixture === 'string' ? fixture : serializeFixture(fixture, options.bounds), options.bounds);
  const reviewed = await plan(desired, connection, options.plan);
  const result = await apply(reviewed, connection, { journal: options.journal, stopOnError: options.stopOnError });
  return { ok: result.ok, bindings: { ...result.drift?.bindings }, result };
}
