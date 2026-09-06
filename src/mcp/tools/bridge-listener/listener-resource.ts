import { readFileSync } from "node:fs";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeEventRecord } from "../../../domains/bridge/bridge-event-types.js";

export const BRIDGE_RESOURCE_URI = "ui://leileios/message-bridge/v4";
export const BRIDGE_AMBIGUITY_ACCEPTANCE_PREFIX = "PHASE2 AMBIGUOUS E2E ";

export type BridgeListenerResourceOptions = {
  ambiguityAcceptanceEnabled?: boolean;
};

export type SentinelWakeRoutingMetadata = {
  eventId: string;
  wakeId: string;
  sentinelId: string;
  controlRevision: number;
  scheduledFor: string;
  reservedAt: string | null;
  dispatchStartedAt: string | null;
};

export function getSentinelWakeRoutingMetadata(
  event: Pick<BridgeEventRecord, "id" | "kind" | "source" | "modelContext" | "reservedAt" | "dispatchStartedAt">,
): SentinelWakeRoutingMetadata | null {
  if (event.kind !== "wake" || event.source !== "leileios_sentinel") return null;
  const match = event.modelContext.match(
    /wakeId=([^;]+); sentinelId=([^;]+); controlRevision=(\d+); scheduledFor=([^ ]+)\./,
  );
  if (!match) return null;
  return {
    eventId: event.id,
    wakeId: match[1]!,
    sentinelId: match[2]!,
    controlRevision: Number(match[3]),
    scheduledFor: match[4]!,
    reservedAt: event.reservedAt?.toISOString() ?? null,
    dispatchStartedAt: event.dispatchStartedAt?.toISOString() ?? null,
  };
}

export function composeBridgeDispatchContext(
  event: Pick<BridgeEventRecord, "id" | "modelContext"> & {
    kind?: BridgeEventRecord["kind"];
    source?: BridgeEventRecord["source"];
    wakeMetadata?: {
      wakeId: string;
      sentinelId: string;
      controlRevision: number;
      scheduledFor: string;
    };
  },
): string {
  if (event.kind === "wake" && event.source === "leileios_sentinel" && event.wakeMetadata) {
    return `LeileiOS Sentinel event metadata: eventId=${event.id}; wakeId=${event.wakeMetadata.wakeId}; sentinelId=${event.wakeMetadata.sentinelId}; controlRevision=${event.wakeMetadata.controlRevision}; scheduledFor=${event.wakeMetadata.scheduledFor}.`;
  }
  return `${event.modelContext}\n\nLeileiOS Bridge event metadata: eventId=${event.id}.`;
}

const BRIDGE_RESOURCE_META = {
  ui: {
    csp: {
      connectDomains: [],
      resourceDomains: [],
    },
  },
} as const;

const BRIDGE_BROWSER_BUNDLE = readFileSync(new URL("./browser-runtime.js", import.meta.url), "utf8");

function escapeInlineScript(script: string): string {
  return script.replaceAll("</script", "<\\/script");
}

export function createBridgeListenerHtml(
  options: BridgeListenerResourceOptions = {},
): string {
  const config = JSON.stringify({
    ambiguityAcceptanceEnabled: options.ambiguityAcceptanceEnabled === true,
    ambiguityAcceptancePrefix: BRIDGE_AMBIGUITY_ACCEPTANCE_PREFIX,
  });
  return `<!doctype html><meta charset="utf-8"><title>LeileiOS Message Bridge</title><style>
  :root { color-scheme: light; font: 14px system-ui, sans-serif; }
  body { margin: 0; padding: 16px; color: #333; background: #fff; }
  h1 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
  [data-bridge-status] { margin: 0 0 12px; color: #666; }
  [data-bridge-occupied] { margin: 0 0 12px; color: #777; }
  [data-bridge-controls] { margin-bottom: 12px; }
  details { margin-top: 12px; }
  summary { cursor: pointer; color: #555; }
  [data-bridge-diag] { box-sizing: border-box; max-height: 220px; overflow: auto; margin: 8px 0 0; padding: 8px; border: 1px solid #ddd; border-radius: 5px; background: #fafafa; color: #444; font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
  button { margin-right: 8px; padding: 6px 10px; border: 1px solid #bbb; border-radius: 5px; background: #fff; color: #333; cursor: pointer; }
  button:disabled { cursor: default; opacity: .55; }
</style><main aria-label="LeileiOS Message Bridge">
  <h1>LeileiOS Message Bridge</h1>
  <p data-bridge-status role="status">Idle</p>
  <p data-bridge-occupied hidden>Another listener is already active.</p>
  <div data-bridge-controls>
    <button type="button" data-bridge-start>Start</button>
    <button type="button" data-bridge-stop disabled>Stop</button>
    <button type="button" data-bridge-sync disabled>Sync now</button>
  </div>
  <details open>
    <summary>Diagnostics</summary>
    <pre data-bridge-diag aria-live="polite"></pre>
  </details>
</main><script>window.__LEILEIOS_BRIDGE_CONFIG__=${config};</script><script>${escapeInlineScript(BRIDGE_BROWSER_BUNDLE)}</script>`;
}

export function registerBridgeListenerResource(
  server: McpServer,
  options: BridgeListenerResourceOptions = {},
): void {
  registerAppResource(
    server,
    "LeileiOS Message Bridge",
    BRIDGE_RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE, _meta: BRIDGE_RESOURCE_META },
    async () => ({ contents: [{ uri: BRIDGE_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: createBridgeListenerHtml(options), _meta: BRIDGE_RESOURCE_META }] }),
  );
}
