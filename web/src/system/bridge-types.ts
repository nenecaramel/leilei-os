export type BridgeEventStatus = "pending" | "reserved" | "host_sent" | "delivery_unknown";

export type BridgeEventReceipt = {
  id: string;
  status: BridgeEventStatus;
  createdAt: string;
};

export type BridgeEventResponse = {
  success: true;
  data: BridgeEventReceipt;
};
