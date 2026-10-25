import assert from "node:assert/strict";
import test from "node:test";
import {
  probeNativeLiveAttachmentBucket,
  S3PresignedAttachmentObjectStore,
} from "../src/domains/bridge/attachment/native-live-attachment-storage.js";

const config = {
  bucket: "leilei-files-test",
  endpoint: "https://t3.storageapi.dev",
  accessKeyId: "ACCESS123",
  secretAccessKey: "SECRET456",
  region: "auto",
  presignTtlSeconds: 600,
  maxFileBytes: 20 * 1024 * 1024,
  maxPerTurn: 8,
  unboundTtlSeconds: 24 * 60 * 60,
};

function recorder() {
  const lines: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const log = (level: string) => (event: string, fields?: Record<string, unknown>) => { lines.push([level, event, fields]); };
  return { lines, logger: { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") } };
}

test("bucket probe accepts a signed HEAD answered 404 and reports rejected or unreachable credentials loudly", async () => {
  const cases: Array<[typeof fetch, string, string, number | undefined]> = [
    [async () => new Response(null, { status: 404 }), "info", "ok", undefined],
    [async () => new Response(null, { status: 403 }), "error", "rejected", 403],
    [async () => { throw new TypeError("fetch failed"); }, "error", "unreachable", undefined],
  ];
  for (const [fetchImpl, level, state, status] of cases) {
    const requests: Array<{ url: string; method?: string }> = [];
    const store = new S3PresignedAttachmentObjectStore(config, async (url, init) => {
      requests.push({ url: String(url), method: init?.method });
      return fetchImpl(url, init);
    });
    const { lines, logger } = recorder();
    assert.equal(await probeNativeLiveAttachmentBucket(store, logger), state);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.method, "HEAD");
    assert.match(requests[0]!.url, /^https:\/\/leilei-files-test\.t3\.storageapi\.dev\/diagnostics\/credential-probe\?/);
    assert.deepEqual(lines, [[level, "native_live_attachment_bucket_probe", status === undefined ? { state } : { state, status }]]);
    assert.doesNotMatch(JSON.stringify(lines), /SECRET456|ACCESS123/);
  }
});
