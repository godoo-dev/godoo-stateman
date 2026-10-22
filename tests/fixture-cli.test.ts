import { expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';

it('loads JSON without code execution and rejects malformed fixtures before importing a connection', async () => {
  const area = await mkdtemp(join(tmpdir(), 'stateman-fixture-'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const path = join(area, 'state.json');
    await writeFile(path, JSON.stringify({ format: 'godoo-state-fixture', version: 1, namespaces: ['seed'], resources: [{ externalId: 'seed.root', model: 'x', values: { name: 'Test' } }] }));
    expect(await main(['load', path, '--fixture'])).toBe(0);
    expect(JSON.parse(log.mock.calls[0][0]).resources[0].externalId).toBe('seed.root');
    const poison = join(area, 'poison.mts');
    await writeFile(poison, "throw new Error('POISON_MODULE_EXECUTED');");
    for (const command of ['plan', 'drift']) {
      expect(await main([command, poison])).toBe(1);
      expect(error.mock.calls.at(-1)?.[0]).toContain('CONNECTION_REQUIRED');
    }
    await writeFile(path, '{"format":"unknown"}');
    expect(await main(['plan', path, '--fixture', '--connection', join(area, 'must-not-execute.ts')])).toBe(1);
    expect(error.mock.calls.at(-1)?.[0]).toContain('Invalid state fixture');
    expect(await main(['apply', path, '--fixture', '--connection', 'unused.ts'])).toBe(1);
    expect(error.mock.calls.at(-1)?.[0]).toContain('reviewed plan');
  } finally { log.mockRestore(); error.mockRestore(); await rm(area, { recursive: true, force: true }); }
});
