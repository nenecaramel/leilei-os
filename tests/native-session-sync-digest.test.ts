import assert from "node:assert/strict";
import test from "node:test";
import { projectNativeHistory, neutralMessageFingerprint, nativeSyncDigest as clientDigest } from "../tools/claude-bridge/src/native-session-history.mjs";
import { neutralFingerprint, nativeSyncDigest } from "../src/domains/conversation/native-session-history-repository.js";

test("client and server agree on session-neutral fingerprints and the sync digest", () => {
  const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } };
  const entries = [
    { uuid: "00000000-0000-4000-8000-000000000001", parentUuid: null, type: "user", timestamp: "2026-10-11T00:00:00.000Z", message: { content: [image, { type: "text", text: "多语言 text" }] } },
    { uuid: "00000000-0000-4000-8000-000000000002", parentUuid: "00000000-0000-4000-8000-000000000001", type: "assistant", timestamp: "2026-10-11T00:00:01.000Z", message: { content: "ok" } },
  ];
  for (const sessionId of ["00000000-0000-4000-8000-00000000000a", "00000000-0000-4000-8000-00000000000b"]) {
    const projection = projectNativeHistory({ sessionId, revision: "r".repeat(64), entries }, entries[1]!.uuid);
    const server = projection.messages.map((m: any) => ({ sourceMessageId: m.sourceMessageId, fingerprint: neutralFingerprint(m) }));
    const client = projection.messages.map((m: any) => ({ sourceMessageId: m.sourceMessageId, fingerprint: neutralMessageFingerprint(m) }));
    assert.deepEqual(client, server);
    assert.equal(clientDigest(client), nativeSyncDigest(server));
  }
});
