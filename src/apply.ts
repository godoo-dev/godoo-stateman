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
  const bindings = { ...original.bindings };
  const models = new Map(original.resources.map(resource => [resource.externalId, resource.model]));
  const recovery = new Map((original.options.recovery ?? []).map(receipt => [receipt.externalId, copy(receipt)]));
  const results: OperationResult[] = [];
  const statuses = new Map<string, OperationResult['status']>();
  let halted = false;

  async function save(receipt: RecoveryReceipt): Promise<void> {
    recovery.set(receipt.externalId, copy(receipt));
    if (options.journal) {
      try { await options.journal.save(copy(receipt)); }
      catch (error) { halted = true; throw error; }
    }
  }
  async function register(operation: Mutation, id: number): Promise<void> {
    const { module, name } = xmlid(operation.externalId);
    const rows = await connection.client.searchRead('ir.model.data', [['module', '=', module], ['name', '=', name]], {
      fields: ['id', 'model', 'res_id'], limit: 2, order: 'id', context: operation.context,
    });
    if (rows.length) {
      if (rows.length !== 1 || rows[0].model !== operation.model || rows[0].res_id !== id) fail('IDENTITY_COLLISION', `Concurrent XML-ID collision for ${operation.externalId}`);
      return;
    }
    const bindingId = await connection.client.create('ir.model.data', { module, name, model: operation.model, res_id: id, noupdate: true }, operation.context);
    assertId(bindingId, `XML ID ${operation.externalId}`);
  }
  for (const operation of original.operations) {
    if (halted || operation.dependsOn.some(key => statuses.get(key) !== 'committed') || (operation.type === 'activate' && results.some(result => result.status !== 'committed'))) {
      const result: OperationResult = { operation, status: 'skipped', message: 'Earlier required work did not commit' };
      results.push(result); statuses.set(operation.key, result.status); continue;
    }
    let id = operation.id ?? bindings[operation.externalId];
    let partial = false;
    try {
      if (!equal(identity(await connection.identity()), original.target)) fail('TARGET_CHANGED', 'Authenticated connection identity changed during apply');
      const values = resolveRefs(operation.values, bindings) as Row;
      // New Reference targets retain the ordinary symbolic marker in the saved
      // operation. Its exact model lives in the reviewed resource definitions.
      for (const [name, value] of Object.entries(operation.values)) {
        if (original.schema[operation.model]?.[name]?.type !== 'reference' || !isResourceRef(value)) continue;
        const model = models.get(value.externalId);
        if (!model) fail('UNRESOLVED_REFERENCE', `No managed model for ${value.externalId}`);
        values[name] = `${model},${values[name]}`;
      }
      if (operation.type === 'create') {
        const receipt: RecoveryReceipt = { version: 1, target: original.target, externalId: operation.externalId,
          model: operation.model, intent: digest({ model: operation.model, values, target: original.target }), state: 'pending' };
        // A crash between RPC commit and returned ID leaves an explicit uncertain
        // receipt instead of silently allowing a duplicate on the next run.
        await save(receipt);
        partial = true;
        id = await connection.client.create(operation.model, values, operation.context);
        assertId(id, operation.externalId);
        bindings[operation.externalId] = id;
        await save({ ...receipt, state: 'record-created', id });
        await register(operation, id);
        await save({ ...receipt, state: 'complete', id });
      } else if (operation.type === 'adopt') {
        assertId(id, operation.externalId);
        partial = true;
        await register(operation, id);
        const receipt = recovery.get(operation.externalId);
        if (receipt) await save({ ...receipt, state: 'complete', id });
      } else {
        assertId(id, operation.externalId);
        // Activation is final, including after actual post-write reads of all
        // dependencies. Exclude only other pending active=true differences.
        if (operation.type === 'activate') {
          const check = await plan(original.input, connection, { ...original.options, recovery: [...recovery.values()] });
          const remaining = check.operations.filter(op => op.type !== 'activate' && op.type !== 'deactivate');
          if (remaining.length) fail('DEPENDENCIES_NOT_READY', `Refusing cron activation: fresh plan still needs ${remaining.map(op => op.key).join(', ')}`);
        }
        partial = true;
        const accepted = operation.type === 'delete' ? await connection.client.unlink(operation.model, [id])
          : await connection.client.write(operation.model, [id], values, operation.context);
        if (accepted !== true) fail('WRITE_REJECTED', `${operation.key}: Odoo returned a non-success result`);
      }
      if (operation.model === 'ir.model.fields') {
        const rows = await connection.client.searchRead('ir.model.fields', [['id', '=', id]], { fields: ['model', 'name'], context: operation.context });
        if (rows.length !== 1) fail('FIELD_NOT_READY', `${operation.externalId}: created/updated metadata is not visible`);
        const metadata = await connection.client.call<Record<string, { type: string; store?: boolean; readonly?: boolean }>>(String(rows[0].model), 'fields_get', [], { attributes: ['type', 'store', 'readonly'], context: operation.context });
        const field = metadata[String(rows[0].name)];
        if (!field || field.type !== 'json' || field.store !== false || field.readonly !== true) fail('FIELD_NOT_READY', `${operation.externalId}: fresh target-model metadata is not ready; dependent operations are blocked`);
      }
      const result: OperationResult = { operation, status: 'committed', id };
      results.push(result); statuses.set(operation.key, result.status);
    } catch (error) {
      const result: OperationResult = { operation, status: 'failed', ...(id ? { id } : {}), error,
        message: error instanceof Error ? error.message : String(error), partial };
      results.push(result); statuses.set(operation.key, result.status);
      if (options.stopOnError !== false) halted = true;
    }
  }
  const result: ApplyResult = { ok: false, committed: results.filter(r => r.status === 'committed').length,
    failed: results.filter(r => r.status === 'failed').length, skipped: results.filter(r => r.status === 'skipped').length,
    results, recovery: [...recovery.values()] };
  try {
    result.drift = await plan(original.input, connection, { ...original.options, recovery: result.recovery });
  } catch (error) { result.verificationError = error; }
  result.ok = result.failed === 0 && result.skipped === 0 && !!result.drift && result.drift.operations.length === 0;
  return result;
}
