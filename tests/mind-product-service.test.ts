import assert from "node:assert/strict";
import test from "node:test";
import {
  MindProductService,
  MindProductServiceError,
  type MindProductRepository,
  type MindProductRow,
} from "../src/domains/runtime/mind-product-service.js";

const userId = "11111111-1111-4111-8111-111111111111";
const stateId = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";

function row(
  overrides: Partial<MindProductRow> = {},
): MindProductRow {
  return {
    id: stateId,
    kind: "memory",
    text: "remember this",
    payload: {
      lifecycle_v1: {
        status: "fading",
        salience: 0.42,
        protected: false,
        lastRecalledAt: "2026-09-27T01:00:00.000Z",
      },
    },
    envelope: {
      semanticActor: { kind: "subject", id: "G" },
      producer: { kind: "model", id: "claude-code" },
      committer: { kind: "runtime", id: "leileios-runtime" },
      authority: "subject_authorized",
      scope: {
        userId,
        subjectId: "G",
        applicability: "global",
        conversationId: null,
        pathHeadMessageId: null,
        visibility: "subject_private",
        sensitivity: "normal",
        audience: ["G"],
      },
      status: {
        generationStatus: "committed",
        presentationStatus: "presented",
        pathStatus: "current",
        settlementStatus: "settled",
        validityStatus: "valid",
      },
      provenance: {
        sources: [{ kind: "message", id: messageId }],
        causedBy: messageId,
        derivedFrom: [],
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: "test",
        processVersion: "test",
      },
    },
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T02:00:00.000Z",
    ...overrides,
  };
}

class Repository implements MindProductRepository {
  inserted: Parameters<MindProductRepository["insertManualIdempotent"]>[0] | null = null;
  deleted: Parameters<MindProductRepository["delete"]>[0] | null = null;
  row: MindProductRow | null = row();

  async list() {
    return {
      rows: this.row ? [this.row] : [],
      nextCursor: {
        updatedAt: "2026-09-26T00:00:00.000Z",
        id: "44444444-4444-4444-8444-444444444444",
      },
    };
  }

  async get() {
    return this.row;
  }

  async insertManualIdempotent(
    input: Parameters<MindProductRepository["insertManualIdempotent"]>[0],
  ) {
    this.inserted = input;
    return {
      outcome: "committed" as const,
      row: row({
        id: input.state.id,
        kind: input.state.kind,
        text: input.state.text ?? null,
        payload: input.state.payload ?? null,
        envelope: input.state.envelope,
      }),
    };
  }

  async delete(input: Parameters<MindProductRepository["delete"]>[0]) {
    this.deleted = input;
    return this.row
      ? { outcome: "deleted" as const, deletedStateCount: 2 }
      : { outcome: "not_found" as const };
  }

  async readMessageWrites() {
    return [
      { kind: "memory" as const, count: 2 },
      { kind: "thought" as const, count: 1 },
    ];
  }
}

test("Mind product list exposes bounded product projection and opaque cursor", async () => {
  const repository = new Repository();
  const service = new MindProductService(repository, "G");

  const page = await service.list({ userId, limit: 50 });
  assert.equal(page.items.length, 1);
  assert.deepEqual(page.items[0], {
    id: stateId,
    kind: "memory",
    text: "remember this",
    source: "runtime",
    authority: "subject_authorized",
    occurredAt: null,
    note: null,
    lifecycle: {
      state: "fading",
      role: null,
      salience: 0.42,
      pressure: null,
      strength: null,
      reinforcementCount: null,
      satisfactionTotal: null,
      protected: false,
      lastRecalledAt: "2026-09-27T01:00:00.000Z",
      resolvedAt: null,
      dormantAt: null,
    },
    provenance: {
      sourceCount: 1,
      sourceKinds: ["message"],
    },
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T02:00:00.000Z",
  });
  assert.ok(page.nextCursor);
});

test("manual Mind create is user_asserted, global, settled, and keeps historical occurrence separate", async () => {
  const repository = new Repository();
  const service = new MindProductService(
    repository,
    "G",
    () => stateId,
  );

  const created = await service.createManual({
    userId,
    kind: "thought",
    text: "  old note  ",
    occurredAt: "2025-01-02T03:04:05+08:00",
    note: "  copied by hand  ",
    idempotencyKey: "mind-manual-create-0001",
  });

  assert.equal(created.source, "manual");
  assert.equal(created.authority, "user_asserted");
  assert.equal(created.text, "old note");
  assert.equal(created.occurredAt, "2025-01-01T19:04:05.000Z");
  assert.equal(created.note, "copied by hand");

  const inserted = repository.inserted?.state;
  assert.ok(inserted);
  assert.equal(inserted.envelope.scope.applicability, "global");
  assert.equal(inserted.envelope.status.settlementStatus, "settled");
  assert.equal(inserted.envelope.status.validityStatus, "valid");
  assert.equal(inserted.envelope.provenance.sources[0]?.kind, "manual_entry");
  assert.deepEqual(inserted.payload, {
    manual_v1: {
      occurredAt: "2025-01-01T19:04:05.000Z",
      note: "copied by hand",
    },
  });
});

test("manual Memory writes unified user-supplied temporal metadata", async () => {
  const repository = new Repository();
  const service = new MindProductService(
    repository,
    "G",
    () => stateId,
  );

  const created = await service.createManual({
    userId,
    kind: "memory",
    text: "dated memory",
    occurredAt: "2026-09-29T20:30:00+08:00",
    idempotencyKey: "mind-manual-create-temporal-01",
  });

  assert.equal(created.occurredAt, "2026-09-29T12:30:00.000Z");
  assert.deepEqual(repository.inserted?.state.payload?.temporal_v1, {
    occurredAt: "2026-09-29T12:30:00.000Z",
    basis: "user_supplied",
    sourceMessageId: null,
  });
});

test("Mind product projection prefers unified runtime occurrence time", async () => {
  const repository = new Repository();
  repository.row = row({
    payload: {
      ...(row().payload ?? {}),
      temporal_v1: {
        occurredAt: "2026-09-29T12:34:56.000Z",
        basis: "source_message",
        sourceMessageId: messageId,
      },
    },
  });
  const service = new MindProductService(repository, "G");

  const projected = await service.get({ userId, stateId });
  assert.equal(projected.occurredAt, "2026-09-29T12:34:56.000Z");
});

test("manual Mind create requires a durable idempotency key", async () => {
  const repository = new Repository();
  const service = new MindProductService(repository, "G");

  await assert.rejects(
    service.createManual({
      userId,
      kind: "memory",
      text: "remember this",
    }),
    (error: unknown) =>
      error instanceof MindProductServiceError
      && error.code === "INVALID_IDEMPOTENCY_KEY",
  );
});

test("Mind delete delegates authoritative cleanup and not-found stays observable", async () => {
  const repository = new Repository();
  const service = new MindProductService(repository, "G");

  assert.deepEqual(
    await service.delete({ userId, stateId }),
    { deletedStateCount: 2 },
  );
  assert.deepEqual(repository.deleted, {
    userId,
    subjectId: "G",
    stateId,
  });

  repository.row = null;
  await assert.rejects(
    service.delete({ userId, stateId }),
    (error: unknown) =>
      error instanceof MindProductServiceError
      && error.code === "MIND_NOT_FOUND",
  );
});

test("message Mind write projection returns only kind/count metadata", async () => {
  const repository = new Repository();
  const service = new MindProductService(repository, "G");

  assert.deepEqual(
    await service.readMessageWrites({ userId, messageId }),
    {
      messageId,
      total: 3,
      kinds: [
        { kind: "memory", count: 2 },
        { kind: "thought", count: 1 },
      ],
    },
  );
});

test("Mind create rejects invalid text and list rejects malformed cursor", async () => {
  const repository = new Repository();
  const service = new MindProductService(repository, "G");

  await assert.rejects(
    service.createManual({
      userId,
      kind: "memory",
      text: "   ",
      idempotencyKey: "mind-manual-create-0002",
    }),
    /Mind text/,
  );
  await assert.rejects(
    service.list({
      userId,
      cursor: "not-a-valid-cursor",
    }),
    /cursor/i,
  );
});
