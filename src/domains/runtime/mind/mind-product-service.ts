import { randomUUID } from "node:crypto";
import {
  hashProductCreateRequest,
  normalizeProductCreateIdempotencyKey,
  ProductCreateIdempotencyError,
} from "../../product-write/product-create-idempotency.js";
import type {
  PersistentAuthority,
  PersistentWriteEnvelope,
} from "../shared/persistent-write-envelope.js";
import {
  CURRENT_SUBJECT_STATE_KINDS,
  type CurrentSubjectStateKind,
  type SubjectStateWrite,
} from "../subject-state/subject-state-contract.js";
import { readSubjectStateOccurredAt } from "../subject-state/subject-state-temporal.js";
import { createMindState } from "./mind-writer.js";

export type MindProductSource = "manual" | "runtime";

export type MindProductLifecycleProjection = {
  state: string | null;
  role: string | null;
  salience: number | null;
  pressure: number | null;
  strength: number | null;
  reinforcementCount: number | null;
  satisfactionTotal: number | null;
  protected: boolean | null;
  lastRecalledAt: string | null;
  resolvedAt: string | null;
  dormantAt: string | null;
};

export type MindProductProvenanceProjection = {
  sourceCount: number;
  sourceKinds: string[];
};

export type MindProductItem = {
  id: string;
  kind: CurrentSubjectStateKind;
  text: string | null;
  source: MindProductSource;
  authority: PersistentAuthority | null;
  occurredAt: string | null;
  note: string | null;
  lifecycle: MindProductLifecycleProjection;
  provenance: MindProductProvenanceProjection;
  createdAt: string;
  updatedAt: string;
};

export type MindProductPage = {
  items: MindProductItem[];
  nextCursor: string | null;
};

export type MindProductWriteProjection = {
  messageId: string;
  total: number;
  kinds: Array<{
    kind: CurrentSubjectStateKind;
    count: number;
  }>;
};

export type MindProductRow = {
  id: string;
  kind: CurrentSubjectStateKind;
  text: string | null;
  payload: Record<string, unknown> | null;
  envelope: PersistentWriteEnvelope;
  createdAt: string;
  updatedAt: string;
};

export type MindProductCursor = {
  updatedAt: string;
  id: string;
};

export interface MindProductRepository {
  list(input: {
    userId: string;
    subjectId: string;
    kind?: CurrentSubjectStateKind;
    limit: number;
    cursor?: MindProductCursor | null;
  }): Promise<{
    rows: MindProductRow[];
    nextCursor: MindProductCursor | null;
  }>;

  get(input: {
    userId: string;
    subjectId: string;
    stateId: string;
  }): Promise<MindProductRow | null>;

  insertManualIdempotent(input: {
    userId: string;
    subjectId: string;
    state: SubjectStateWrite;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<
    | { outcome: "committed"; row: MindProductRow }
    | { outcome: "idempotency_conflict" }
  >;

  delete(input: {
    userId: string;
    subjectId: string;
    stateId: string;
  }): Promise<{ outcome: "deleted"; deletedStateCount: number } | { outcome: "not_found" }>;

  readMessageWrites(input: {
    userId: string;
    subjectId: string;
    messageId: string;
  }): Promise<Array<{ kind: CurrentSubjectStateKind; count: number }> | null>;
}

export class MindProductServiceError extends Error {
  constructor(
    readonly code:
      | "INVALID_MIND"
      | "MIND_NOT_FOUND"
      | "MIND_FAILED"
      | "INVALID_IDEMPOTENCY_KEY"
      | "IDEMPOTENCY_CONFLICT",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "MindProductServiceError";
  }
}

export class MindProductService {
  constructor(
    private readonly repository: MindProductRepository,
    private readonly subjectId: string,
    private readonly createId: () => string = randomUUID,
  ) {}

  async list(input: {
    userId: string;
    kind?: CurrentSubjectStateKind;
    limit?: number;
    cursor?: string | null;
  }): Promise<MindProductPage> {
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new MindProductServiceError(
        "INVALID_MIND",
        "Mind list limit must be between 1 and 200.",
      );
    }
    if (input.kind && !isCurrentKind(input.kind)) {
      throw new MindProductServiceError(
        "INVALID_MIND",
        "Mind kind is invalid.",
      );
    }

    const cursor = input.cursor
      ? decodeCursor(input.cursor)
      : null;
    const page = await this.repository.list({
      userId: input.userId,
      subjectId: this.subjectId,
      ...(input.kind ? { kind: input.kind } : {}),
      limit,
      cursor,
    });

    return {
      items: page.rows.map(projectRow),
      nextCursor: page.nextCursor
        ? encodeCursor(page.nextCursor)
        : null,
    };
  }

  async get(input: {
    userId: string;
    stateId: string;
  }): Promise<MindProductItem> {
    requireUuid(input.stateId, "stateId");
    const row = await this.repository.get({
      userId: input.userId,
      subjectId: this.subjectId,
      stateId: input.stateId,
    });
    if (!row) {
      throw new MindProductServiceError("MIND_NOT_FOUND");
    }
    return projectRow(row);
  }

  async createManual(input: {
    userId: string;
    kind: CurrentSubjectStateKind;
    text: string;
    occurredAt?: string | null;
    note?: string | null;
    idempotencyKey?: unknown;
  }): Promise<MindProductItem> {
    if (!isCurrentKind(input.kind)) {
      throw new MindProductServiceError("INVALID_MIND", "Mind kind is invalid.");
    }
    const text = input.text.trim();
    if (!text || text.length > 20_000) {
      throw new MindProductServiceError(
        "INVALID_MIND",
        "Mind text must be 1-20000 characters.",
      );
    }
    const note = normalizeOptionalText(input.note, 10_000, "note");
    const occurredAt = normalizeOptionalIso(input.occurredAt, "occurredAt");
    const id = this.createId();

    const state = createMindState({
      id,
      userId: input.userId,
      subjectId: this.subjectId,
      kind: input.kind,
      text,
      source: { origin: "manual", occurredAt, note },
    });

    const idempotencyKey = mindCreateIdempotencyKey(
      input.idempotencyKey,
    );
    const result = await this.repository.insertManualIdempotent({
      userId: input.userId,
      subjectId: this.subjectId,
      state,
      idempotencyKey,
      requestHash: hashProductCreateRequest({
        operation: "mind_manual_create",
        subjectId: this.subjectId,
        kind: input.kind,
        text,
        occurredAt,
        note,
      }),
    });
    if (result.outcome === "idempotency_conflict") {
      throw new MindProductServiceError("IDEMPOTENCY_CONFLICT");
    }
    return projectRow(result.row);
  }

  async delete(input: {
    userId: string;
    stateId: string;
  }): Promise<{ deletedStateCount: number }> {
    requireUuid(input.stateId, "stateId");
    const result = await this.repository.delete({
      userId: input.userId,
      subjectId: this.subjectId,
      stateId: input.stateId,
    });
    if (result.outcome === "not_found") {
      throw new MindProductServiceError("MIND_NOT_FOUND");
    }
    return { deletedStateCount: result.deletedStateCount };
  }

  async readMessageWrites(input: {
    userId: string;
    messageId: string;
  }): Promise<MindProductWriteProjection> {
    requireUuid(input.messageId, "messageId");
    const rows = await this.repository.readMessageWrites({
      userId: input.userId,
      subjectId: this.subjectId,
      messageId: input.messageId,
    });
    if (!rows) {
      throw new MindProductServiceError("MIND_NOT_FOUND");
    }
    const byKind = new Map(rows.map((row) => [row.kind, row.count]));
    const kinds = CURRENT_SUBJECT_STATE_KINDS.flatMap((kind) => {
      const count = byKind.get(kind) ?? 0;
      return count > 0 ? [{ kind, count }] : [];
    });
    return {
      messageId: input.messageId,
      total: kinds.reduce((sum, item) => sum + item.count, 0),
      kinds,
    };
  }
}

function mindCreateIdempotencyKey(value: unknown): string {
  try {
    return normalizeProductCreateIdempotencyKey(value);
  } catch (error) {
    if (error instanceof ProductCreateIdempotencyError) {
      throw new MindProductServiceError(
        "INVALID_IDEMPOTENCY_KEY",
        "Idempotency-Key is required and must be 16-128 safe characters.",
      );
    }
    throw error;
  }
}

function projectRow(row: MindProductRow): MindProductItem {
  const payload = row.payload ?? {};
  const manual = record(payload.manual_v1);
  const authority = persistentAuthorityOrNull(
    row.envelope.authority,
  );
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    source:
      authority === "user_asserted"
        ? "manual"
        : "runtime",
    authority,
    occurredAt: readSubjectStateOccurredAt(payload),
    note: stringOrNull(manual?.note),
    lifecycle: lifecycleProjection(row.kind, payload),
    provenance: provenanceProjection(row.envelope),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function lifecycleProjection(
  kind: CurrentSubjectStateKind,
  payload: Record<string, unknown>,
): MindProductLifecycleProjection {
  const value = record(payload.lifecycle_v1);
  return {
    state:
      stringOrNull(value?.status)
      ?? stringOrNull(value?.phase),
    role: stringOrNull(value?.role),
    salience: numberOrNull(value?.salience),
    pressure: numberOrNull(value?.pressure),
    strength: numberOrNull(value?.strength),
    reinforcementCount: numberOrNull(value?.reinforcementCount),
    satisfactionTotal: numberOrNull(value?.satisfactionTotal),
    protected: booleanOrNull(value?.protected),
    lastRecalledAt: isoOrNull(value?.lastRecalledAt),
    resolvedAt: isoOrNull(value?.resolvedAt),
    dormantAt: isoOrNull(value?.dormantAt),
  };
}

function provenanceProjection(
  envelope: PersistentWriteEnvelope,
): MindProductProvenanceProjection {
  const provenance = record(
    (envelope as unknown as Record<string, unknown>).provenance,
  );
  const sources = Array.isArray(provenance?.sources)
    ? provenance.sources.filter((value) => record(value) !== null)
    : [];
  const sourceKinds = [
    ...new Set(
      sources.flatMap((source) => {
        const kind = record(source)?.kind;
        return typeof kind === "string" && kind.trim()
          ? [kind]
          : [];
      }),
    ),
  ].sort();
  return {
    sourceCount: sources.length,
    sourceKinds,
  };
}

function encodeCursor(cursor: MindProductCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string): MindProductCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      typeof parsed.updatedAt !== "string"
      || !Number.isFinite(Date.parse(parsed.updatedAt))
      || typeof parsed.id !== "string"
    ) {
      throw new Error("invalid");
    }
    requireUuid(parsed.id, "cursor.id");
    return {
      updatedAt: new Date(parsed.updatedAt).toISOString(),
      id: parsed.id,
    };
  } catch {
    throw new MindProductServiceError(
      "INVALID_MIND",
      "Mind cursor is invalid.",
    );
  }
}

function normalizeOptionalText(
  value: string | null | undefined,
  maxLength: number,
  label: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new MindProductServiceError(
      "INVALID_MIND",
      `${label} must be a string.`,
    );
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new MindProductServiceError(
      "INVALID_MIND",
      `${label} is too long.`,
    );
  }
  return normalized;
}

function normalizeOptionalIso(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new MindProductServiceError(
      "INVALID_MIND",
      `${label} must be an ISO timestamp.`,
    );
  }
  return new Date(value).toISOString();
}

function requireUuid(value: string, label: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  ) {
    throw new MindProductServiceError(
      "INVALID_MIND",
      `${label} must be a UUID.`,
    );
  }
}

function isCurrentKind(value: unknown): value is CurrentSubjectStateKind {
  return (
    typeof value === "string"
    && (CURRENT_SUBJECT_STATE_KINDS as readonly string[]).includes(value)
  );
}

function persistentAuthorityOrNull(
  value: unknown,
): PersistentAuthority | null {
  return value === "subject_authorized"
    || value === "user_asserted"
    || value === "derived"
    || value === "system_generated"
    ? value
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isoOrNull(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
