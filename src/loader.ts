// Adapted from Marc Fargas, odoo-toolbox src/engine/evaluate.ts at
// 01512004814df8887a457e5ed9d6c5769fe3b730. SPDX-License-Identifier: LGPL-3.0-only.
import { readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';
import { randomUUID } from 'node:crypto';
import { isResourceDefinition, isModelPolicy } from './dsl/types.js';
import type { ResourceDefinition, ModelPolicy } from './dsl/types.js';

export interface EvaluationResult {
  resources: ResourceDefinition[];
  policies: ModelPolicy[];
  files: string[];
}

/** Sorted ESM discovery. Hidden directories, symlinks, build output and declarations are skipped. */
async function collectFiles(path: string): Promise<string[]> {
  if ((await stat(path)).isFile()) {
    if (!/\.(?:m?[jt]s)$/.test(path) || /\.d\.[cm]?ts$/.test(path)) {
      throw new Error(`Unsupported module: ${path}; use ESM .ts, .mts, .js or .mjs`);
    }
    return [path];
  }
  const files: string[] = [];
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build'].includes(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(child));
    else if (entry.isFile() && /\.(?:m?[jt]s)$/.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name)) files.push(child);
  }
  return files.sort();
}

/** Executes trusted modules, collecting exported definitions and nested arrays, never invoking helper functions.
 * A fresh scoped module cache is used per evaluation; re-exports share one cache within the run.
 */
export async function evaluate(path: string): Promise<EvaluationResult> {
  const files = await collectFiles(resolve(path));
  const resources: ResourceDefinition[] = [];
  const policies: ModelPolicy[] = [];
  const seen = new WeakSet<object>();
  function collect(value: unknown, ancestors = new Set<unknown>()): void {
    if (Array.isArray(value)) {
      if (ancestors.has(value)) throw new Error('Cyclic exported array');
      const next = new Set(ancestors).add(value);
      for (const item of value) collect(item, next);
    } else if (isResourceDefinition(value) || isModelPolicy(value)) {
      if (seen.has(value)) return;
      seen.add(value);
      if (isResourceDefinition(value)) resources.push(value);
      else policies.push(value);
    }
  }
  const loader = register({ namespace: randomUUID() });
  try {
    for (const file of files) {
      const mod = await loader.import(pathToFileURL(file).href, import.meta.url) as Record<string, unknown>;
      for (const key of Object.keys(mod).sort()) collect(mod[key]);
    }
  } finally {
    await loader.unregister();
  }
  return { resources, policies, files };
}
