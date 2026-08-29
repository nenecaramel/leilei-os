export type BridgeEventStatus = "pending" | "reserved" | "host_sent" | "delivery_unknown";

export type BridgeEventReceipt = {
  id: string;
  status: BridgeEventStatus;
  createdAt: string;
  processingStatus: "unclaimed" | "claimed" | "completed";
  modelClaimedAt: string | null;
  modelCompletedAt: string | null;
  deliveryReconciledAt: string | null;
};

export type BridgeEventResponse = {
  success: true;
  data: BridgeEventReceipt;
};
