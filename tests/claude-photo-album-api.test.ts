import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  createAlbumApiRouter,
  type AlbumApiDependencies,
} from "../src/web-api/album-router.js";

const userId = "11111111-1111-4111-8111-111111111111";
const userMessageId =
  "22222222-2222-4222-8222-222222222222";

class FakeAlbumService {
  calls: unknown[] = [];

  async readMessageSaves(input: unknown) {
    this.calls.push(input);
    return {
      userMessageId,
      total: 1,
    };
  }
}

async function withServer(
  service: FakeAlbumService,
  work: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use((request, _response, next) => {
    request.webUserId = userId;
    next();
  });
  app.use(
    "/album",
    createAlbumApiRouter({
      albumService:
        service as unknown as AlbumApiDependencies["albumService"],
    }),
  );
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  try {
    const address = server.address() as AddressInfo;
    await work(
      `http://127.0.0.1:${address.port}/album`,
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error ? reject(error) : resolve()
      );
    });
  }
}

test("Album API reads saves by canonical user message identity", async () => {
  const service = new FakeAlbumService();
  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/saves/messages/${userMessageId}`,
    );
    assert.equal(response.status, 200);
    const body = await response.json() as {
      success: boolean;
      data: {
        userMessageId: string;
        total: number;
      };
    };
    assert.equal(body.success, true);
    assert.deepEqual(body.data, {
      userMessageId,
      total: 1,
    });
    assert.deepEqual(service.calls, [{
      userId,
      userMessageId,
    }]);
  });
});
