export type NativeSessionDrainReport = {
  ready: boolean;
  writer: "closed" | "unknown";
  tasks: Array<{ id: string; status: "stopped" | "completed" | "unknown" }>;
};
export function createNativeSessionDrainServer(input: {
  recoveryDirectory: string; recoverStale?: boolean;
  drain(conversationId: string, providerSessionId: string): Promise<NativeSessionDrainReport>;
}): Promise<() => Promise<void>>;
export function requestNativeSessionDrain(input: {
  recoveryDirectory: string; conversationId: string; providerSessionId: string;
}): Promise<NativeSessionDrainReport | null>;
