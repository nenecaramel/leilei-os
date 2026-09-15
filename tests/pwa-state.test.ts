import assert from "node:assert/strict";
import test from "node:test";
import { createPwaStateStore } from "../web/src/pwa/pwa-state.js";

test("PWA store exposes update availability and user-triggered update action", async () => {
  let updated = 0;
  const store = createPwaStateStore();
  const seen: boolean[] = [];
  const unsubscribe = store.subscribe(() => {
    seen.push(store.getSnapshot().updateAvailable);
  });

  store.setUpdateAction(async () => {
    updated += 1;
  });
  store.markUpdateAvailable();

  assert.equal(store.getSnapshot().updateAvailable, true);
  await store.acceptUpdate();
  assert.equal(updated, 1);
  assert.equal(store.getSnapshot().updateAvailable, false);
  unsubscribe();
  assert.ok(seen.includes(true));
  assert.ok(seen.includes(false));
});

test("PWA store tracks browser online/offline state", () => {
  const store = createPwaStateStore({ online: false });
  assert.equal(store.getSnapshot().online, false);
  store.setOnline(true);
  assert.equal(store.getSnapshot().online, true);
});


test("PWA store restores update availability when update activation fails", async () => {
  const store = createPwaStateStore();
  store.setUpdateAction(async () => {
    throw new Error("activation failed");
  });
  store.markUpdateAvailable();

  await assert.rejects(() => store.acceptUpdate(), /activation failed/);
  assert.equal(store.getSnapshot().updateAvailable, true);
});
