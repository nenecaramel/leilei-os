import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readSwitchCatalog } from '../../../scripts/native-session-pick.mjs';
const id = '00000000-0000-4000-8000-000000000001';
const catalog = () => ({ success: true, data: { conversations: [{ conversationId: id, headMessageId: id, providerSessionId: id, providerCheckpointId: id, sourceSessionId: id, busy: false }], truncated: false } });

test('catalog fetch sends empty owner-scoped request and rejects invalid, oversized or truncated catalogs', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).pathname, '/internal/native-live-session-store/native-history/choices');
    assert.equal(options.body, '{}'); assert.equal(options.redirect, 'error');
    return Response.json(catalog());
  };
  const config = { relayUrl: 'https://fixture.example', relayToken: 'PRIVATE', fetchImpl };
  assert.equal((await readSwitchCatalog(config))[0].conversationId, id);
  for (const bad of [{...catalog(), success: false}, { success: true, data: { conversations: [], truncated: true } },
    { success: true, data: { conversations: [{ ...catalog().data.conversations[0], conversationId: '../bad' }], truncated: false } }]) {
    await assert.rejects(readSwitchCatalog({ ...config, fetchImpl: async () => Response.json(bad) }));
  }
  await assert.rejects(readSwitchCatalog({ ...config, fetchImpl: async () => new Response('x'.repeat(1024 * 1024 + 1)) }), /CATALOG_UNAVAILABLE/);
  await assert.rejects(readSwitchCatalog({ ...config, fetchImpl: async () => { throw new Error('PRIVATE_TOKEN'); } }), e => !e.message.includes('PRIVATE'));
});

test('fixed wrapper prefers canonical checkout and never supplies a hidden session default', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'switch-wrapper-'));
  try {
    const scripts = path.join(home, 'Developer/leilei-os-main/scripts'); await mkdir(scripts, { recursive: true });
    for (const [file, label] of [['native-session-pick.mjs', 'pick'], ['native-session-local.mjs', 'local']]) {
      await writeFile(path.join(scripts, file), `console.log(JSON.stringify({entry:'${label}',args:process.argv.slice(2)}));`);
    }
    const wrapper = new URL('../../../scripts/leileios-switch.command', import.meta.url).pathname;
    const run = args => JSON.parse(execFileSync('bash', [wrapper, ...args], { env: { ...process.env, HOME: home }, encoding: 'utf8' }));
    assert.deepEqual(run(['desktop']), { entry: 'pick', args: ['desktop'] });
    assert.deepEqual(run(['leileios']), { entry: 'pick', args: ['leileios'] });
    assert.deepEqual(run(['desktop', id]), { entry: 'local', args: ['desktop', id] });
    assert.deepEqual(run(['list']), { entry: 'local', args: ['list'] });
    await rm(path.join(scripts, 'native-session-pick.mjs'));
    assert.throws(() => run(['desktop']));
  } finally { await rm(home, { recursive: true }); }
});
