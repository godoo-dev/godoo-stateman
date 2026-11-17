import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
const modes = ['offline', 'package', 'odoo18', 'ci'];
if (!modes.includes(mode) || process.argv.length !== 3) {
  console.error(`Usage: node scripts/check.mjs ${modes.join('|')}`);
  process.exit(2);
}
const sourceChecks = [
  ['npm', ['run', 'lint']],
  ['npm', ['run', 'format:check']],
  [process.execPath, ['--test', 'scripts/release.test.mjs', 'scripts/recover-release.test.mjs']],
  ['npm', ['run', 'typecheck']],
  ['npm', ['test']],
];
const packageCheck = [process.execPath, ['scripts/package-check.mjs']];
// CI builds once: npm pack's prepack build inside the package check replaces the offline build.
const commands = {
  offline: [...sourceChecks, ['npm', ['run', 'build']]],
  package: [packageCheck],
  odoo18: [[process.execPath, ['scripts/odoo18.mjs']]],
  ci: [...sourceChecks, packageCheck],
}[mode];
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (mode === 'ci') {
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (status.status !== 0 || status.stdout.trim()) {
    console.error('The checkout is dirty after the checks (uncommitted work or files the checks wrote); release refuses a dirty candidate:\n' + status.stdout);
    process.exit(1);
  }
}
