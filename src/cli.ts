import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';
import { randomUUID } from 'node:crypto';
import { loadResources } from './inspect.js';
import { parseFixture } from './fixtures.js';
import { plan, drift } from './plan.js';
import { apply } from './apply.js';
import { openRecoveryJournal, readRecoveryJournal } from './journal.js';
import type { Plan, PlanOptions, StateConnection } from './state-types.js';
import { StateError } from './state-types.js';
import { equal } from './state-utils.js';

const help = `Usage: stateman <load|inspect> <file-or-directory> [--content-root <directory>] [--fixture]
       stateman <plan|drift> <file-or-directory> --connection <module> [--options <json>] [--journal <json>] [--out <json>] [--fixture]
       stateman apply <reviewed-plan.json> --connection <module> --journal <json>
       stateman --help

Loads trusted TypeScript/ESM modules with ordinary filesystem/network privileges.
--connection explicitly selects a trusted module exporting a StateConnection as default
or connection. That module owns credentials/authentication and retains client safety.
Plans serialize rendered input and observed target assumptions; apply revalidates them.
Plan exits 0; drift exits 0 when converged, 2 for differences; errors/apply failure exit 1.
Apply requires a durable journal for record creation; retain it across crashes and retries.
--fixture reads bounded portable JSON instead of executing resource modules.
No implicit action execution, addon changes, broad live export/import or snapshots.`;

async function connectionFrom(path: string): Promise<StateConnection> {
  const loader = register({ namespace: randomUUID() });
  try {
    const module = await loader.import(pathToFileURL(resolve(path)).href, import.meta.url) as { default?: StateConnection; connection?: StateConnection };
    const connection = module.default ?? module.connection;
    if (!connection?.client || typeof connection.identity !== 'function' || typeof connection.serverInfo !== 'function') throw new StateError('INVALID_CONNECTION', 'Connection module must export a StateConnection');
    return connection;
  } finally { await loader.unregister(); }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      help: { type: 'boolean', short: 'h' }, fixture: { type: 'boolean' }, 'content-root': { type: 'string' }, connection: { type: 'string' },
      options: { type: 'string' }, journal: { type: 'string' }, out: { type: 'string' },
    } });
    if (values.help) { console.log(help); return 0; }
    const [command, path] = positionals;
    if (!['load', 'inspect', 'plan', 'apply', 'drift'].includes(command ?? '') || !path || positionals.length !== 2) throw new StateError('USAGE', help);
    if (command === 'apply' && values.fixture) throw new StateError('USAGE', 'Apply takes a reviewed plan, not a fixture');
    const input = command === 'apply' ? undefined : values.fixture
      ? parseFixture(await readFile(path, 'utf8'))
      : await loadResources(path, { contentRoot: values['content-root'] });
    if (['load', 'inspect'].includes(command)) {
      console.log(JSON.stringify(input, null, 2)); return 0;
    }
    if (!values.connection) throw new StateError('CONNECTION_REQUIRED', 'Select an explicit --connection module');
    if (command === 'apply' && !values.journal) throw new StateError('RECOVERY_JOURNAL_REQUIRED', 'Apply requires an explicit --journal path');
    if (values.journal && [path, values.connection, values.options, values.out].some(other => other && resolve(other) === resolve(values.journal!))) throw new StateError('PATH_COLLISION', 'Journal must have its own path, separate from inputs and output');
    const options: PlanOptions = values.options ? JSON.parse(await readFile(values.options, 'utf8')) as PlanOptions : {};
    if (command === 'apply') {
      const reviewed = JSON.parse(await readFile(path, 'utf8')) as Plan;
      const journal = await openRecoveryJournal(values.journal!);
      try {
        if (!equal(journal.receipts, reviewed.options?.recovery ?? [])) throw new StateError('JOURNAL_CHANGED', 'Journal receipts differ from this reviewed plan; re-plan with --journal before applying');
        const connection = await connectionFrom(values.connection);
        const result = await apply(reviewed, connection, { journal });
        const output = JSON.stringify(result, null, 2) + '\n';
        if (values.out) await writeFile(values.out, output, { mode: 0o600 });
        console.log(output.trimEnd()); return result.ok ? 0 : 1;
      } finally { await journal.close(); }
    }
    if (values.journal) options.recovery = await readRecoveryJournal(values.journal);
    const connection = await connectionFrom(values.connection);
    const result = command === 'drift' ? await drift(input!, connection, options) : await plan(input!, connection, options);
    const output = JSON.stringify(result, null, 2) + '\n';
    if (values.out) await writeFile(values.out, output, { mode: 0o600 });
    console.log(output.trimEnd());
    return command === 'drift' && 'converged' in result && !result.converged ? 2 : 0;
  } catch (error) {
    console.error(JSON.stringify({ code: error instanceof StateError ? error.code : 'ERROR', message: error instanceof Error ? error.message : String(error) }));
    return 1;
  }
}
