import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  ToyCommandRecord,
  ToyCreateInput,
} from "../src/domains/toy/toy-command-types.js";
import {
  ToyDomainError,
} from "../src/domains/toy/toy-command-service.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import {
  ToyCommandAuthenticationError,
  type ToyCommandToolDependencies,
} from "../src/mcp/tools/toy-command/register.js";

const AUTHENTICATED_USER_ID =
  "00000000-0000-4000-8000-000000000099";

class MockToyCommandToolService {
  calls: Array<{
    userId: string;
    input: unknown;
    idempotencyKey: string;
  }> = [];

  nextError: Error | undefined;

  async createIdempotently(
    userId: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<ToyCommandRecord> {
    this.calls.push({ userId, input, idempotencyKey });

    if (this.nextError) {
      throw this.nextError;
    }

    const command = input as ToyCreateInput;

    return {
      id:
        command.action === "set"
          ? "00000000-0000-4000-8000-000000000201"
          : "00000000-0000-4000-8000-000000000202",
      userId,
      action: command.action,
      percent:
        command.action === "set"
          ? command.percent
          : null,
      status: "pending",
      createdAt: new Date("2026-07-26T12:00:00.000Z"),
      expiresAt: new Date("2026-07-26T12:00:10.000Z"),
      durationSeconds: command.action === "set" ? command.durationSeconds ?? 60 : null,
      claimedAt: null,
      completedAt: null,
      expiredAt: null,
      error: null,
    };
  }
}

function createTestDependencies(
  toyCommandService: MockToyCommandToolService,
  getAuthenticatedUserId: () => string = () =>
    AUTHENTICATED_USER_ID,
): ToyCommandToolDependencies {
  return {
    toyCommandService,
    getAuthenticatedUserId,
  };
}

async function connectTestClient(
  dependencies: ToyCommandToolDependencies,
) {
  const server = createMcpServer({
    toyCommand: dependencies,
  });

  const client = new Client(
    {
      name: "toy-command-test-client",
      version: "1.0.0",
    },
    { capabilities: {} },
  );

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

test("tools/list exposes strict toy_set and toy_stop tools", async (t) => {
  const service = new MockToyCommandToolService();
  const { client, server } = await connectTestClient(
    createTestDependencies(service),
  );

  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.listTools();

  const toySet = response.tools.find(
    (tool) => tool.name === "toy_set",
  );
  const toyStop = response.tools.find(
    (tool) => tool.name === "toy_stop",
  );

  assert.ok(toySet);
  assert.ok(toyStop);

  assert.deepEqual(
    Object.keys(toySet.inputSchema.properties ?? {}),
    ["percent", "duration_seconds", "idempotency_key"],
  );
  assert.deepEqual(
    Object.keys(toyStop.inputSchema.properties ?? {}),
    ["idempotency_key"],
  );

  for (const tool of [toySet, toyStop]) {
    assert.equal(tool.annotations?.readOnlyHint, false);
    assert.equal(tool.annotations?.destructiveHint, true);
    assert.equal(tool.annotations?.idempotentHint, true);
    assert.equal(tool.annotations?.openWorldHint, false);
  }

  for (const forbidden of [
    "user_id",
    "userId",
    "action",
    "payload",
    "bytes",
    "hex",
    "url",
    "shell",
    "script",
    "command",
    "expires_at",
  ]) {
    assert.equal(
      forbidden in (toySet.inputSchema.properties ?? {}),
      false,
    );
    assert.equal(
      forbidden in (toyStop.inputSchema.properties ?? {}),
      false,
    );
  }
});

test("toy_set queues an authenticated set command", async (t) => {
  const service = new MockToyCommandToolService();
  const { client, server } = await connectTestClient(
    createTestDependencies(service),
  );

  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "toy_set",
    arguments: {
      percent: 1,
      idempotency_key: "toy-set-20260726-0001",
    },
  });

  assert.equal(response.isError, undefined);
  assert.deepEqual(service.calls, [
    {
      userId: AUTHENTICATED_USER_ID,
      input: {
        action: "set",
        percent: 1,
        durationSeconds: 60,
      },
      idempotencyKey: "toy-set-20260726-0001",
    },
  ]);

  assert.deepEqual(response.structuredContent, {
    success: true,
    data: {
      command: {
        id: "00000000-0000-4000-8000-000000000201",
        action: "set",
        percent: 1,
        duration_seconds: 60,
        status: "pending",
        created_at: "2026-07-26T12:00:00.000Z",
        expires_at: "2026-07-26T12:00:10.000Z",
      },
    },
  });
});

test("toy_set accepts the new percent 50 endpoint", async (t) => {
  const service = new MockToyCommandToolService();
  const { client, server } = await connectTestClient(
    createTestDependencies(service),
  );

  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "toy_set",
    arguments: {
      percent: 50,
      idempotency_key: "toy-set-20260816-cap50",
    },
  });

  assert.equal(response.isError, undefined);
  assert.equal(service.calls[0]?.input.percent, 50);
});

test("toy_stop queues an authenticated stop command", async (t) => {
  const service = new MockToyCommandToolService();
  const { client, server } = await connectTestClient(
    createTestDependencies(service),
  );

  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "toy_stop",
    arguments: { idempotency_key: "toy-stop-20260726-0001" },
  });

  assert.equal(response.isError, undefined);
  assert.deepEqual(service.calls, [
    {
      userId: AUTHENTICATED_USER_ID,
      input: {
        action: "stop",
      },
      idempotencyKey: "toy-stop-20260726-0001",
    },
  ]);

  assert.deepEqual(response.structuredContent, {
    success: true,
    data: {
      command: {
        id: "00000000-0000-4000-8000-000000000202",
        action: "stop",
        percent: null,
        status: "pending",
        created_at: "2026-07-26T12:00:00.000Z",
        expires_at: "2026-07-26T12:00:10.000Z",
      },
    },
  });
});

test("toy tools reject invalid intensity and arbitrary fields before service execution", async (t) => {
  const service = new MockToyCommandToolService();
  const { client, server } = await connectTestClient(
    createTestDependencies(service),
  );

  t.after(async () => {
    await client.close();
    await server.close();
  });

  const invalidSetArguments: Array<Record<string, unknown>> = [
    { percent: 0 },
    { percent: -1 },
    { percent: 51 },
    { percent: 1.5 },
    { percent: "1" },
    { percent: true },
    { percent: null },
    { percent: 1, user_id: AUTHENTICATED_USER_ID },
    { percent: 1, payload: "unsafe" },
    { percent: 1, bytes: [1, 2, 3] },
    { percent: 1, hex: "ff" },
    { percent: 1, url: "http://127.0.0.1:8765" },
    { percent: 1, shell: "echo unsafe" },
    { percent: 1, script: "unsafe" },
    { percent: 1, action: "stop" },
    { percent: 1, duration_seconds: 0 },
    { percent: 1, duration_seconds: 1201 },
    { percent: 1, duration_seconds: 1.5 },
    { percent: 1, duration_seconds: true },
  ];

  for (const argumentsValue of invalidSetArguments) {
    const response = await client.callTool({
      name: "toy_set",
      arguments: argumentsValue,
    });
    assert.equal(response.isError, true);
  }

  for (const argumentsValue of [
    { percent: 1 },
    { user_id: AUTHENTICATED_USER_ID },
    { payload: "unsafe" },
    { action: "set" },
  ]) {
    const response = await client.callTool({
      name: "toy_stop",
      arguments: argumentsValue,
    });
    assert.equal(response.isError, true);
  }

  assert.equal(service.calls.length, 0);
});

test("toy tools fail safely without authenticated context", async (t) => {
  const service = new MockToyCommandToolService();
  const { client, server } = await connectTestClient(
    createTestDependencies(service, () => {
      throw new ToyCommandAuthenticationError();
    }),
  );

  t.after(async () => {
    await client.close();
    await server.close();
  });

  const setResponse = await client.callTool({
    name: "toy_set",
    arguments: { percent: 1, idempotency_key: "toy-set-unauthenticated" },
  });

  const stopResponse = await client.callTool({
    name: "toy_stop",
    arguments: { idempotency_key: "toy-stop-unauthenticated" },
  });

  assert.equal(setResponse.isError, true);
  assert.equal(stopResponse.isError, true);
  assert.match(
    String(
      setResponse.content[0] &&
        "text" in setResponse.content[0]
        ? setResponse.content[0].text
        : "",
    ),
    /Authentication is required/,
  );
  assert.equal(service.calls.length, 0);
});

test("toy idempotency conflicts are explicitly non-retryable", async (t) => {
  const service = new MockToyCommandToolService();
  service.nextError = new ToyDomainError(
    "IDEMPOTENCY_CONFLICT",
    "private conflict detail",
  );

  const { client, server } = await connectTestClient(
    createTestDependencies(service),
  );

  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "toy_stop",
    arguments: { idempotency_key: "toy-stop-idem-conflict" },
  });

  assert.equal(response.isError, true);
  assert.deepEqual(
    (response.structuredContent as any).error,
    {
      code: "IDEMPOTENCY_CONFLICT",
      message: "This idempotency key was already used for a different toy command.",
      retryable: false,
      reason: "idempotency_conflict",
      current_revision: null,
      recommended_tool: null,
      recommended_arguments: null,
    },
  );
  assert.doesNotMatch(JSON.stringify(response), /private conflict detail/);
});

test("toy tools map domain failures to safe messages", async (t) => {
  const service = new MockToyCommandToolService();
  service.nextError = new ToyDomainError(
    "TOY_FORBIDDEN",
    "Internal binding detail must not escape.",
  );

  const { client, server } = await connectTestClient(
    createTestDependencies(service),
  );

  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "toy_stop",
    arguments: { idempotency_key: "toy-stop-domain-error" },
  });

  assert.equal(response.isError, true);

  const message = String(
    response.content[0] && "text" in response.content[0]
      ? response.content[0].text
      : "",
  );

  assert.match(message, /unavailable for the authenticated user/);
  assert.doesNotMatch(message, /Internal binding detail/);
});
