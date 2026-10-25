import type { Inspection, InspectedResource, LoadOptions } from './inspect.js';
import type { ResourceDefinition } from './dsl/types.js';

export type Row = Record<string, unknown>;
/** Structural seam supported by the released godoo client; guards remain on that client. */
export interface StateClient {
  searchRead(model: string, domain?: any[], options?: { fields?: string[]; limit?: number; order?: string; context?: Row }): Promise<Row[]>;
  call<T = unknown>(model: string, method: string, args?: any[], kwargs?: Row): Promise<T>;
  create(model: string, values: Row, context?: Row): Promise<number>;
  write(model: string, ids: number | number[], values: Row, context?: Row): Promise<boolean>;
  unlink(model: string, ids: number | number[]): Promise<boolean>;
}
export interface ConnectionIdentity { url: string; database: string; uid: number; }
/** Compatible with the generic godoo-ts inspectModulePrerequisites result. */
export interface AddonInspection {
  modules: { name: string; status: string; state?: string | null; dependencies: string[] | null }[];
  closureComplete: boolean;
  diagnostics: { code: string; message: string }[];
}
export interface StateConnection {
  client: StateClient;
  /** Must describe the same client and re-read its current authenticated session. */
  identity(): Promise<ConnectionIdentity>;
  serverInfo(): Promise<{ version: string }>;
  inspectAddons?(names: readonly string[], options?: { context?: Row }): Promise<AddonInspection>;
}
export interface FieldMetadata {
  type: string;
  relation?: string;
  relation_field?: string;
  required?: boolean;
  readonly?: boolean;
}
export type Schema = Record<string, Record<string, FieldMetadata>>;
export type StateInput = string | Inspection | readonly ResourceDefinition[];
export interface OwnedRecord { externalId: string; model: string; id: number; }
export interface Removal extends OwnedRecord { action: 'archive' | 'delete'; }
/** Unlink the enumerated links only. Targets are never deleted; M2M only. */
export interface RelationUnlink { externalId: string; field: string; ids: number[]; }
export interface PlanOptions extends LoadOptions {
  /** Subsets include their managed dependency closure; missing definitions are errors. */
  select?: string[];
  requiredAddons?: string[];
  /** Explicit supported Odoo major versions; default [18]. Majors below18 are unsupported; later majors require explicit opt-in and verification. */
  odooMajorVersions?: number[];
  context?: Row;
  owned?: OwnedRecord[];
  removals?: Removal[];
  unlink?: RelationUnlink[];
  recovery?: RecoveryReceipt[];
}
export interface StoredPlanOptions extends Omit<PlanOptions, 'contentRoot' | 'readFile'> {}
export interface Observation { kind: 'search' | 'schema' | 'addons' | 'server'; key: string; value: unknown; }
export interface Mutation {
  key: string;
  type: 'create' | 'adopt' | 'update' | 'link' | 'unlink' | 'archive' | 'delete' | 'activate' | 'deactivate';
  externalId: string;
  model: string;
  /** Exact existing record, or resolved from the earlier create for this XML ID. */
  id?: number;
  values: Row;
  context?: Row;
  dependsOn: string[];
}
export interface Plan {
  kind: 'stateman-plan';
  version: 1;
  target: ConnectionIdentity;
  /** Complete rendered input, not a re-evaluated TS path. */
  input: Inspection;
  options: StoredPlanOptions;
  resources: InspectedResource[];
  order: string[];
  bindings: Record<string, number>;
  schema: Schema;
  observations: Observation[];
  operations: Mutation[];
  diagnostics: string[];
  digest: string;
}
export interface RecoveryReceipt {
  version: 1;
  target: ConnectionIdentity;
  externalId: string;
  model: string;
  /** Digest of the reviewed create intent; useful to investigate uncertain RPCs. */
  intent: string;
  state: 'pending' | 'record-created' | 'complete';
  id?: number;
}
export interface RecoveryJournal {
  /** Resolve only after durable persistence. Upsert by target + externalId. */
  save(receipt: RecoveryReceipt): Promise<void>;
}
export interface ApplyOptions {
  journal?: RecoveryJournal;
  /** Default true; false permits independent operations, never failed dependents/activation. */
  stopOnError?: boolean;
}
export interface OperationResult {
  operation: Mutation;
  status: 'committed' | 'failed' | 'skipped';
  id?: number;
  /** Includes the original structured safety/RPC error when called programmatically. */
  error?: unknown;
  message?: string;
  /** Earlier nontransactional RPCs within this operation may have committed. */
  partial?: boolean;
}
export interface ApplyResult {
  ok: boolean;
  committed: number;
  failed: number;
  skipped: number;
  results: OperationResult[];
  recovery: RecoveryReceipt[];
  drift?: Plan;
  verificationError?: unknown;
}
export class StateError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options); this.name = 'StateError';
  }
}
