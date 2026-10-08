import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
test("retired private album has no domain, schema, API, runtime or iOS wiring", () => {
  for (const path of ["src/domains/album", "src/database/schema/claude-album.ts", "src/web-api/album-router.ts", "src/web-api/native-live-internal/album.ts"]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, path);
  }
  for (const path of ["src/app/process-runtime.ts", "src/app/create-app.ts", "src/database/schema.ts", "src/web-api/router.ts", "src/web-api/native-live-internal/router.ts", "src/web-api/native-live-internal/dependencies.ts", "src/domains/bridge/mac/native-live-mac-runtime-executor.ts", "src/domains/bridge/mac/native-live-mac-http-relay-client.ts", "tools/claude-bridge/src/agent-sdk-claude-transport.mjs", "tools/claude-bridge/src/agent-sdk-permission.mjs", "ios/LeileiOS/LeileiOS/App/MessageProjectionCoordination.swift", "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveAssistantTurnRow.swift"]) {
    assert.doesNotMatch(read(path), /ClaudeAlbum|PhotoAlbum|albumHandlers|albumToolClient|leileios_album|save_photo|search_photos|view_photo|send_photo|refreshAlbumSaves|AlbumSaveIndicator/, path);
  }
});
test("shared current-turn attachments and file/meme output remain wired", () => {
  assert.match(read("src/app/process-runtime.ts"), /new NativeLiveAttachmentService/);
  assert.match(read("src/web-api/native-live-internal/router.ts"), /createInternalAttachmentDownloadSlotHandler/);
  assert.match(read("src/domains/bridge/mac/native-live-mac-runtime-executor.ts"), /sendFileHandler/);
  assert.match(read("tools/claude-bridge/src/agent-sdk-claude-transport.mjs"), /createDefaultSendFileMcpServer/);
  assert.match(read("tools/claude-bridge/src/agent-sdk-claude-transport.mjs"), /createMemeMcpServer/);
});

test("retired dependency objects cannot register any internal album endpoint", async () => {
  const { createNativeLiveRelayInternalRouter } = await import("../src/web-api/native-live-internal/router.js");
  const dependencies = {
    relayService: {}, photoAlbumService: {}, photoAlbumSender: {},
  } as unknown as Parameters<typeof createNativeLiveRelayInternalRouter>[0];
  const router = createNativeLiveRelayInternalRouter(dependencies);
  const paths = router.stack.filter(layer => layer.route).map(layer => layer.route.path);
  assert.ok(paths.length > 0);
  assert.equal(paths.some(path => String(path).includes("/album")), false);
});

test("retirement migration drops only the dedicated table without cascading", () => {
  const statements = read("drizzle/0105_retire_claude_photo_album.sql")
    .replace(/--[^\n]*/g, "").trim();
  assert.equal(statements, 'DROP TABLE IF EXISTS "public"."claude_album_photos";');
  assert.ok(existsSync(new URL("../drizzle/0096_claude_photo_album.sql", import.meta.url)));
});
