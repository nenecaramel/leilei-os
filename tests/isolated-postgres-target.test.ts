import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve('scripts/run-isolated-postgres-regressions.mjs');
function run(t: test.TestContext, url: string | undefined, extra: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'leileios-pg-target-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const marker = join(root, 'commands.txt');
  writeFileSync(join(root, 'pnpm'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(marker)},process.argv.slice(2).join(' ')+'\\n');\n`, { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('PG') || /DATABASE|RAILWAY|ANTHROPIC|OPENAI|TOKEN|SECRET|PASSWORD/.test(key)) delete env[key];
  Object.assign(env, { PATH: root + ':' + process.env.PATH, NODE_ENV: 'test', RUN_ISOLATED_POSTGRES_REGRESSIONS: '1', ...extra });
  if (url !== undefined) env.DATABASE_URL = url;
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 12_000 });
  return { result, calls: existsSync(marker) ? readFileSync(marker, 'utf8') : '' };
}
for (const [name, url] of [
  ['remote test-named database', 'postgres://synthetic:PRIVATE_VALUE@database.example.invalid/leileios_test'],
  ['connection parameter override', 'postgres://synthetic:PRIVATE_VALUE@127.0.0.1/leileios_test?host=database.example.invalid'],
  ['invalid percent escape', 'postgres://synthetic:PRIVATE_VALUE@127.0.0.1/test%ZZ'],
  ['wrong protocol', 'https://synthetic:PRIVATE_VALUE@127.0.0.1/leileios_test'],
  ['non-test database', 'postgres://synthetic:PRIVATE_VALUE@127.0.0.1/leileios'],
  ['unavailable local server', 'postgres://synthetic:PRIVATE_VALUE@127.0.0.1:1/leileios_test'],
] as const) {
  test(`isolated runner rejects ${name} before migration or tests`, (t) => {
    const { result, calls } = run(t, url);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(calls, '', 'no mutation command may run before verified connection');
    assert.ok(!result.stderr.includes('PRIVATE_VALUE'));
  });
}
test('isolated runner requires explicit destructive-suite acknowledgement', (t) => {
  const { result, calls } = run(t, 'postgres://synthetic@127.0.0.1/leileios_test', { RUN_ISOLATED_POSTGRES_REGRESSIONS: '0' });
  assert.equal(result.status, 2); assert.equal(calls, '');
});
test('isolated runner rejects production-marked environment before connecting', (t) => {
  const { result, calls } = run(t, 'postgres://synthetic@127.0.0.1/leileios_test', { NODE_ENV: 'production' });
  assert.equal(result.status, 2); assert.equal(calls, '');
});

test('server identity rejects database, address and port mismatches', async () => {
  const { isolatedPostgresTarget, assertIsolatedPostgresServer } = await import('../scripts/isolated-postgres-target.mjs');
  const target = isolatedPostgresTarget('postgres://synthetic@127.0.0.1:5433/leileios_test', { NODE_ENV: 'test' });
  assert.doesNotThrow(() => assertIsolatedPostgresServer(target, { database: 'leileios_test', address: '127.0.0.1', port: 5433 }));
  assert.doesNotThrow(() => assertIsolatedPostgresServer(target, { database: 'leileios_test', address: '::1', port: 5433 }));
  for (const row of [
    { database: 'leileios', address: '127.0.0.1', port: 5433 },
    { database: 'leileios_test', address: '192.0.2.1', port: 5433 },
    { database: 'leileios_test', address: '127.0.0.1', port: 5432 },
    { database: 'leileios_test', address: null, port: 5433 },
  ]) assert.throws(() => assertIsolatedPostgresServer(target, row));
});
