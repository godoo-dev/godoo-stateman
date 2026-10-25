import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const names = ['@godoo-dev/client', '@godoo-dev/introspection', '@godoo-dev/testcontainers'];
export function suppliers(manifestPath) {
  if (!manifestPath) return null;
  const path = realpathSync(manifestPath);
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  assert.match(manifest.source?.commit ?? '', /^[a-f0-9]{40}$/, 'Supplier source commit required');
  assert.equal(manifest.source.dirty, '', 'Supplier candidate must be clean');
  assert.equal(manifest.packages?.length, names.length, 'Exactly three supplier packages required');
  const dependencies = {};
  for (const name of names) {
    const matches = manifest.packages.filter(item => item.name === name);
    assert.equal(matches.length, 1, 'Missing or duplicate supplier: ' + name);
    const item = matches[0];
    const file = realpathSync(resolve(dirname(path), item.file));
    const child = relative(dirname(path), file);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child), 'Supplier file escapes manifest directory');
    assert.match(item.sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), item.sha256, 'Supplier hash mismatch: ' + name);
    dependencies[name] = 'file:' + file;
  }
  return { dependencies, overrides: { '@godoo-dev/client': '$@godoo-dev/client', '@godoo-dev/introspection': '$@godoo-dev/introspection' }, manifest };
}

export function proveSuppliers(supplier, consumer) {
  if (!supplier) return null;
  const proof = {};
  for (const item of supplier.manifest.packages) {
    const unpack = mkdtempSync(join(tmpdir(), 'stateman-supplier-bytes-'));
    try {
      execFileSync('tar', ['-xzf', supplier.dependencies[item.name].slice(5), '-C', unpack]);
      const installed = realpathSync(join(consumer, 'node_modules', item.name));
      assert.ok(installed.startsWith(realpathSync(consumer) + '/'), 'Supplier resolved outside consumer');
      assert.equal(JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).version, item.version);
      const hashes = {};
      const walk = (directory, prefix = '') => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = join(prefix, entry.name);
          if (entry.isDirectory()) walk(join(directory, entry.name), path);
          else {
            assert.ok(entry.isFile(), 'Supplier archives must contain regular files');
            const digest = bytes => createHash('sha256').update(bytes).digest('hex');
            const expected = digest(readFileSync(join(directory, entry.name)));
            assert.equal(digest(readFileSync(join(installed, path))), expected, item.name + '/' + path);
            hashes[path] = expected;
          }
        }
      };
      walk(join(unpack, 'package'));
      proof[item.name] = { version: item.version, archiveSha256: item.sha256, files: hashes };
    } finally { rmSync(unpack, { recursive: true, force: true }); }
  }
  return proof;
}
