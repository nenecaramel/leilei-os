import { readdirSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { constants } from 'node:os';

export function testConcurrency(env, serial = false) {
  // Opt-in suites may share a database, simulator, browser or fixture path.
  const optIn = Object.entries(env).some(([key, value]) =>
    /^(RUN_|UI_|.*SIMULATOR|SAFARI_WEBDRIVER_URL$|DATABASE_URL$|LIFECYCLE_BOUNDARY_FIXTURES$)/.test(key) &&
    value != null && value !== '');
  return serial || optIn ? 1 : 2;
}

export function testFiles(root) {
  const result = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.test.ts')) result.push(path);
    }
  }
  visit(join(root, 'tests'));
  return result.sort();
}

export function testPlan(root, args = [], env = process.env) {
  let serial = false, profile;
  const forwarded = [];
  for (const argument of args) {
    if (argument === '--') continue;
    if (argument === '--serial') serial = true;
    else if (argument === '--profile') profile = resolve(root, 'test-results/timings.jsonl');
    else if (argument.startsWith('--profile=')) profile = resolve(root, argument.slice(10));
    else if (argument.startsWith('--test-concurrency') || argument.startsWith('--test-isolation') || argument.startsWith('--experimental-test-isolation')) {
      throw new Error('Use --serial; concurrency and process isolation are managed by the test runner.');
    } else forwarded.push(argument);
  }
  const concurrency = testConcurrency(env, serial);
  const argv = [join(root, 'node_modules/tsx/dist/cli.mjs'),
    '--tsconfig', join(root, 'web/tsconfig.app.json'),
    '--import', join(root, 'tests/register-css-loader.mjs'),
    '--test', `--test-concurrency=${concurrency}`];
  if (profile) argv.push('--test-reporter=spec', '--test-reporter-destination=stdout',
    `--test-reporter=${join(root, 'scripts/test-timing-reporter.mjs')}`, `--test-reporter-destination=${profile}`);
  return { concurrency, profile, argv: [...argv, ...forwarded, ...testFiles(root)] };
}

export async function runTests(root, args = [], env = process.env) {
  const plan = testPlan(root, args, env);
  if (plan.profile) mkdirSync(dirname(plan.profile), { recursive: true });
  const child = spawn(process.execPath, plan.argv, { cwd: root, env, stdio: 'inherit' });
  const handlers = new Map(['SIGINT', 'SIGTERM'].map(signal => {
    const handler = () => child.kill(signal);
    process.on(signal, handler);
    return [signal, handler];
  }));
  try {
    return await new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => accept(code ?? 128 + (constants.signals[signal] ?? 1)));
    });
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try { process.exitCode = await runTests(root, process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
