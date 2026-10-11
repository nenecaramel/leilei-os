import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeLiveProviderSessionStoreInternalRouter } from '../src/web-api/native-live-provider-session-store-internal-router.js';
import { withServer, userId } from './helpers/native-live-http-relay-fixtures.js';

test('switch catalog is authenticated, owner-scoped, read-only and never exposes history', async () => {
  for (const authenticated of [false, true]) {
    let calls = 0;
    await withServer(app => {
      if (authenticated) app.use((req, _res, next) => { req.mcpUserId = userId; next(); });
      app.use('/store', createNativeLiveProviderSessionStoreInternalRouter({ providerSessionStoreService: {} as any,
        listNativeHistoryChoices: async (input: any) => { calls++; assert.deepEqual(input, { userId }); return { conversations: [], truncated: false }; },
      } as any));
    }, async url => {
      const send = (value: any) => fetch(url + '/store/native-history/choices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
      const response = await send({});
      assert.equal(response.status, authenticated ? 200 : 401);
      if (authenticated) {
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        assert.deepEqual(await response.json(), { success: true, data: { conversations: [], truncated: false } });
        assert.equal((await send({ userId })).status, 400);
      }
      assert.equal(calls, authenticated ? 1 : 0);
    });
  }
});

test('unavailable catalog fails closed without leaking database diagnostics', async () => {
  await withServer(app => {
    app.use((req, _res, next) => { req.mcpUserId = userId; next(); });
    app.use('/store', createNativeLiveProviderSessionStoreInternalRouter({ providerSessionStoreService: {} as any,
      listNativeHistoryChoices: async () => { throw new Error('PRIVATE_SQL'); },
    } as any));
  }, async url => {
    const response = await fetch(url + '/store/native-history/choices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /PRIVATE_SQL/);
  });
});
