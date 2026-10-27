import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Test environment inputs only. Authoring helpers never install server addons.
export async function misPrerequisites(directory) {
  const addons = join(directory, 'mis-addons'); mkdirSync(addons);
  const inputs = [
    { repo: 'mis-builder', commit: '4f9eef0954af7dfdb1d13451f4d860602b074cda', addon: 'mis_builder' },
    { repo: 'reporting-engine', commit: '8753a2dfc6ff290b1547b3580c392661a1aa39c7', addon: 'report_xlsx' },
    { repo: 'server-ux', commit: '3abc366f5c41698105de433407cffbbabcc699f9', addon: 'date_range' },
  ];
  const proof = [];
  for (const input of inputs) {
    const url = `https://codeload.github.com/OCA/${input.repo}/tar.gz/${input.commit}`;
    const response = await fetch(url); assert.ok(response.ok, url);
    const bytes = Buffer.from(await response.arrayBuffer());
    const archive = join(directory, input.repo + '.tgz'); writeFileSync(archive, bytes);
    execFileSync('tar', ['-xzf', archive, '-C', addons, '--strip-components=1', `${input.repo}-${input.commit}/${input.addon}`]);
    proof.push({ ...input, url, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const response = await fetch('https://pypi.org/pypi/openupgradelib/3.13.7/json'); assert.ok(response.ok);
  const wheel = (await response.json()).urls.find(v => v.filename.endsWith('.whl')); assert.ok(wheel);
  const download = await fetch(wheel.url); assert.ok(download.ok);
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), wheel.digests.sha256);
  writeFileSync(join(directory, wheel.filename), bytes);
  proof.push({ package: 'openupgradelib', version: '3.13.7', url: wheel.url, sha256: wheel.digests.sha256 });
  return { addons, wheel: join(directory, wheel.filename), proof };
}
