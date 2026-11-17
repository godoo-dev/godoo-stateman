import { plan } from './plan.js';
import { isResourceRef } from './dsl/types.js';
import { assertId, copy, digest, equal, fail, identity, resolveRefs, xmlid } from './state-utils.js';
import type { ApplyOptions, ApplyResult, Mutation, OperationResult, Plan, RecoveryReceipt, Row, StateConnection } from './state-types.js';

/** Apply only the reviewed plan after fresh read-only validation. RPCs are not transactional. */
export async function apply(reviewed: Plan, connection: StateConnection, options: ApplyOptions = {}): Promise<ApplyResult> {
  if (reviewed?.kind !== 'stateman-plan' || reviewed.version !== 1) fail('INVALID_PLAN', 'Apply requires a reviewed version-1 Stateman plan');
  const { digest: checksum, ...body } = reviewed;
  if (digest(body) !== checksum) fail('PLAN_MODIFIED', 'Plan contents do not match the reviewed digest');
  const original = copy(reviewed);
  const fresh = await plan(original.input, connection, original.options);
  if (!equal(original.target, fresh.target) || fresh.digest !== original.digest) fail('STALE_PLAN', 'Target or observed state changed; produce and review a fresh plan before applying');
  if (original.operations.some(op => op.type === 'create') && !options.journal) fail('RECOVERY_JOURNAL_REQUIRED', 'Creates require a durable RecoveryJournal.save callback before any writes');
  const run = new ApplyRun(original, connection, options);
  for (const operation of original.operations) await run.step(operation);
  return run.finish();
}

class ApplyRun {
  private readonly bindings: Record<string, number>;
  private readonly models: Map<string, string>;
  private readonly recovery: Map<string, RecoveryReceipt>;
  private readonly results: OperationResult[] = [];
  private readonly statuses = new Map<string, OperationResult['status']>();
  private halted = false;

  constructor(private readonly original: Plan, private readonly connection: StateConnection, private readonly options: ApplyOptions) {
    this.bindings = { ...original.bindings };
    this.models = new Map(original.resources.map(resource => [resource.externalId, resource.model]));
    this.recovery = new Map((original.options.recovery ?? []).map(receipt => [receipt.externalId, copy(receipt)]));
  }

  async step(operation: Mutation): Promise<void> {
    if (this.blocked(operation)) {
      this.record({ operation, status: 'skipped', message: 'Earlier required work did not commit' });
      return;
    }
    const attempt = { id: operation.id ?? this.bindings[operation.externalId], partial: false };
    try {
      await this.execute(operation, attempt);
      this.record({ operation, status: 'committed', id: attempt.id });
    } catch (error) {
      this.record({ operation, status: 'failed', ...(attempt.id ? { id: attempt.id } : {}), error,
        message: error instanceof Error ? error.message : String(error), partial: attempt.partial });
      if (this.options.stopOnError !== false) this.halted = true;
    }
  }

  async finish(): Promise<ApplyResult> {
    const results = this.results;
    const result: ApplyResult = { ok: false, committed: results.filter(r => r.status === 'committed').length,
      failed: results.filter(r => r.status === 'failed').length, skipped: results.filter(r => r.status === 'skipped').length,
      results, recovery: [...this.recovery.values()] };
    try {
      result.drift = await plan(this.original.input, this.connection, { ...this.original.options, recovery: result.recovery });
    } catch (error) { result.verificationError = error; }
    result.ok = result.failed === 0 && result.skipped === 0 && !!result.drift && result.drift.operations.length === 0;
    return result;
  }

  private blocked(operation: Mutation): boolean {
    return this.halted || operation.dependsOn.some(key => this.statuses.get(key) !== 'committed')
      || (operation.type === 'activate' && this.results.some(result => result.status !== 'committed'));
  }
  private record(result: OperationResult): void {
    this.results.push(result); this.statuses.set(result.operation.key, result.status);
  }

  private async execute(operation: Mutation, attempt: { id: number | undefined; partial: boolean }): Promise<void> {
    if (!equal(identity(await this.connection.identity()), this.original.target)) fail('TARGET_CHANGED', 'Authenticated connection identity changed during apply');
    const values = this.resolvedValues(operation);
    if (operation.type === 'create') await this.create(operation, values, attempt);
    else if (operation.type === 'adopt') await this.adopt(operation, attempt);
    else await this.write(operation, values, attempt);
    if (operation.model === 'ir.model.fields') await this.checkFieldReady(operation, attempt.id);
  }

  private resolvedValues(operation: Mutation): Row {
    const values = resolveRefs(operation.values, this.bindings) as Row;
    // New Reference targets retain the ordinary symbolic marker in the saved
    // operation. Its exact model lives in the reviewed resource definitions.
    for (const [name, value] of Object.entries(operation.values)) {
      if (this.original.schema[operation.model]?.[name]?.type !== 'reference' || !isResourceRef(value)) continue;
      const model = this.models.get(value.externalId);
      if (!model) fail('UNRESOLVED_REFERENCE', `No managed model for ${value.externalId}`);
      values[name] = `${model},${values[name]}`;
    }
    return values;
  }

  private async create(operation: Mutation, values: Row, attempt: { id: number | undefined; partial: boolean }): Promise<void> {
    const target = this.original.target;
    const receipt: RecoveryReceipt = { version: 1, target, externalId: operation.externalId,
      model: operation.model, intent: digest({ model: operation.model, values, target }), state: 'pending' };
    // A crash between RPC commit and returned ID leaves an explicit uncertain
    // receipt instead of silently allowing a duplicate on the next run.
    await this.save(receipt);
    attempt.partial = true;
    const id = attempt.id = await this.connection.client.create(operation.model, values, operation.context);
    assertId(id, operation.externalId);
    this.bindings[operation.externalId] = id;
    await this.save({ ...receipt, state: 'record-created', id });
    await this.register(operation, id);
    await this.save({ ...receipt, state: 'complete', id });
  }

  private async adopt(operation: Mutation, attempt: { id: number | undefined; partial: boolean }): Promise<void> {
    const id = attempt.id;
    assertId(id, operation.externalId);
    attempt.partial = true;
    await this.register(operation, id);
    const receipt = this.recovery.get(operation.externalId);
    if (receipt) await this.save({ ...receipt, state: 'complete', id });
  }

  private async write(operation: Mutation, values: Row, attempt: { id: number | undefined; partial: boolean }): Promise<void> {
    const id = attempt.id;
    assertId(id, operation.externalId);
    // Activation is final, including after actual post-write reads of all
    // dependencies. Exclude only other pending active=true differences.
    if (operation.type === 'activate') await this.checkActivationReady();
    attempt.partial = true;
    const accepted = operation.type === 'delete' ? await this.connection.client.unlink(operation.model, [id])
      : await this.connection.client.write(operation.model, [id], values, operation.context);
    if (accepted !== true) fail('WRITE_REJECTED', `${operation.key}: Odoo returned a non-success result`);
  }

  private async checkActivationReady(): Promise<void> {
    const check = await plan(this.original.input, this.connection, { ...this.original.options, recovery: [...this.recovery.values()] });
    const remaining = check.operations.filter(op => op.type !== 'activate' && op.type !== 'deactivate');
    if (remaining.length) fail('DEPENDENCIES_NOT_READY', `Refusing cron activation: fresh plan still needs ${remaining.map(op => op.key).join(', ')}`);
  }

  private async checkFieldReady(operation: Mutation, id: number | undefined): Promise<void> {
    const client = this.connection.client;
    const rows = await client.searchRead('ir.model.fields', [['id', '=', id]], { fields: ['model', 'name'], context: operation.context });
    if (rows.length !== 1) fail('FIELD_NOT_READY', `${operation.externalId}: created/updated metadata is not visible`);
    const metadata = await client.call<Record<string, { type: string; store?: boolean; readonly?: boolean }>>(String(rows[0].model), 'fields_get', [], { attributes: ['type', 'store', 'readonly'], context: operation.context });
    const field = metadata[String(rows[0].name)];
    if (!field || field.type !== 'json' || field.store !== false || field.readonly !== true) fail('FIELD_NOT_READY', `${operation.externalId}: fresh target-model metadata is not ready; dependent operations are blocked`);
  }

  private async save(receipt: RecoveryReceipt): Promise<void> {
    this.recovery.set(receipt.externalId, copy(receipt));
    if (!this.options.journal) return;
    try { await this.options.journal.save(copy(receipt)); }
    catch (error) { this.halted = true; throw error; }
  }

  private async register(operation: Mutation, id: number): Promise<void> {
    const { module, name } = xmlid(operation.externalId);
    const rows = await this.connection.client.searchRead('ir.model.data', [['module', '=', module], ['name', '=', name]], {
      fields: ['id', 'model', 'res_id'], limit: 2, order: 'id', context: operation.context,
    });
    if (rows.length) {
      if (rows.length !== 1 || rows[0].model !== operation.model || rows[0].res_id !== id) fail('IDENTITY_COLLISION', `Concurrent XML-ID collision for ${operation.externalId}`);
      return;
    }
    const bindingId = await this.connection.client.create('ir.model.data', { module, name, model: operation.model, res_id: id, noupdate: true }, operation.context);
    assertId(bindingId, `XML ID ${operation.externalId}`);
  }
}
