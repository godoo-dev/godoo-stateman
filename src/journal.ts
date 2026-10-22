import { open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { copy, fail } from './state-utils.js';
import type { RecoveryJournal, RecoveryReceipt } from './state-types.js';

export async function readRecoveryJournal(path: string): Promise<RecoveryReceipt[]> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(value)) fail('INVALID_JOURNAL', 'Recovery journal must contain a receipt array');
    return value as RecoveryReceipt[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** One local CLI writer per explicit journal path. A stale lock needs operator
 * investigation, never automatic expiry. Directory must already exist.
 */
export async function openRecoveryJournal(path: string): Promise<RecoveryJournal & { receipts: RecoveryReceipt[]; close(): Promise<void> }> {
  const destination = resolve(path), lockPath = `${destination}.lock`;
  const lock = await open(lockPath, 'wx', 0o600);
  let receipts: RecoveryReceipt[];
  try { receipts = await readRecoveryJournal(destination); }
  catch (error) { await lock.close(); await unlink(lockPath); throw error; }
  return {
    receipts,
    async save(receipt) {
      if (receipt.state === 'pending' && receipts.some(previous => previous.externalId === receipt.externalId)) fail('RECOVERY_CONFLICT', `Retained receipt for ${receipt.externalId} must be reconciled before another create`);
      const next = receipts.filter(previous => previous.externalId !== receipt.externalId);
      next.push(copy(receipt)); next.sort((a, b) => a.externalId.localeCompare(b.externalId));
      const temporary = `${destination}.${randomUUID()}.tmp`;
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(next, null, 2) + '\n'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, destination);
      const directory = await open(dirname(destination), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      receipts.splice(0, receipts.length, ...next);
    },
    async close() { await lock.close(); await unlink(lockPath); },
  };
}
