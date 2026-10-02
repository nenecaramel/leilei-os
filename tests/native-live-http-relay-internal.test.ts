import assert from "node:assert/strict";
import test from "node:test";
import {
  createNativeLiveRelayInternalRouter,
} from "../src/web-api/native-live-relay-internal-router.js";
import {
  userId,
  listenerId,
  prepareId,
  requestId,
  conversationId,
  FakeRelayService,
  FakeRuntimeInteractionService,
  FakeRuntimeEventService,
  FakeBackgroundModelService,
  FakeSemanticService,
  withServer,
} from "./helpers/native-live-http-relay-fixtures.js";

test("internal relay reserve and result endpoints preserve listener ownership data", async () => {
  const relayService = new FakeRelayService();
  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({ relayService }),
      );
    },
    async (baseUrl) => {
      const lease = await fetch(
        `${baseUrl}/internal/native-live-relay/lease/renew`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(lease.status, 200);

      const reserve = await fetch(
        `${baseUrl}/internal/native-live-relay/reserve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(reserve.status, 200);
      const reservedPayload = await reserve.json() as {
        data: { reservationId: string; command: { prompt: string } };
      };
      assert.equal(reservedPayload.data.reservationId, prepareId);
      assert.equal(reservedPayload.data.command.prompt, "private prompt");

      const started = await fetch(
        `${baseUrl}/internal/native-live-relay/reservations/${prepareId}/execution-started`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ listener_instance_id: listenerId }),
        },
      );
      assert.equal(started.status, 200);

      const result = await fetch(
        `${baseUrl}/internal/native-live-relay/reservations/${prepareId}/result`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            result: {
              protocol_version: 1,
              prepare_id: prepareId,
              request_id: requestId,
              conversation_id: conversationId,
              status: "failure",
              error_code: "CLAUDE_PROCESS_FAILED",
            },
          }),
        },
      );
      assert.equal(result.status, 200);
      assert.deepEqual(
        relayService.calls.map((entry) => entry.name),
        [
          "renewLease",
          "reserveNext",
          "markExecutionStarted",
          "submitResult",
        ],
      );
    },
  );
});

test("internal relay work wait renews the listener lease and waits in authenticated user scope", async () => {
  const relayService = new FakeRelayService();
  const waitCalls: unknown[] = [];
  const workWaitService = {
    async wait(input: {
      userId: string;
      timeoutMs: number;
      signal?: AbortSignal | null;
    }) {
      waitCalls.push({
        userId: input.userId,
        timeoutMs: input.timeoutMs,
        aborted: input.signal?.aborted ?? false,
      });
      return {
        outcome: "ready" as const,
        version: 7,
      };
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          workWaitService,
        }),
      );
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/internal/native-live-relay/work/wait`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(
        (await response.json() as { data: unknown }).data,
        { outcome: "ready", version: 7 },
      );
      assert.deepEqual(relayService.calls[0], {
        name: "renewLease",
        input: {
          userId,
          listenerInstanceId: listenerId,
          dispatchTarget: "claude_code",
        },
      });
      assert.deepEqual(waitCalls, [{
        userId,
        timeoutMs: 45_000,
        aborted: false,
      }]);
    },
  );
});

test("internal relay semantic endpoints preserve the bounded candidate snapshot and score ids", async () => {
  const relayService = new FakeRelayService();
  const semanticService = new FakeSemanticService();
  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          semanticService,
        }),
      );
    },
    async (baseUrl) => {
      const reserve = await fetch(
        `${baseUrl}/internal/native-live-relay/semantic/reserve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(reserve.status, 200);
      const reservation = await reserve.json() as {
        data: {
          reservationId: string;
          candidates: Array<{ stateId: string }>;
        };
      };
      assert.equal(reservation.data.reservationId, prepareId);
      assert.deepEqual(
        reservation.data.candidates.map((candidate) => candidate.stateId),
        ["state-travel"],
      );

      const scores = await fetch(
        `${baseUrl}/internal/native-live-relay/semantic/reservations/${prepareId}/scores`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            scores: { "state-travel": 0.93 },
          }),
        },
      );
      assert.equal(scores.status, 200);
      assert.deepEqual(
        semanticService.calls.map((entry) => entry.name),
        ["reserveNext", "submitScores"],
      );
    },
  );
});

test("internal relay rejects malformed listener identity before calling the service", async () => {
  const relayService = new FakeRelayService();
  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({ relayService }),
      );
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/internal/native-live-relay/reserve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: "not-a-uuid",
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(response.status, 400);
      assert.equal(relayService.calls.length, 0);
    },
  );
});

test("internal relay background model endpoints preserve authenticated user scope without exposing it to Mac command", async () => {
  const relayService = new FakeRelayService();
  const backgroundModelService = new FakeBackgroundModelService();

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          backgroundModelService,
        }),
      );
    },
    async (baseUrl) => {
      const reserve = await fetch(
        `${baseUrl}/internal/native-live-relay/background-model/reserve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(reserve.status, 200);
      const payload = await reserve.json() as {
        data: {
          reservationId: string;
          command: Record<string, unknown>;
        };
      };
      assert.equal(payload.data.reservationId, prepareId);
      assert.equal("userId" in payload.data.command, false);
      assert.equal("user_id" in payload.data.command, false);
      assert.deepEqual(backgroundModelService.calls[0], {
        name: "reserveNext",
        input: {
          userId,
          listenerInstanceId: listenerId,
        },
      });

      const result = await fetch(
        `${baseUrl}/internal/native-live-relay/background-model/reservations/${prepareId}/result`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            result: {
              protocol_version: 1,
              task_id: prepareId,
              task_kind: "proactivity_deliberate",
              status: "success",
              final_text: '{"decision":"quiet"}',
            },
          }),
        },
      );
      assert.equal(result.status, 200);
      assert.deepEqual(backgroundModelService.calls[1], {
        name: "submitResult",
        input: {
          userId,
          listenerInstanceId: listenerId,
          taskId: prepareId,
          result: {
            protocol_version: 1,
            task_id: prepareId,
            task_kind: "proactivity_deliberate",
            status: "success",
            final_text: '{"decision":"quiet"}',
          },
        },
      });
    },
  );
});

test("internal relay companion background opportunity uses authenticated user scope", async () => {
  const relayService = new FakeRelayService();
  const calls: unknown[] = [];
  const observed: unknown[] = [];
  const companionBackgroundOpportunity = {
    async offer(input: unknown) {
      calls.push(input);
      return {
        reason: "startup" as const,
        maintenanceKinds: ["decay"],
        effectDeliveryScheduled: true,
        proactivityScheduled: false,
        failures: [],
      };
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          companionBackgroundOpportunity,
          observeCompanionBackgroundOpportunity(event) {
            observed.push(event);
          },
        }),
      );
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/internal/native-live-relay/background/opportunity`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
            reason: "startup",
          }),
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(calls, [{
        userId,
        reason: "startup",
      }]);
      const payload = await response.json() as {
        data: { reason: string };
      };
      assert.equal(payload.data.reason, "startup");
      assert.deepEqual(observed, [{
        outcome: "offered",
        reason: "startup",
        maintenanceKindCount: 1,
        effectDeliveryScheduled: true,
        proactivityScheduled: false,
        failureCount: 0,
      }]);

      const malformed = await fetch(
        `${baseUrl}/internal/native-live-relay/background/opportunity`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
            reason: "later",
          }),
        },
      );
      assert.equal(malformed.status, 400);
      assert.equal(calls.length, 1);
      assert.equal(observed.length, 1);
    },
  );
});

test("internal relay persists authenticated foreground runtime event batches", async () => {
  const relayService = new FakeRelayService();
  const runtimeEvents = new FakeRuntimeEventService();

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          runtimeEventService: runtimeEvents,
        }),
      );
    },
    async (baseUrl) => {
      const events = [
        {
          sequence: 1,
          event: {
            type: "partial_text" as const,
            payload: {
              delta: "hel",
              accumulated_length: 3,
            },
          },
        },
        {
          sequence: 2,
          event: {
            type: "result" as const,
            payload: {
              status: "success",
              final_text: "hello",
            },
          },
        },
      ];
      const response = await fetch(
        `${baseUrl}/internal/native-live-relay/reservations/${prepareId}/events/batch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            events,
          }),
        },
      );
      assert.equal(response.status, 201);
      assert.deepEqual(runtimeEvents.appendBatchCalls, [{
        userId,
        listenerInstanceId: listenerId,
        reservationId: prepareId,
        events,
      }]);
    },
  );
});

test("internal relay creates and waits for listener-owned runtime interactions", async () => {
  const relayService = new FakeRelayService();
  const interactions = new FakeRuntimeInteractionService();
  const interactionId =
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          runtimeInteractionService: interactions,
        }),
      );
    },
    async (baseUrl) => {
      const created = await fetch(
        `${baseUrl}/internal/native-live-relay/reservations/${prepareId}/interactions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            interaction_id: interactionId,
            kind: "permission",
            request: {
              toolName: "Write",
              input: { file_path: "/tmp/a" },
            },
          }),
        },
      );
      assert.equal(created.status, 201);

      const read = await fetch(
        `${baseUrl}/internal/native-live-relay/reservations/${prepareId}/interactions/${interactionId}/wait`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
          }),
        },
      );
      assert.equal(read.status, 200);
      assert.deepEqual(interactions.createCalls, [{
        userId,
        listenerInstanceId: listenerId,
        reservationId: prepareId,
        interactionId,
        kind: "permission",
        request: {
          toolName: "Write",
          input: { file_path: "/tmp/a" },
        },
      }]);
      assert.deepEqual(interactions.waitCalls, [{
        userId,
        listenerInstanceId: listenerId,
        reservationId: prepareId,
        interactionId,
        timeoutMs: 25_000,
        hasSignal: true,
      }]);
    },
  );
});

test("internal relay waits for and completes listener-owned foreground controls", async () => {
  const relayService = new FakeRelayService();
  const controlId =
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const calls = [];
  const runtimeControlService = {
    async waitNextForListener(input: unknown) {
      const value = input as {
        userId: string;
        listenerInstanceId: string;
        reservationId: string;
        timeoutMs: number;
        signal?: AbortSignal | null;
      };
      calls.push({
        name: "wait",
        input: {
          userId: value.userId,
          listenerInstanceId: value.listenerInstanceId,
          reservationId: value.reservationId,
          timeoutMs: value.timeoutMs,
          hasSignal: value.signal instanceof AbortSignal,
        },
      });
      return {
        outcome: "reserved" as const,
        control: {
          controlId,
          prepareId,
          kind: "mid_turn_input" as const,
          payload: { text: "steer" },
          status: "reserved" as const,
          reservedBy: listenerId,
          receipt: null,
          failureCode: null,
          createdAt: "2026-09-25T00:00:00.000Z",
          updatedAt: "2026-09-25T00:00:00.000Z",
          appliedAt: null,
        },
      };
    },
    async completeForListener(input: unknown) {
      calls.push({ name: "complete", input });
      return "applied" as const;
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          runtimeControlService,
        }),
      );
    },
    async (baseUrl) => {
      const waited = await fetch(
        `${baseUrl}/internal/native-live-relay/reservations/${prepareId}/controls/wait`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
          }),
        },
      );
      assert.equal(waited.status, 200);
      const waitedPayload = await waited.json() as {
        data: {
          outcome: string;
          control: {
            controlId: string;
            kind: string;
            payload: Record<string, unknown>;
          };
        };
      };
      assert.equal(waitedPayload.data.outcome, "reserved");
      assert.deepEqual(waitedPayload.data.control, {
        controlId,
        prepareId,
        kind: "mid_turn_input",
        payload: { text: "steer" },
        status: "reserved",
        reservedBy: listenerId,
        receipt: null,
        failureCode: null,
        createdAt: "2026-09-25T00:00:00.000Z",
        updatedAt: "2026-09-25T00:00:00.000Z",
        appliedAt: null,
      });

      const completed = await fetch(
        `${baseUrl}/internal/native-live-relay/reservations/${prepareId}/controls/${controlId}/complete`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            outcome: {
              status: "applied",
              receipt: { status: "queued" },
            },
          }),
        },
      );
      assert.equal(completed.status, 200);
      assert.deepEqual(calls, [
        {
          name: "wait",
          input: {
            userId,
            listenerInstanceId: listenerId,
            reservationId: prepareId,
            timeoutMs: 25_000,
            hasSignal: true,
          },
        },
        {
          name: "complete",
          input: {
            userId,
            listenerInstanceId: listenerId,
            reservationId: prepareId,
            controlId,
            outcome: {
              status: "applied",
              receipt: { status: "queued" },
            },
          },
        },
      ]);
    },
  );
});

test("internal relay reserves and receipts provider session cleanup in authenticated user scope", async () => {
  const relayService = new FakeRelayService();
  const cleanupId = "77777777-7777-4777-8777-777777777777";
  const calls: Array<{ name: string; input: unknown }> = [];
  const providerSessionCleanupService = {
    async reserveNext(input: unknown) {
      calls.push({ name: "reserve", input });
      return {
        reservationId: cleanupId,
        providerSessionId: "provider-old-fork",
      };
    },
    async complete(input: unknown) {
      calls.push({ name: "complete", input });
      return "applied" as const;
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          providerSessionCleanupService,
        }),
      );
    },
    async (baseUrl) => {
      const reserved = await fetch(
        `${baseUrl}/internal/native-live-relay/provider-session-cleanup/reserve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(reserved.status, 200);
      assert.deepEqual(
        (await reserved.json() as { data: unknown }).data,
        {
          reservationId: cleanupId,
          providerSessionId: "provider-old-fork",
        },
      );

      const completed = await fetch(
        `${baseUrl}/internal/native-live-relay/provider-session-cleanup/reservations/${cleanupId}/result`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            status: "success",
          }),
        },
      );
      assert.equal(completed.status, 200);
      assert.deepEqual(calls, [
        {
          name: "reserve",
          input: {
            userId,
            listenerInstanceId: listenerId,
          },
        },
        {
          name: "complete",
          input: {
            userId,
            listenerInstanceId: listenerId,
            reservationId: cleanupId,
            outcome: { status: "success" },
          },
        },
      ]);
    },
  );
});

test("internal relay output attachment upload endpoints stay user scoped", async () => {
  const attachmentId =
    "66666666-6666-4666-8666-666666666666";
  const calls: Array<{ name: string; input: unknown }> = [];
  const descriptor = {
    attachmentId,
    filename: "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 321,
    sha256: "a".repeat(64),
    kind: "file" as const,
    status: "ready" as const,
    objectKey: "native-live/user/report",
    boundMessageId: null,
    createdAt: "2026-09-30T06:00:00.000Z",
    expiresAt: "2026-09-30T07:00:00.000Z",
  };
  const attachmentService = {
    async createUploadSlot(input: unknown) {
      calls.push({ name: "createUploadSlot", input });
      return {
        attachment: {
          ...descriptor,
          status: "uploading" as const,
        },
        upload: {
          url: "https://bucket.example/upload",
          method: "PUT" as const,
          headers: {
            "content-type": "application/pdf",
            "x-amz-meta-sha256": "a".repeat(64),
          },
          expiresAt: "2026-09-30T06:10:00.000Z",
        },
      };
    },
    async completeUpload(input: unknown) {
      calls.push({ name: "completeUpload", input });
      return descriptor;
    },
    async createDownloadSlot() {
      throw new Error("unused");
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService: new FakeRelayService(),
          attachmentService,
        }),
      );
    },
    async (baseUrl) => {
      const upload = await fetch(
        `${baseUrl}/internal/native-live-relay/attachments/upload-slots`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: "report.pdf",
            mime_type: "application/pdf",
            size_bytes: 321,
            sha256: "a".repeat(64),
            kind: "file",
          }),
        },
      );
      assert.equal(upload.status, 201);
      const uploadPayload = await upload.json() as {
        data: { attachment: { attachmentId: string } };
      };
      assert.equal(
        uploadPayload.data.attachment.attachmentId,
        attachmentId,
      );

      const complete = await fetch(
        `${baseUrl}/internal/native-live-relay/attachments/${attachmentId}/complete`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      assert.equal(complete.status, 200);
      const completePayload = await complete.json() as {
        data: { attachment: { status: string } };
      };
      assert.equal(
        completePayload.data.attachment.status,
        "ready",
      );
    },
  );

  assert.deepEqual(calls, [
    {
      name: "createUploadSlot",
      input: {
        userId,
        filename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 321,
        sha256: "a".repeat(64),
        kind: "file",
      },
    },
    {
      name: "completeUpload",
      input: {
        userId,
        attachmentId,
      },
    },
  ]);
});
