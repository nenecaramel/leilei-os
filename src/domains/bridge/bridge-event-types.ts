export type BridgeEventStatus =
  | "pending"
  | "reserved"
  | "host_sent"
  | "delivery_unknown";

export type BridgeEventRecord = {
  id: string;
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  kind: "chat";
  source: "leileios_pwa";
  visibleText: string;
  modelContext: string;
  status: BridgeEventStatus;
  createdAt: Date;
  reservedBy: string | null;
  reservedAt: Date | null;
  reservationExpiresAt: Date | null;
  dispatchStartedAt: Date | null;
  hostSentAt: Date | null;
  deliveryUnknownAt: Date | null;
  retryCount: number;
  lastErrorCode: string | null;
};

export type BridgeEventCreateInput = {
  id: string;
  idempotencyKey: string;
  requestHash: string;
  kind: "chat";
  source: "leileios_pwa";
  visibleText: string;
  modelContext: string;
  createdAt: Date;
};

export type BridgeEventCreateResult =
  | { outcome: "created" | "replayed"; event: BridgeEventRecord }
  | { outcome: "conflict" };

export type BridgeListenerLeaseResult = {
  state: "acquired" | "renewed" | "busy";
};
