// Minimal representative helper; no consumer business code is included.
import { readFileSync } from 'node:fs';
export function buildCode(body: URL): string {
  const prelude = readFileSync(new URL('./prelude.py', import.meta.url), 'utf8');
  return prelude + '\n' + readFileSync(body, 'utf8');
}
export function unusedHelper(): never { throw new Error('Loader must not invoke helper functions'); }
