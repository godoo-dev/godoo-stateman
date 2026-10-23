import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const root = process.cwd();

describe('native candidate admission', () => {
  function fixture(run: (area: string, manifest: Record<string, unknown>, env: NodeJS.ProcessEnv) => void) {
    const area = mkdtempSync(join(tmpdir(), 'stateman-candidate-control-'));
    const artifact = { package: '@godoo-dev/stateman', version: '0.1.0-foundation.0', filename: 'candidate.tgz', sha256: digest('candidate') };
    const manifest = { sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), artifacts: [artifact], supplierQualification: false };
    writeFileSync(join(area, artifact.filename), 'candidate');
    for (const command of ['docker', 'npm']) {
      const path = join(area, command);
      writeFileSync(path, '#!/bin/sh\necho EXTERNAL_COMMAND_SENTINEL >&2\nexit 77\n');
      chmodSync(path, 0o700);
    }
    const env = { ...process.env, PATH: area + ':' + process.env.PATH, GODOO_ARTIFACT_DIR: area, GODOO_SUPPLIER_MANIFEST: '', GODOO_ENABLE_ODOO19: '1' };
    try { run(area, manifest, env); } finally { rmSync(area, { recursive: true, force: true }); }
  }
  for (const change of ['suppliers', 'artifact', 'source', 'legacy']) {
    it('refuses prior18 proof with ' + change + ' mismatch before Docker', () => fixture((area, manifest, env) => {
      const old = { ...manifest, ...(change === 'suppliers' ? { suppliers: { packages: [{ sha256: 'old supplier' }] }, supplierQualification: true } : change === 'artifact' ? { artifacts: [] } : change === 'source' ? { sourceHead: 'other' } : {}) };
      const artifact = (manifest.artifacts as { sha256: string }[])[0];
      writeFileSync(join(area, 'manifest.json'), JSON.stringify(manifest));
      writeFileSync(join(area, 'odoo18-result.json'), JSON.stringify({ passed: true, allOwnedResourcesAbsent: true, artifact, sourceHead: manifest.sourceHead, ...(change === 'legacy' ? {} : { candidateManifestSha256: digest(JSON.stringify(old)) }) }));
      const result = spawnSync(process.execPath, ['scripts/odoo18.mjs', '19'], { cwd: root, env, encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('same complete candidate manifest and supplier inputs');
      expect(result.stderr).not.toContain('EXTERNAL_COMMAND_SENTINEL');
    }));
  }
  it('admits the exact full candidate to the Docker availability check', () => fixture((area, manifest, env) => {
    const bytes = JSON.stringify(manifest);
    writeFileSync(join(area, 'manifest.json'), bytes);
    writeFileSync(join(area, 'odoo18-result.json'), JSON.stringify({ passed: true, allOwnedResourcesAbsent: true, artifact: (manifest.artifacts as unknown[])[0], sourceHead: manifest.sourceHead, candidateManifestSha256: digest(bytes) }));
    const result = spawnSync(process.execPath, ['scripts/odoo18.mjs', '19'], { cwd: root, env, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('EXTERNAL_COMMAND_SENTINEL');
    expect(result.stderr).not.toContain('same complete candidate manifest');
  }));
  it('refuses overwriting a candidate before npm pack', () => fixture((area, manifest, env) => {
    writeFileSync(join(area, 'manifest.json'), JSON.stringify(manifest));
    const result = spawnSync(process.execPath, ['scripts/package-check.mjs'], { cwd: root, env, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Candidate manifest already exists');
    expect(result.stderr).not.toContain('EXTERNAL_COMMAND_SENTINEL');
  }));
});
