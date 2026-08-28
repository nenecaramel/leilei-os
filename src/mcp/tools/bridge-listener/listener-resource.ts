import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const BRIDGE_RESOURCE_URI = "ui://leileios/message-bridge/v1";

export function createBridgeListenerHtml(): string {
  return `<!doctype html><meta charset="utf-8"><title>LeileiOS Message Bridge</title><script>
(() => {
  const pending = new Map(); let nextId = 1;
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, {resolve, reject});
    window.parent.postMessage({jsonrpc:"2.0", id, method, params}, "*");
    setTimeout(() => { if (pending.delete(id)) reject(new Error("timeout")); }, 18000);
  });
  window.addEventListener("message", event => { const msg = event.data; if (!msg || !pending.has(msg.id)) return; const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(msg.error) : p.resolve(msg.result); });
  window.bridgeListener = { call };
})();</script>`;
}

export function registerBridgeListenerResource(server: McpServer): void {
  registerAppResource(
    server,
    "LeileiOS Message Bridge",
    BRIDGE_RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } },
    async () => ({ contents: [{ uri: BRIDGE_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: createBridgeListenerHtml(), _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }] }),
  );
}
