import { parseArgs } from 'node:util';
import { loadResources } from './inspect.js';
import { ReconciliationUnavailableError } from './index.js';

const help = `Usage: stateman <load|inspect> <file-or-directory> [--content-root <directory>]
       stateman --help

Executes trusted TypeScript/ESM modules and prints offline inspection JSON.
Exported resources and nested arrays are collected; helpers are not called.
Relative mdFile/CSS paths use the input directory, or --content-root.
TS modules are executable code with normal filesystem/network privileges.
Plan, apply, drift, verify, snapshots and imports are unavailable. No Odoo connection is made by the CLI.`;

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { help: { type: 'boolean', short: 'h' }, 'content-root': { type: 'string' } } });
    if (values.help) { console.log(help); return 0; }
    const [command, path] = positionals;
    if (['plan', 'apply', 'drift', 'verify', 'snapshot', 'export', 'import'].includes(command ?? '')) throw new ReconciliationUnavailableError(command!);
    if (!['load', 'inspect'].includes(command ?? '') || !path || positionals.length !== 2) throw new Error(help);
    console.log(JSON.stringify(await loadResources(path, { contentRoot: values['content-root'] }), null, 2));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
