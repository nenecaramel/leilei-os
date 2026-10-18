import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { PostgresInlineAttachmentObjectStore } from "../src/domains/bridge/attachment/native-live-attachment-postgres-storage.js";
import { createNativeLiveAttachmentTransferRouter } from "../src/web-api/native-live-attachment-transfer-router.js";

async function fixture(run: (f: {
  url: string; token: string; getToken: string; writes: Buffer[]; advance(): void;
  authorized: Promise<void>;
}) => Promise<void>) {
  let now = Date.parse("2026-10-18T00:00:00Z");
  const store = new PostgresInlineAttachmentObjectStore({} as never, {
    signingSecret: "isolated-test-signing-secret", transferTtlSeconds: 60,
    maxFileBytes: 1024, maxTotalBytes: 4096, now: () => new Date(now),
  });
  const token = store.createUploadSlot({ objectKey: "native-live/test/file", mimeType: "application/octet-stream", sha256: "a".repeat(64) }).url.split("/").at(-1)!;
  const getToken = store.createDownloadSlot({ objectKey: "native-live/test/file" }).url.split("/").at(-1)!;
  const writes: Buffer[] = [];
  let observe!: () => void;
  const authorized = new Promise<void>(resolve => { observe = resolve; });
  const app = express();
  app.use(createNativeLiveAttachmentTransferRouter({
    transferMaxFileBytes: store.transferMaxFileBytes,
    authorizeTransfer(value, method) { const claims = store.authorizeTransfer(value, method); observe(); return claims; },
    async putTransfer(input) { store.authorizeTransfer(input.token, "PUT"); writes.push(input.bytes); },
    async getTransfer() { throw new Error("Unused GET"); },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try { await run({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token, getToken, writes, authorized, advance: () => { now += 61_000; } }); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("invalid transfer capability rejects before an unfinished body is read", async () => fixture(async f => {
  await new Promise<void>((resolve, reject) => {
    const req = request(`${f.url}/invalid`, { method: "PUT", headers: { "content-type": "application/octet-stream", "content-length": 1000 } }, response => {
      try { assert.equal(response.statusCode, 401); assert.equal(f.writes.length, 0); resolve(); } catch (error) { reject(error); }
      response.resume(); req.destroy();
    });
    req.on("error", reject);
    req.setTimeout(1000, () => { req.destroy(); reject(new Error("Authorization waited for an unfinished body.")); });
    req.flushHeaders();
  });
}));

test("bad signature rejects before oversized or malformed compressed body parsing", async () => fixture(async f => {
  for (const [body, encoding] of [[Buffer.alloc(2048), "identity"], [Buffer.from("not gzip"), "gzip"]] as const) {
    const response = await fetch(`${f.url}/invalid`, { method: "PUT", headers: { "content-type": "application/octet-stream", "content-encoding": encoding }, body });
    assert.equal(response.status, 401); await response.arrayBuffer();
  }
  assert.equal(f.writes.length, 0);
}));

test("expired capability rejects before the parser even for invalid gzip", async () => fixture(async f => {
  f.advance();
  const response = await fetch(`${f.url}/${f.token}`, { method: "PUT", headers: { "content-type": "application/octet-stream", "content-encoding": "gzip" }, body: "not gzip" });
  assert.equal(response.status, 410); await response.arrayBuffer(); assert.equal(f.writes.length, 0);
}));

test("a GET capability cannot authorize a PUT or reach decompression", async () => fixture(async f => {
  const response = await fetch(`${f.url}/${f.getToken}`, { method: "PUT", headers: { "content-type": "application/octet-stream", "content-encoding": "gzip" }, body: "not gzip" });
  assert.equal(response.status, 401); await response.arrayBuffer(); assert.equal(f.writes.length, 0);
}));

test("valid plain and gzip capability uploads retain binary behavior", async () => fixture(async f => {
  const bytes = Buffer.from([0, 1, 2, 255]);
  for (const encoding of ["identity", "gzip"]) {
    const response = await fetch(`${f.url}/${f.token}`, { method: "PUT", headers: { "content-type": "application/octet-stream", "content-encoding": encoding }, body: encoding === "gzip" ? gzipSync(bytes) : bytes });
    assert.equal(response.status, 204);
  }
  assert.deepEqual(f.writes, [bytes, bytes]);
}));

test("capability expiring during upload is rechecked before storage", async () => fixture(async f => {
  const response = new Promise<number | undefined>((resolve, reject) => {
    const req = request(`${f.url}/${f.token}`, { method: "PUT", headers: { "content-type": "application/octet-stream", "content-length": 4 } }, res => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject);
    req.flushHeaders();
    void f.authorized.then(() => { f.advance(); req.end("data"); });
    req.setTimeout(1000, () => { req.destroy(); reject(new Error("Upload did not finish.")); });
  });
  assert.equal(await response, 410); assert.equal(f.writes.length, 0);
}));
