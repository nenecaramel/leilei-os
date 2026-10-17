import type { NativeLiveDaemonLeaseState } from "./native-live-mac-daemon-loop.js";

/**
 * The broker can park an idle Mac daemon past the 60s listener lease.
 * Replay a durable SDK background receipt only after reacquiring that lease.
 * On takeover, leave every receipt on disk and let the active listener own
 * the conversation; do not run Claude or steal a live owner's lease.
 */
export async function flushNativeLiveBackgroundWithListenerLease(input: {
  listenerInstanceId: string;
  relay: {
    renewLease(input: {
      listenerInstanceId: string;
      dispatchTarget: "claude_code";
    }): Promise<NativeLiveDaemonLeaseState>;
  };
  backgroundResults: { flush(): Promise<number> };
}): Promise<"busy" | "flushed"> {
  const lease = await input.relay.renewLease({
    listenerInstanceId: input.listenerInstanceId,
    dispatchTarget: "claude_code",
  });
  if (lease === "busy") return "busy";
  await input.backgroundResults.flush();
  return "flushed";
}
