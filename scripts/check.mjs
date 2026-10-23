import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
if (!['offline', 'package', 'odoo18'].includes(mode) || process.argv.length !== 3) {
  console.error('Usage: node scripts/check.mjs offline|package|odoo18');
  process.exit(2);
}
const commands = mode === 'offline'
  ? [['npm', ['run', 'typecheck']], ['npm', ['test']], ['npm', ['run', 'build']]]
  : [[process.execPath, [mode === 'package' ? 'scripts/package-check.mjs' : 'scripts/odoo18.mjs']]];
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
