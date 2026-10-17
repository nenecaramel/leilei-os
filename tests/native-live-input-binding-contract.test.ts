import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseNativeLiveInputBindingBody } from "../src/domains/bridge/protocol/native-live-execution-admission.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const valid = {
  listener_instance_id: id(1), request_id: id(2), conversation_id: id(3),
  runtime_mode: "resume", canonical_user_message_id: id(4),
  parent_provider_session_id: "synthetic-session", parent_provider_checkpoint_id: id(5),
  command_uuid: id(4), phase: "queued",
} as const;
const source = (path: string) => readFileSync(path, "utf8");

test("native input binding accepts queued and started only for exact canonical UUID", () => {
  assert.deepEqual(parseNativeLiveInputBindingBody(valid), {
    listenerInstanceId: id(1), requestId: id(2), conversationId: id(3),
    runtimeMode: "resume", canonicalUserMessageId: id(4),
    parentProviderSessionId: "synthetic-session", parentProviderCheckpointId: id(5),
    commandUuid: id(4), phase: "queued",
  });
  assert.equal(parseNativeLiveInputBindingBody({ ...valid, phase: "started" })?.phase, "started");
  for (const invalid of [
    { ...valid, command_uuid: id(9) },
    { ...valid, command_uuid: "guessed-prompt" },
    { ...valid, phase: "completed" },
    { ...valid, phase: null },
    { ...valid, runtime_mode: "new" },
    { ...valid, canonical_user_message_id: null },
    { ...valid, extra: true },
    Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "command_uuid")),
  ]) assert.equal(parseNativeLiveInputBindingBody(invalid), null);
});

test("internal HTTP binding is authenticated, exact and fail closed", () => {
  const handler = source("src/web-api/native-live-internal/execution.ts");
  const router = source("src/web-api/native-live-internal/router.ts");
  const client = source("src/domains/bridge/mac/native-live-mac-http-relay-client.ts");
  assert.match(handler, /requireInternalUser\(response, request\.mcpUserId\)/);
  assert.match(handler, /parseNativeLiveInputBindingBody\(request\.body\)/);
  assert.match(handler, /response\.status\(409\)/);
  assert.match(handler, /dependencies\.relayService\.bindInput\(/);
  assert.match(router, /\/reservations\/:reservationId\/input-binding/);
  assert.match(client, /input\.commandUuid !== c\.canonical_user_message_id/);
  assert.match(client, /phase: input\.phase/);
});

test("native started UUID is required before the result can finalize, and detached after exit", () => {
  const router = source("src/domains/bridge/mac/native-live-mac-persistent-turn-router.ts");
  const host = source("tools/claude-bridge/src/agent-sdk-session-host.mjs");
  const queued = router.indexOf('phase: "queued", commandUuid: slot.inputId');
  const submit = router.indexOf("const resultPromise = this.binding!.session.submit");
  assert.ok(queued >= 0 && submit > queued);
  assert.match(router, /frame\.inputId !== slot\.inputId/);
  assert.match(router, /frame\.source !== "foreground"/);
  assert.match(router, /phase: "started", commandUuid: frame\.inputId/);
  assert.match(router, /if \(!slot\.nativeStarted \|\| !slot\.startedBinding\) throw/);
  assert.match(router, /removeCommandStartedListener\?\.\(\)/);
  // A queued command may wait while a native background completion advances
  // the local checkpoint; reject non-queued modes but allow input admission
  // long enough to receive and authoritatively bind command_lifecycle.started.
  assert.match(router, /context\.phase === "input" && this\.binding[\s\S]*?!slot\.nativeStarted/);
  assert.match(router, /context\.phase !== "input"[\s\S]*?await slot\.startedBinding/);

  assert.match(host, /message\.command_uuid !== ZERO_UUID/);
  assert.match(host, /!this\.startedCommands\.has\(message\.command_uuid\)/);
});

test("pre-native-start autonomous delivery survives the outbox but cannot bypass a started foreground", () => {
  const router = source("src/domains/bridge/mac/native-live-mac-persistent-turn-router.ts");
  const sink = source("src/domains/bridge/mac/native-live-mac-background-result-sink.ts");
  const server = source("src/domains/bridge/relay/native-live-background-result-repository.ts");
  assert.match(router, /executionStart: this\.active\?\.command\.operation === "send" && this\.active\?\.nativeStarted !== true/);
  assert.match(sink, /\.\.\.\(owner\.executionStart === true \? \{ executionStart: true \} : \{\}\)/);
  assert.match(server, /const current = await snapshot\(tx, userId, identity, origin, stored\.executionStart\)/);
  assert.match(server, /coalesce\(busy\.runtime_metadata->'native_live_input_binding'->>'started','false'\)<>'false'/);
});

test("temporary overlay is not in the iOS or current-path response", () => {
  const api = source("src/web-api/native-live/conversations.ts");
  const ui = source("ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveConversationPresentationAssembler.swift");
  assert.doesNotMatch(api, /backgroundResults: snapshot\.backgroundResults/);
  assert.doesNotMatch(ui, /row\.backgroundResult/);
});
