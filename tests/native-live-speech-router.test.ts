import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { createNativeLiveSpeechRouter } from "../src/web-api/native-live-speech-router.js";

async function withServer(
  options: {
    authorized?: boolean;
    apiKey?: string;
    voiceId?: string;
    fetcher?: typeof fetch;
  },
  run: (origin: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  if (options.authorized !== false) {
    app.use((request, _response, next) => {
      request.webUserId = "00000000-0000-4000-8000-000000000001";
      next();
    });
  }
  app.use("/api/v1/voice", createNativeLiveSpeechRouter(options));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const address = server.address() as AddressInfo;
    await run("http://127.0.0.1:" + address.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("voice route denies unbound requests before provider calls", async () => {
  let called = false;
  await withServer({
    authorized: false,
    apiKey: "server-secret",
    voiceId: "abcdefghijklmno1",
    fetcher: (async () => {
      called = true;
      throw new Error("should not call upstream");
    }) as typeof fetch,
  }, async (origin) => {
    const response = await fetch(origin + "/api/v1/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    });
    assert.equal(response.status, 401);
    assert.equal(called, false);
  });
});

test("voice route stays disabled until an ElevenLabs key and voice are configured", async () => {
  await withServer({}, async (origin) => {
    const status = await fetch(origin + "/api/v1/voice/status");
    assert.deepEqual((await status.json() as { data: unknown }).data, { configured: false });
    const response = await fetch(origin + "/api/v1/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hi" }),
    });
    assert.equal(response.status, 503);
  });
});

test("voice route sends the owner-selected ElevenLabs voice, never the secret, and limits input", async () => {
  let requests = 0;
  await withServer({
    apiKey: "server-secret",
    voiceId: "BtWabtumIemAotTjP5sk",
    fetcher: (async (_url: URL | RequestInfo, init?: RequestInit) => {
      assert.equal(String(_url), "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128");
      requests += 1;
      assert.equal((init?.headers as Record<string, string>)["xi-api-key"], "server-secret");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        inputs: [{ text: "你好，蕾蕾。", voice_id: "BtWabtumIemAotTjP5sk" }],
        model_id: "eleven_v4",
      });
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    }) as typeof fetch,
  }, async (origin) => {
    const status = await fetch(origin + "/api/v1/voice/status");
    assert.deepEqual((await status.json() as { data: unknown }).data, { configured: true });
    const response = await fetch(origin + "/api/v1/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "你好，蕾蕾。" }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/mpeg");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0x49, 0x44, 0x33, 0x04]));
    assert.equal(requests, 1);

    const rejected = await fetch(origin + "/api/v1/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(1201) }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(requests, 1);
  });
});

test("upstream errors are sanitized instead of leaking provider responses", async () => {
  await withServer({
    apiKey: "server-secret",
    voiceId: "abcdefghijklmno1",
    fetcher: (async () => new Response("raw-secret-diagnostic", {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch,
  }, async (origin) => {
    const response = await fetch(origin + "/api/v1/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    });
    assert.equal(response.status, 502);
    const output = await response.text();
    assert.equal(output.includes("raw-secret-diagnostic"), false);
    assert.equal(output.includes("server-secret"), false);
  });
});

test("voice route supports V3 and V4 per request and rejects unknown models", async () => {
  const seenModels: string[] = [];
  await withServer({
    apiKey: "server-secret",
    voiceId: "BtWabtumIemAotTjP5sk",
    fetcher: (async (_url: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model_id: string; inputs: { text: string; voice_id: string }[] };
      seenModels.push(body.model_id);
      assert.deepEqual(body.inputs, [{ text: "你好", voice_id: "BtWabtumIemAotTjP5sk" }]);
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    }) as typeof fetch,
  }, async (origin) => {
    for (const modelId of ["eleven_v3", "eleven_v4"]) {
      const response = await fetch(origin + "/api/v1/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "你好", model_id: modelId }),
      });
      assert.equal(response.status, 200);
    }
    for (const modelId of ["eleven_multilingual_v2", "eleven_v4_turbo", "unknown", null, 12]) {
      const response = await fetch(origin + "/api/v1/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "你好", model_id: modelId }),
      });
      assert.equal(response.status, 400);
    }
    assert.deepEqual(seenModels, ["eleven_v3", "eleven_v4"]);
  });
});
