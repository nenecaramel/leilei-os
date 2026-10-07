import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  NativeLiveMacClaudeHandoffOutbox,
} from "../src/domains/bridge/mac/native-live-mac-claude-handoff-outbox.js";

const entry = {
  listenerInstanceId:
    "11111111-1111-4111-8111-111111111111",
  reservationId:
    "22222222-2222-4222-8222-222222222222",
  handoffSessionId:
    "33333333-3333-4333-8333-333333333333",
};

test("Claude handoff outbox is durable, idempotent, and acknowledged explicitly", async (t) => {
  const root = mkdtempSync(
    join(tmpdir(), "leileios-handoff-outbox-"),
  );
  t.after(() => {
    rmSync(root, {
      recursive: true,
      force: true,
    });
  });

  const first =
    new NativeLiveMacClaudeHandoffOutbox(root);
  await first.save(entry);
  await first.save(entry);

  const restarted =
    new NativeLiveMacClaudeHandoffOutbox(root);
  assert.deepEqual(
    await restarted.list(),
    [entry],
  );

  await restarted.acknowledge(entry);
  assert.deepEqual(
    await restarted.list(),
    [],
  );
});

test("Claude handoff outbox rejects conflicting B session ids for one reservation", async (t) => {
  const root = mkdtempSync(
    join(tmpdir(), "leileios-handoff-outbox-"),
  );
  t.after(() => {
    rmSync(root, {
      recursive: true,
      force: true,
    });
  });

  const outbox =
    new NativeLiveMacClaudeHandoffOutbox(root);
  await outbox.save(entry);

  await assert.rejects(
    outbox.save({
      ...entry,
      handoffSessionId:
        "44444444-4444-4444-8444-444444444444",
    }),
    /Conflicting Claude handoff receipt/,
  );
});
