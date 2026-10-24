import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';

// Reuse dependency versions/integrities from installed acceptance. Only the
// already verified candidate archive location changes between Actions jobs.
export function frozenConsumer(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  const read = name => {
    const bytes = readFileSync(join(directory, name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.proofHashes?.[name], 'Frozen consumer proof changed: ' + name);
    return JSON.parse(bytes);
  };
  const pkg = read('installed-package.json');
  const lock = read('installed-package-lock.json');
  const artifact = manifest.artifacts.find(item => item.package === '@godoo-dev/stateman');
  assert(artifact && artifact.filename === basename(artifact.filename), 'Invalid Stateman artifact');
  const archive = realpathSync(join(directory, artifact.filename));
  assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), artifact.sha256, 'Frozen consumer archive changed');
  assert.equal(lock.lockfileVersion, 3, 'npm v3 consumer lock required');
  assert.equal(lock.packages['node_modules/@godoo-dev/stateman'].version, artifact.version);
  const spec = 'file:' + archive;
  pkg.dependencies['@godoo-dev/stateman'] = spec;
  lock.packages[''].dependencies['@godoo-dev/stateman'] = spec;
  lock.packages['node_modules/@godoo-dev/stateman'].resolved = spec;
  return { package: pkg, lock };
}
