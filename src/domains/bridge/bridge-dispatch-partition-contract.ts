import {
  LEGACY_BRIDGE_DISPATCH_TARGET,
  type BridgeDispatchTarget,
  resolveBridgeDispatchTarget,
} from "./native-live-relay-contract.js";

export const BRIDGE_TARGETED_LEASE_PRIMARY_KEY = [
  "user_id",
  "dispatch_target",
] as const;

export const BRIDGE_TARGETED_RESERVATION_INDEX = [
  "user_id",
  "dispatch_target",
  "status",
  "created_at",
  "id",
] as const;

export type BridgeListenerScope = {
  userId: string;
  dispatchTarget: BridgeDispatchTarget;
  listenerInstanceId: string;
};

export type BridgeStoredTarget = BridgeDispatchTarget | null | undefined;

export class BridgeDispatchPartitionError extends Error {
  constructor(
    readonly code:
      | "BRIDGE_TARGET_MISMATCH"
      | "BRIDGE_LISTENER_OWNER_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "BridgeDispatchPartitionError";
  }
}

/**
 * Existing rows have no dispatch_target column. During a future migration,
 * null/missing rows must remain owned by the legacy ChatGPT host lane only.
 */
export function resolveStoredBridgeDispatchTarget(
  value: BridgeStoredTarget,
): BridgeDispatchTarget {
  return resolveBridgeDispatchTarget(value, { allowLegacyMissing: true });
}

export function bridgeListenerLeaseKey(input: {
  userId: string;
  dispatchTarget: BridgeDispatchTarget;
}): string {
  return `${input.userId}:${input.dispatchTarget}`;
}

export function canBridgeListenerReserve(input: {
  eventDispatchTarget: BridgeStoredTarget;
  listenerDispatchTarget: BridgeDispatchTarget;
}): boolean {
  return (
    resolveStoredBridgeDispatchTarget(input.eventDispatchTarget)
    === input.listenerDispatchTarget
  );
}

export function assertBridgeListenerCanReserve(input: {
  eventDispatchTarget: BridgeStoredTarget;
  listenerDispatchTarget: BridgeDispatchTarget;
}): void {
  if (!canBridgeListenerReserve(input)) {
    throw new BridgeDispatchPartitionError(
      "BRIDGE_TARGET_MISMATCH",
      "Bridge event belongs to a different dispatch target.",
    );
  }
}

export function assertBridgeTerminalCallbackOwnership(input: {
  eventDispatchTarget: BridgeStoredTarget;
  reservedBy: string | null;
  scope: BridgeListenerScope;
}): void {
  assertBridgeListenerCanReserve({
    eventDispatchTarget: input.eventDispatchTarget,
    listenerDispatchTarget: input.scope.dispatchTarget,
  });
  if (input.reservedBy !== input.scope.listenerInstanceId) {
    throw new BridgeDispatchPartitionError(
      "BRIDGE_LISTENER_OWNER_MISMATCH",
      "Bridge event is reserved by a different listener instance.",
    );
  }
}

export function isLegacyBridgeLane(
  value: BridgeStoredTarget,
): boolean {
  return resolveStoredBridgeDispatchTarget(value) === LEGACY_BRIDGE_DISPATCH_TARGET;
}
