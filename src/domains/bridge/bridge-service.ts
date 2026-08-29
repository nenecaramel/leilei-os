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
  | "EVENT_CONFLICT"
  | "PROCESSING_CONFLICT";

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
  observe?: (event: BridgeServiceObserverEvent) => void;
};

export type BridgeProcessingObserverEvent =
  | { name: "bridge_event_processing_claimed" | "bridge_event_processing_completed"; eventId: string; outcome: "applied" | "idempotent"; processingState: BridgeEventRecord["processingState"]; reconciled: boolean }
  | { name: "bridge_event_processing_conflict"; eventId: string; operation: "claim" | "complete" };

export type BridgeServiceObserverEvent =
  | {
      name: "bridge_event_created";
      eventId: string;
      status: BridgeEventRecord["status"];
    }
  | {
      name: "bridge_listener_lease_acquired" | "bridge_listener_lease_renewed";
      state: "acquired" | "renewed";
    }
  | { name: "bridge_listener_busy" }
  | { name: "bridge_listener_released"; released: boolean }
  | {
      name: "bridge_event_reserved";
      eventId: string | null;
      status: BridgeEventRecord["status"] | null;
    }
  | {
      name:
        | "bridge_event_dispatch_started"
        | "bridge_event_host_sent"
        | "bridge_event_delivery_unknown"
        | "bridge_event_released";
      eventId: string;
    }
  | BridgeProcessingObserverEvent;

export class BridgeService {
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly observe?: (event: BridgeServiceObserverEvent) => void;

  constructor(
    private readonly repository: BridgeEventRepository,
    options: BridgeServiceOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.observe = options.observe;
  }

  private emit(event: BridgeServiceObserverEvent): void { try { this.observe?.(event); } catch { /* observational only */ } }

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

    const event = result.event;
    if (result.outcome === "created") this.emit({ name: "bridge_event_created", eventId: event.id, status: event.status });
    return {
      event,
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
      this.emit({ name: "bridge_listener_busy" });
      throw new BridgeDomainError("LISTENER_BUSY", "A Bridge listener is already active.");
    }
    this.emit({ name: result.state === "acquired" ? "bridge_listener_lease_acquired" : "bridge_listener_lease_renewed", state: result.state });
    return result;
  }

  async stopListener(userId: string, listenerInstanceId: string): Promise<boolean> {
    const released = await this.repository.releaseListenerLease(userId, listenerInstanceId);
    this.emit({ name: "bridge_listener_released", released });
    return released;
  }

  async reserveNext(
    userId: string,
    listenerInstanceId: string,
  ): Promise<BridgeEventRecord | null> {
    const event = await this.repository.reserveNext(userId, listenerInstanceId);
    this.emit({ name: "bridge_event_reserved", eventId: event?.id ?? null, status: event?.status ?? null });
    return event;
  }

  async markDispatchStarted(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
  ): Promise<BridgeEventRecord> {
    const event = await this.requireEvent(
      this.repository.markDispatchStarted(userId, listenerInstanceId, eventId),
    );
    this.emit({ name: "bridge_event_dispatch_started", eventId: event.id });
    return event;
  }

  async markHostSent(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
  ): Promise<BridgeEventRecord> {
    const event = await this.requireEvent(
      this.repository.markHostSent(userId, listenerInstanceId, eventId),
    );
    this.emit({ name: "bridge_event_host_sent", eventId: event.id });
    return event;
  }

  async markDeliveryUnknown(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
    safeErrorCode: string,
  ): Promise<BridgeEventRecord> {
    const event = await this.requireEvent(
      this.repository.markDeliveryUnknown(userId, listenerInstanceId, eventId, safeErrorCode),
    );
    this.emit({ name: "bridge_event_delivery_unknown", eventId: event.id });
    return event;
  }

  async release(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
    safeErrorCode?: string,
  ): Promise<BridgeEventRecord> {
    const event = await this.requireEvent(
      this.repository.release(userId, listenerInstanceId, eventId, safeErrorCode),
    );
    this.emit({ name: "bridge_event_released", eventId: event.id });
    return event;
  }

  async claimEvent(userId: string, eventId: string): Promise<BridgeEventRecord> {
    const result = await this.repository.claimProcessing(userId, eventId);
    if (result.outcome === "not_found") {
      throw new BridgeDomainError("EVENT_NOT_FOUND", "Bridge event was not found.");
    }
    if (result.outcome === "conflict") {
      this.emit({ name: "bridge_event_processing_conflict", eventId, operation: "claim" });
      throw new BridgeDomainError("PROCESSING_CONFLICT", "Bridge event processing is not eligible for claiming.");
    }
    if (result.outcome !== "applied" && result.outcome !== "idempotent") {
      throw new BridgeDomainError("EVENT_CONFLICT", "Bridge event processing could not be completed.");
    }
    const event = result.event;
    this.emit({
      name: "bridge_event_processing_claimed",
      eventId: event.id,
      outcome: result.outcome,
      processingState: event.processingState,
      reconciled: event.deliveryReconciledAt !== null,
    });
    return event;
  }

  async completeEvent(userId: string, eventId: string): Promise<BridgeEventRecord> {
    const result = await this.repository.completeProcessing(userId, eventId);
    if (result.outcome === "not_found") {
      throw new BridgeDomainError("EVENT_NOT_FOUND", "Bridge event was not found.");
    }
    if (result.outcome === "conflict") {
      this.emit({ name: "bridge_event_processing_conflict", eventId, operation: "complete" });
      throw new BridgeDomainError("PROCESSING_CONFLICT", "Bridge event processing has not been claimed.");
    }
    if (result.outcome !== "applied" && result.outcome !== "idempotent") {
      throw new BridgeDomainError("EVENT_CONFLICT", "Bridge event processing could not be completed.");
    }
    const event = result.event;
    this.emit({
      name: "bridge_event_processing_completed",
      eventId: event.id,
      outcome: result.outcome,
      processingState: event.processingState,
      reconciled: event.deliveryReconciledAt !== null,
    });
    return event;
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
