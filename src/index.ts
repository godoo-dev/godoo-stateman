export * from './dsl/index.js';
export { evaluate } from './loader.js';
export type { EvaluationResult } from './loader.js';
export { normalizeResources, loadResources } from './inspect.js';
export type { Inspection, InspectedResource, LoadOptions } from './inspect.js';
export { renderMarkerValue, extractTranslations, applyCss, checkSanitization, defaultReadFile } from './content.js';
export type { FileReader, TranslationMeta, TranslationEntry } from './content.js';

export class ReconciliationUnavailableError extends Error {
  readonly code = 'RECONCILIATION_UNAVAILABLE';
  constructor(operation: string) {
    super(`${operation} is unavailable in this offline foundation; safe reconciliation has not been implemented.`);
    this.name = 'ReconciliationUnavailableError';
  }
}
/** Deliberately fail closed; no client creation, lookup or writes. */
export function plan(..._args: unknown[]): never { throw new ReconciliationUnavailableError('plan'); }
export function apply(..._args: unknown[]): never { throw new ReconciliationUnavailableError('apply'); }
export function drift(..._args: unknown[]): never { throw new ReconciliationUnavailableError('drift'); }
export { createSchemaContext } from './runtime.js';
