import { createHash, randomUUID } from "node:crypto";
import {
  BRIDGE_EVENT_KIND,
  BRIDGE_EVENT_SOURCE,
  BRIDGE_TEXT_MAX_CHARS,
  BRIDGE_VISIBLE_ROUTE_HINT,
} from "./bridge-constants.js";
import type { BridgeEventRepository } from "./bridge-event-repository.js";
import type {
  BridgeEventRecord,
  BridgeListenerLeaseResult,
} from "./bridge-event-types.js";

const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const BRIDGE_REQUEST_FINGERPRINT_VERSION = "leilei-os:bridge-event:v1";

export type BridgeDomainErrorCode =
  | "INVALID_INPUT"
  | "IDEMPOTENCY_CONFLICT"
  | "EVENT_NOT_FOUND"
  | "LISTENER_BUSY"
  | "LISTENER_NOT_ACTIVE"
  | "EVENT_CONFLICT";

export class BridgeDomainError extends Error {
  constructor(
    readonly code: BridgeDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BridgeDomainError";
  }
}

export type BridgeServiceOptions = {
  createId?: () => string;
  now?: () => Date;
};

export class BridgeService {
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly repository: BridgeEventRepository,
    options: BridgeServiceOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async createPwaEvent(
    userId: string,
    text: unknown,
    idempotencyKey: unknown,
  ): Promise<{ event: BridgeEventRecord; created: boolean }> {
    const visibleText = this.normalizeVisibleText(text);
    const normalizedIdempotencyKey = this.normalizeIdempotencyKey(idempotencyKey);
    const id = this.createId();
    const createdAt = this.now();
    const result = await this.repository.createEvent(userId, {
      id,
      idempotencyKey: normalizedIdempotencyKey,
      requestHash: hashBridgeEventRequest({
        kind: BRIDGE_EVENT_KIND,
        source: BRIDGE_EVENT_SOURCE,
        text: visibleText,
      }),
      kind: BRIDGE_EVENT_KIND,
      source: BRIDGE_EVENT_SOURCE,
      visibleText,
      modelContext: createBridgeModelContext({
        eventId: id,
        createdAt,
        kind: BRIDGE_EVENT_KIND,
        source: BRIDGE_EVENT_SOURCE,
      }),
      createdAt,
    });

    if (result.outcome === "conflict") {
      throw new BridgeDomainError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for different Bridge event content.",
      );
    }

    return {
      event: result.event,
      created: result.outcome === "created",
    };
  }

  async getEvent(userId: string, eventId: string): Promise<BridgeEventRecord> {
    const event = await this.repository.getEvent(userId, eventId);
    if (!event) {
      throw new BridgeDomainError("EVENT_NOT_FOUND", "Bridge event was not found.");
    }
    return event;
  }

  async startListener(
    userId: string,
    listenerInstanceId: string,
  ): Promise<BridgeListenerLeaseResult> {
    const result = await this.repository.acquireListenerLease(userId, listenerInstanceId);
    if (result.state === "busy") {
      throw new BridgeDomainError("LISTENER_BUSY", "A Bridge listener is already active.");
    }
    return result;
  }

  async stopListener(userId: string, listenerInstanceId: string): Promise<boolean> {
    return this.repository.releaseListenerLease(userId, listenerInstanceId);
  }

  async reserveNext(
    userId: string,
    listenerInstanceId: string,
  ): Promise<BridgeEventRecord | null> {
    return this.repository.reserveNext(userId, listenerInstanceId);
  }

  async markDispatchStarted(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
  ): Promise<BridgeEventRecord> {
    return this.requireEvent(
      this.repository.markDispatchStarted(userId, listenerInstanceId, eventId),
    );
  }

  async markHostSent(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
  ): Promise<BridgeEventRecord> {
    return this.requireEvent(
      this.repository.markHostSent(userId, listenerInstanceId, eventId),
    );
  }

  async markDeliveryUnknown(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
    safeErrorCode: string,
  ): Promise<BridgeEventRecord> {
    return this.requireEvent(
      this.repository.markDeliveryUnknown(userId, listenerInstanceId, eventId, safeErrorCode),
    );
  }

  async release(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
    safeErrorCode?: string,
  ): Promise<BridgeEventRecord> {
    return this.requireEvent(
      this.repository.release(userId, listenerInstanceId, eventId, safeErrorCode),
    );
  }

  private normalizeVisibleText(value: unknown): string {
    if (typeof value !== "string") {
      throw new BridgeDomainError("INVALID_INPUT", "Bridge text must be a nonblank string.");
    }
    const normalized = value.replace(/\r\n?/g, "\n").trim();
    if (normalized.length === 0 || normalized.length > BRIDGE_TEXT_MAX_CHARS) {
      throw new BridgeDomainError("INVALID_INPUT", "Bridge text is outside the allowed length.");
    }
    return normalized;
  }

  private normalizeIdempotencyKey(value: unknown): string {
    if (typeof value !== "string") {
      throw new BridgeDomainError("INVALID_INPUT", "The Bridge idempotency key is invalid.");
    }
    const normalized = value.trim();
    if (
      normalized.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
      normalized.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
      !IDEMPOTENCY_KEY_PATTERN.test(normalized)
    ) {
      throw new BridgeDomainError("INVALID_INPUT", "The Bridge idempotency key is invalid.");
    }
    return normalized;
  }

  private async requireEvent(
    result: Promise<BridgeEventRecord | null>,
  ): Promise<BridgeEventRecord> {
    const event = await result;
    if (!event) {
      throw new BridgeDomainError("EVENT_CONFLICT", "The Bridge event reservation is no longer active.");
    }
    return event;
  }
}

export function hashBridgeEventRequest(value: {
  kind: "chat";
  source: "leileios_pwa";
  text: string;
}): string {
  return createHash("sha256")
    .update(`${BRIDGE_REQUEST_FINGERPRINT_VERSION}\n${JSON.stringify(value)}`, "utf8")
    .digest("hex");
}

export function createBridgeModelContext(input: {
  eventId: string;
  createdAt: Date;
  kind: "chat";
  source: "leileios_pwa";
}): string {
  return [
    `LeileiOS Bridge event ${input.eventId}.`,
    `Source: ${input.source}; kind: ${input.kind}; created at ${input.createdAt.toISOString()}.`,
    `Route the visible user message through ${BRIDGE_VISIBLE_ROUTE_HINT}.`,
  ].join(" ");
}
