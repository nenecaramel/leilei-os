import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Named test-file suites live in tests/suites.json instead of package.json
// one-liners. Each suite runs its tsx files, then its plain-node bridge files.
export function suitePlan(root, name) {
  const suites = JSON.parse(readFileSync(join(root, 'tests/suites.json'), 'utf8'));
  const suite = Object.hasOwn(suites, name) ? suites[name] : undefined;
  if (!suite) throw new Error(`Unknown test suite: ${name}. Known: ${Object.keys(suites).join(', ')}`);
  const steps = [];
  if (suite.tsx.length) steps.push([join(root, 'node_modules/tsx/dist/cli.mjs'), '--test',
    ...(suite.serial ? ['--test-concurrency=1'] : []), ...suite.tsx]);
  if (suite.node.length) steps.push(['--test', ...suite.node]);
  return steps;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    for (const args of suitePlan(root, process.argv[2] ?? '')) {
      const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
      if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
