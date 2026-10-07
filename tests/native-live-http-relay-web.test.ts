import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import type { NativeLiveCurrentPathSnapshot } from "../src/domains/conversation/native-live-current-path-read-repository.js";
import type {
  NativeLiveRelayPrepareResult,
} from "../src/domains/bridge/relay/native-live-backend-relay-prepare.js";
import {
  createNativeLiveApiRouter,
} from "../src/web-api/native-live-router.js";
import {
  userId,
  prepareId,
  requestId,
  conversationId,
  userMessageId,
  FakeCoordinator,
  FakeTurnReader,
  FakeCurrentPathReader,
  FakeRelayService,
  FakeRuntimeInteractionService,
  FakeRuntimeEventService,
  withServer,
} from "./helpers/native-live-http-relay-fixtures.js";

test("web prepare endpoint is user scoped and never returns the runtime prompt", async () => {
  const coordinator = new FakeCoordinator();
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();
  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        if (request.header("x-test-user") === "owner") {
          request.webUserId = userId;
        }
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({ coordinator, relayService, turnReader }),
      );
    },
    async (baseUrl) => {
      const unauthenticated = await fetch(
        `${baseUrl}/api/v1/native-live/prepare`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      assert.equal(unauthenticated.status, 401);

      const response = await fetch(
        `${baseUrl}/api/v1/native-live/prepare`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-user": "owner",
          },
          body: JSON.stringify({
            dispatch_target: "claude_code",
            request_id: requestId,
            operation: "send",
            conversation_id: conversationId,
            expected_head_message_id: null,
            text: "hello",
          }),
        },
      );
      assert.equal(response.status, 201);
      const payload = await response.json() as {
        data: Record<string, unknown>;
      };
      assert.deepEqual(payload.data, {
        outcome: "created",
        semanticPending: false,
        prepareId,
        requestId,
        conversationId,
        userMessageId,
        expectedWorkingDirectory: null,
      });
      assert.equal(JSON.stringify(payload).includes("private prompt"), false);
      assert.deepEqual(relayService.calls, [{
        name: "enqueuePreparation",
        input: { userId, prepareId },
      }]);

      const read = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}`,
        { headers: { "x-test-user": "owner" } },
      );
      assert.equal(read.status, 200);
      const readPayload = await read.json() as {
        data: {
          canonicalStatus: string;
          dispatchStatus: string;
          executionSelection: {
            model: string;
            thinking?: string;
            effort?: string;
          } | null;
          runtimeMetadata: {
            execution?: {
              readback: {
                applied: {
                  model: string | null;
                  effort: string | null;
                };
              };
            } | null;
          } | null;
          assistantMessage: { blocks: Array<{ text: string | null }> } | null;
        };
      };
      assert.equal(readPayload.data.canonicalStatus, "finalized_success");
      assert.equal(readPayload.data.dispatchStatus, "completed");
      assert.deepEqual(readPayload.data.executionSelection, {
        model: "claude-opus-5-5",
        thinking: "adaptive",
        effort: "high",
      });
      assert.equal(
        readPayload.data.runtimeMetadata?.execution?.readback.applied.model,
        "claude-opus-5-5",
      );
      assert.equal(readPayload.data.assistantMessage?.blocks[0]?.text, "VISIBLE");
      // Prepare projects the authoritative start time; the subsequent turn read is separately scoped.
      assert.deepEqual(turnReader.calls, [{ userId, prepareId }, { userId, prepareId }]);
    },
  );
});

test("web turn completion wait is user scoped and returns terminal state without polling", async () => {
  const coordinator = new FakeCoordinator();
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();
  const waitCalls: unknown[] = [];
  const turnWaitService = {
    async wait(input: {
      userId: string;
      prepareId: string;
      timeoutMs: number;
      signal?: AbortSignal | null;
    }) {
      waitCalls.push({
        userId: input.userId,
        prepareId: input.prepareId,
        timeoutMs: input.timeoutMs,
        hasSignal: input.signal instanceof AbortSignal,
      });
      const turn = await turnReader.readTurn({
        userId: input.userId,
        prepareId: input.prepareId,
      });
      return {
        outcome: "terminal" as const,
        turn: turn!,
      };
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        if (request.header("x-test-user") === "owner") {
          request.webUserId = userId;
        }
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({
          coordinator,
          relayService,
          turnReader,
          turnWaitService,
        }),
      );
    },
    async (baseUrl) => {
      const unauthenticated = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}/wait`,
        { method: "POST" },
      );
      assert.equal(unauthenticated.status, 401);

      const response = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}/wait`,
        {
          method: "POST",
          headers: { "x-test-user": "owner" },
        },
      );
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        data: {
          outcome: string;
          turn: {
            prepareId: string;
            canonicalStatus: string;
            dispatchStatus: string;
            assistantMessage: {
              blocks: Array<{ text: string | null }>;
            } | null;
          };
        };
      };
      assert.equal(payload.data.outcome, "terminal");
      assert.equal(payload.data.turn.prepareId, prepareId);
      assert.equal(
        payload.data.turn.canonicalStatus,
        "finalized_success",
      );
      assert.equal(payload.data.turn.dispatchStatus, "completed");
      assert.equal(
        payload.data.turn.assistantMessage?.blocks[0]?.text,
        "VISIBLE",
      );
      assert.deepEqual(waitCalls, [{
        userId,
        prepareId,
        timeoutMs: 25_000,
        hasSignal: true,
      }]);
    },
  );
});

test("web current-path endpoint is authenticated, bounded, and supports head ETag refresh", async () => {
  const coordinator = new FakeCoordinator();
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();
  const currentPathReader = new FakeCurrentPathReader();

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        if (request.header("x-test-user") === "owner") {
          request.webUserId = userId;
        }
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({
          coordinator,
          relayService,
          turnReader,
          currentPathReader,
        }),
      );
    },
    async (baseUrl) => {
      const unauthenticated = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/current-path`,
      );
      assert.equal(unauthenticated.status, 401);

      const invalidId = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/not-a-uuid/current-path`,
        { headers: { "x-test-user": "owner" } },
      );
      assert.equal(invalidId.status, 400);

      const invalidLimit = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/current-path?limit=201`,
        { headers: { "x-test-user": "owner" } },
      );
      assert.equal(invalidLimit.status, 400);

      const response = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/current-path?limit=2`,
        { headers: { "x-test-user": "owner" } },
      );
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("etag"),
        '"head:77777777-7777-4777-8777-777777777777:limit:2:before:-:after:-"',
      );
      const payload = await response.json() as {
        data: {
          conversationId: string;
          currentHeadMessageId: string | null;
          syncToken: string;
          truncated: boolean;
          messages: Array<{
            blocks: Array<{ text: string | null }>;
          }>;
        };
      };
      assert.equal(payload.data.conversationId, conversationId);
      assert.equal(
        payload.data.currentHeadMessageId,
        "77777777-7777-4777-8777-777777777777",
      );
      assert.equal(
        payload.data.syncToken,
        "head:77777777-7777-4777-8777-777777777777",
      );
      assert.equal(payload.data.truncated, false);
      assert.equal(
        payload.data.messages[0]?.blocks[0]?.text,
        "VISIBLE PROACTIVE",
      );
      assert.deepEqual(currentPathReader.calls, [{
        userId,
        conversationId,
        limit: 2,
      }]);

      const unchanged = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/current-path?limit=2`,
        {
          headers: {
            "x-test-user": "owner",
            "if-none-match":
              '"head:77777777-7777-4777-8777-777777777777:limit:2:before:-:after:-"',
          },
        },
      );
      assert.equal(unchanged.status, 304);
      assert.equal(
        currentPathReader.calls.length,
        2,
      );

      const widerWindow = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/current-path?limit=3`,
        {
          headers: {
            "x-test-user": "owner",
            "if-none-match":
              '"head:77777777-7777-4777-8777-777777777777:limit:2:before:-:after:-"',
          },
        },
      );
      assert.equal(widerWindow.status, 200);
      assert.equal(
        widerWindow.headers.get("etag"),
        '"head:77777777-7777-4777-8777-777777777777:limit:3:before:-:after:-"',
      );
      assert.deepEqual(
        currentPathReader.calls[2],
        { userId, conversationId, limit: 3 },
      );
    },
  );
});

test("web current-path endpoint returns 404 for a missing user-owned native conversation", async () => {
  const currentPathReader = new FakeCurrentPathReader();
  currentPathReader.result = null;

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.webUserId = userId;
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({
          coordinator: new FakeCoordinator(),
          relayService: new FakeRelayService(),
          turnReader: new FakeTurnReader(),
          currentPathReader,
        }),
      );
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/current-path`,
      );
      assert.equal(response.status, 404);
    },
  );
});

test("web prepare leaves semantic-pending turns staged instead of exposing them to Claude", async () => {
  const coordinator = new FakeCoordinator();
  coordinator.result = {
    ...(coordinator.result as Extract<NativeLiveRelayPrepareResult, { ok: true }>),
    semanticPending: true,
  };
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.webUserId = userId;
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({ coordinator, relayService, turnReader }),
      );
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/native-live/prepare`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dispatch_target: "claude_code",
            request_id: requestId,
            operation: "send",
            conversation_id: conversationId,
            expected_head_message_id: null,
            text: "hello",
          }),
        },
      );

      assert.equal(response.status, 202);
      const payload = await response.json() as {
        data: { semanticPending: boolean };
      };
      assert.equal(payload.data.semanticPending, true);
      assert.deepEqual(relayService.calls, []);
    },
  );
});

test("web runtime event reads are owner scoped and cursor bounded", async () => {
  const coordinator = new FakeCoordinator();
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();
  const runtimeEvents = new FakeRuntimeEventService();

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        if (request.header("x-test-user") === "owner") {
          request.webUserId = userId;
        }
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({
          coordinator,
          relayService,
          turnReader,
          runtimeEventService: runtimeEvents,
        }),
      );
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}/events?after_sequence=1&limit=25`,
        {
          headers: { "x-test-user": "owner" },
        },
      );
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("cache-control"),
        "private, no-store",
      );
      const payload = await response.json() as {
        data: {
          nextAfterSequence: number;
          events: unknown[];
        };
      };
      assert.equal(payload.data.nextAfterSequence, 2);
      assert.equal(payload.data.events.length, 1);
      assert.deepEqual(runtimeEvents.listCalls, [{
        userId,
        prepareId,
        afterSequence: 1,
        limit: 25,
      }]);
    },
  );
});

test("web owner can list and resolve a pending runtime interaction", async () => {
  const coordinator = new FakeCoordinator();
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();
  const interactions = new FakeRuntimeInteractionService();
  const interactionId =
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        if (request.header("x-test-user") === "owner") {
          request.webUserId = userId;
        }
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({
          coordinator,
          relayService,
          turnReader,
          runtimeInteractionService: interactions,
        }),
      );
    },
    async (baseUrl) => {
      const listed = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}/interactions?limit=10`,
        { headers: { "x-test-user": "owner" } },
      );
      assert.equal(listed.status, 200);

      const resolved = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}/interactions/${interactionId}/respond`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-user": "owner",
          },
          body: JSON.stringify({
            response: {
              decision: "allow",
              updatedInput: {
                file_path: "/allowed/a",
              },
            },
          }),
        },
      );
      assert.equal(resolved.status, 200);
      assert.deepEqual(interactions.listCalls, [{
        userId,
        prepareId,
        limit: 10,
      }]);
      assert.deepEqual(interactions.resolveCalls, [{
        userId,
        prepareId,
        interactionId,
        response: {
          decision: "allow",
          updatedInput: {
            file_path: "/allowed/a",
          },
        },
      }]);
    },
  );
});

test("web owner can create and list foreground mid-turn and interrupt controls", async () => {
  const coordinator = new FakeCoordinator();
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();
  const controlId =
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const calls = [];
  const control = {
    controlId,
    prepareId,
    kind: "interrupt" as const,
    payload: {},
    status: "pending" as const,
    reservedBy: null,
    receipt: null,
    failureCode: null,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    appliedAt: null,
  };
  const runtimeControlService = {
    async createForUser(input: unknown) {
      calls.push({ name: "create", input });
      return {
        outcome: "created" as const,
        control,
      };
    },
    async listForUser(input: unknown) {
      calls.push({ name: "list", input });
      return [control];
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        if (request.header("x-test-user") === "owner") {
          request.webUserId = userId;
        }
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({
          coordinator,
          relayService,
          turnReader,
          runtimeControlService,
        }),
      );
    },
    async (baseUrl) => {
      const created = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}/controls`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-user": "owner",
          },
          body: JSON.stringify({
            control_id: controlId,
            kind: "interrupt",
            payload: {},
          }),
        },
      );
      assert.equal(created.status, 201);

      const listed = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}/controls?limit=10`,
        {
          headers: { "x-test-user": "owner" },
        },
      );
      assert.equal(listed.status, 200);
      assert.equal(
        listed.headers.get("cache-control"),
        "private, no-store",
      );
      assert.deepEqual(calls, [
        {
          name: "create",
          input: {
            userId,
            prepareId,
            controlId,
            kind: "interrupt",
            payload: {},
          },
        },
        {
          name: "list",
          input: {
            userId,
            prepareId,
            limit: 10,
          },
        },
      ]);
    },
  );
});

test("current-path ETag changes for durable failure and clearing without advancing canonical head", async () => {
  const [fixture] = JSON.parse(fs.readFileSync("tests/fixtures/native-live-lifecycle-boundaries.json","utf8")) as Array<{before:NativeLiveCurrentPathSnapshot;failed:NativeLiveCurrentPathSnapshot}>;
  let snapshot = fixture.before;
  await withServer(app => {
    app.use((request,_response,next) => { request.webUserId = userId; next(); });
    app.use("/api/v1/native-live",createNativeLiveApiRouter({currentPathReader:{readCurrentPath:async()=>snapshot}}));
  },async baseUrl => {
    const url = `${baseUrl}/api/v1/native-live/conversations/${snapshot.conversationId}/current-path`;
    const before = await fetch(url);
    assert.equal(before.status,200);
    const initialETag = before.headers.get("etag")!;
    snapshot = fixture.failed;
    assert.equal(snapshot.currentHeadMessageId,fixture.before.currentHeadMessageId);
    assert.equal(snapshot.syncToken,fixture.before.syncToken);
    const failed = await fetch(url,{headers:{"if-none-match":initialETag}});
    assert.equal(failed.status,200,"failure evidence must invalidate same-head conditional refresh");
    const failureETag = failed.headers.get("etag")!;
    assert.notEqual(failureETag,initialETag);
    assert.equal((await failed.json()).data.failedTurn.prepareId,snapshot.failedTurn?.prepareId);
    assert.equal((await fetch(url,{headers:{"if-none-match":failureETag}})).status,304);
    snapshot = {...fixture.before,failedTurn:null};
    const cleared = await fetch(url,{headers:{"if-none-match":failureETag}});
    assert.equal(cleared.status,200,"new preparation cannot leave a cached failure visible");
    assert.equal(cleared.headers.get("etag"),initialETag,"absent overlay preserves the existing ETag contract");
  });
});


test("web Claude handoff create/read is user scoped and returns the official session receipt", async () => {
  const coordinator = new FakeCoordinator();
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();
  const handoffId = "88888888-8888-4888-8888-888888888888";
  const handoffSessionId = "99999999-9999-4999-8999-999999999999";
  const calls: Array<{ name: string; input: unknown }> = [];
  const claudeHandoffService = {
    async create(input: unknown) {
      calls.push({ name: "create", input });
      return {
        id: handoffId,
        conversationId,
        status: "pending" as const,
        handoffSessionId: null,
        effectiveWorkingDirectory: "/Users/test/project",
        failureCode: null,
        createdAt: "2026-10-07T08:00:00.000Z",
        completedAt: null,
      };
    },
    async read(input: unknown) {
      calls.push({ name: "read", input });
      return {
        id: handoffId,
        conversationId,
        status: "completed" as const,
        handoffSessionId,
        effectiveWorkingDirectory: "/Users/test/project",
        failureCode: null,
        createdAt: "2026-10-07T08:00:00.000Z",
        completedAt: "2026-10-07T08:00:01.000Z",
      };
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        if (request.header("x-test-user") === "owner") {
          request.webUserId = userId;
        }
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({
          coordinator,
          relayService,
          turnReader,
          claudeHandoffService,
        }),
      );
    },
    async (baseUrl) => {
      const unauthenticated = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/claude-handoff`,
        { method: "POST" },
      );
      assert.equal(unauthenticated.status, 401);

      const created = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/claude-handoff`,
        {
          method: "POST",
          headers: { "x-test-user": "owner" },
        },
      );
      assert.equal(created.status, 202);
      assert.equal(
        (await created.json() as { data: { status: string } }).data.status,
        "pending",
      );

      const read = await fetch(
        `${baseUrl}/api/v1/native-live/claude-handoffs/${handoffId}`,
        { headers: { "x-test-user": "owner" } },
      );
      assert.equal(read.status, 200);
      assert.deepEqual(
        (await read.json() as { data: unknown }).data,
        {
          id: handoffId,
          conversationId,
          status: "completed",
          handoffSessionId,
          effectiveWorkingDirectory: "/Users/test/project",
          failureCode: null,
          createdAt: "2026-10-07T08:00:00.000Z",
          completedAt: "2026-10-07T08:00:01.000Z",
        },
      );
      assert.deepEqual(calls, [
        {
          name: "create",
          input: { userId, conversationId },
        },
        {
          name: "read",
          input: { userId, requestId: handoffId },
        },
      ]);
    },
  );
});
