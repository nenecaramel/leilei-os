import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

// This test reads server identity only. Mutation commands are substituted so
// it proves the guard allows a verified connection before handing off, safely.
test('verified local PostgreSQL allows migration/check/test handoff in order', {
  skip: process.env.RUN_DATABASE_TARGET_TEST !== '1',
}, async (t) => {
  const { isolatedPostgresTarget, verifyIsolatedPostgresTarget } = await import('../scripts/isolated-postgres-target.mjs');
  const url = process.env.DATABASE_URL;
  assert.ok(url, 'explicit test DATABASE_URL required');
  const target = isolatedPostgresTarget(url);
  await verifyIsolatedPostgresTarget(target);
  const root = mkdtempSync(join(tmpdir(), 'leileios-pg-handoff-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const marker = join(root, 'commands.jsonl');
  writeFileSync(join(root, 'pnpm'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(marker)},JSON.stringify(process.argv.slice(2))+'\\n');\n`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [resolve('scripts/run-isolated-postgres-regressions.mjs')], {
    env: { ...process.env, PATH: root + ':' + process.env.PATH, RUN_ISOLATED_POSTGRES_REGRESSIONS: '1' },
    encoding: 'utf8', timeout: 12_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(marker, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], ['db:migrate']); assert.deepEqual(calls[1], ['db:check']);
  assert.deepEqual(calls[2].slice(0, 4), ['exec', 'tsx', '--test', '--test-concurrency=1']);
  assert.ok(calls[2].includes('tests/mind-product-repository.integration.test.ts'));
  assert.ok(!result.stdout.includes(url));
});
