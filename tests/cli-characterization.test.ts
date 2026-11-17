// Characterization of the CLI entry point before splitting main() for the
// complexity limit. Exit codes, stdout and stderr are pinned per argv.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { FakeClient } from './fake-client.js';

const fake = fileURLToPath(new URL('./fake-client.ts', import.meta.url));
const stateman = fileURLToPath(new URL('../src/index.ts', import.meta.url));
let area = '';
const shared = globalThis as { statemanCliClient?: FakeClient };

async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const code = await main(args.map(arg => arg.replace('<area>', area)));
    const text = (calls: unknown[][]): string => calls.map(call => String(call[0])).join('\n').replaceAll(area, '<area>')
      // The plan digest covers the temporary input path.
      .replace(/"digest": "[0-9a-f]{64}"/g, '"digest": "<digest>"');
    return { code, out: text(log.mock.calls), err: text(error.mock.calls) };
  } finally { log.mockRestore(); error.mockRestore(); }
}

beforeAll(async () => {
  area = await mkdtemp(join(tmpdir(), 'stateman-cli-'));
  await writeFile(join(area, 'resources.mts'), `import { resource } from ${JSON.stringify(stateman)};\nexport const root = resource('x', 'cli.root', { name: 'Root' });\n`);
  await writeFile(join(area, 'connection.mts'), `import type { FakeClient } from ${JSON.stringify(fake)};\nexport default (globalThis as { statemanCliClient?: FakeClient }).statemanCliClient!.connection();\n`);
  await writeFile(join(area, 'empty-connection.mts'), 'export const other = 1;\n');
  await writeFile(join(area, 'options.json'), JSON.stringify({ select: ['cli.root'] }));
});
afterAll(async () => { await rm(area, { recursive: true, force: true }); delete shared.statemanCliClient; });

describe('stateman CLI characterization', () => {
  it.each([
    ['help', ['--help']],
    ['no command', []],
    ['unknown command', ['export', '<area>/resources.mts']],
    ['missing path', ['plan']],
    ['extra positional', ['load', '<area>/resources.mts', 'extra']],
    ['plan without connection', ['plan', '<area>/resources.mts']],
    ['apply with fixture', ['apply', '<area>/plan.json', '--fixture', '--connection', '<area>/connection.mts']],
    ['apply without journal', ['apply', '<area>/plan.json', '--connection', '<area>/connection.mts']],
    ['journal equals out', ['plan', '<area>/resources.mts', '--connection', '<area>/connection.mts', '--journal', '<area>/same.json', '--out', '<area>/same.json']],
    ['connection without export', ['plan', '<area>/resources.mts', '--connection', '<area>/empty-connection.mts']],
  ])('%s', async (_name, args) => {
    shared.statemanCliClient = new FakeClient();
    expect(await run(args)).toMatchSnapshot();
  });

  it('plans with options and out, applies with a journal, then reports drift', async () => {
    const client = shared.statemanCliClient = new FakeClient();
    const planned = await run(['plan', '<area>/resources.mts', '--connection', '<area>/connection.mts', '--options', '<area>/options.json', '--journal', '<area>/journal.json', '--out', '<area>/plan.json']);
    expect(planned.code).toBe(0);
    expect(planned).toMatchSnapshot('plan');
    expect(await run(['load', '<area>/resources.mts'])).toMatchSnapshot('load');
    expect(await run(['inspect', '<area>/resources.mts'])).toMatchSnapshot('inspect');
    expect(JSON.parse(await readFile(join(area, 'plan.json'), 'utf8')).operations.map((op: { key: string }) => op.key)).toEqual(['cli.root:record']);
    expect(await run(['drift', '<area>/resources.mts', '--connection', '<area>/connection.mts'])).toMatchSnapshot('drift with changes');
    const applied = await run(['apply', '<area>/plan.json', '--connection', '<area>/connection.mts', '--journal', '<area>/journal.json', '--out', '<area>/result.json']);
    expect(applied).toMatchSnapshot('apply');
    expect(JSON.parse(await readFile(join(area, 'result.json'), 'utf8')).ok).toBe(true);
    expect(client.mutations.map(m => `${m.method}:${m.model}`)).toEqual(['create:x', 'create:ir.model.data']);
    expect(await run(['drift', '<area>/resources.mts', '--connection', '<area>/connection.mts', '--journal', '<area>/journal.json'])).toMatchSnapshot('converged drift');
    const changed = await run(['apply', '<area>/plan.json', '--connection', '<area>/connection.mts', '--journal', '<area>/journal.json']);
    expect({ code: changed.code, err: changed.err }).toMatchSnapshot();
  });

  it('exits 1 when apply fails', async () => {
    const client = shared.statemanCliClient = new FakeClient();
    await run(['plan', '<area>/resources.mts', '--connection', '<area>/connection.mts', '--out', '<area>/fail-plan.json']);
    client.failure = () => new Error('refused');
    const failed = await run(['apply', '<area>/fail-plan.json', '--connection', '<area>/connection.mts', '--journal', '<area>/fail-journal.json']);
    expect(failed.code).toBe(1);
    expect(JSON.parse(failed.out).ok).toBe(false);
  });
});
