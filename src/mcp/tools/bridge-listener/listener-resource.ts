import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const BRIDGE_RESOURCE_URI = "ui://leileios/message-bridge/v1";

export function createBridgeListenerHtml(): string {
  return `<!doctype html><meta charset="utf-8"><title>LeileiOS Message Bridge</title><script>
(() => {
  const POLL_MS = 10000, RENEW_MS = 30000, TIMEOUT_MS = 18000;
  const pending = new Map(); let nextId = 1, running = false, syncing = false, eventInFlight = null, pollTimer = null, renewTimer = null;
  const call = (method, params, timeout = TIMEOUT_MS) => new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, {resolve, reject});
    window.parent.postMessage({jsonrpc:"2.0", id, method, params}, "*");
    setTimeout(() => { if (pending.delete(id)) reject(Object.assign(new Error("timeout"), {ambiguous: method === "ui/message"})); }, timeout);
  });
  window.addEventListener("message", event => { const msg = event.data; if (!msg || !pending.has(msg.id)) return; const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(msg.error) : p.resolve(msg.result); });
  const appCall = (name, args) => call("tools/call", {name, arguments: args || {}});
  const report = (name, args) => appCall(name, args).catch(() => undefined);
  const schedulePoll = () => { if (running && !pollTimer) pollTimer = setTimeout(() => { pollTimer = null; sync(); }, POLL_MS); };
  const sync = async () => {
    if (!running || syncing) return; syncing = true;
    try {
      const result = await appCall("bridge_listener_sync");
      const event = result && result._meta && result._meta.bridgeEvent;
      if (!event || eventInFlight) { schedulePoll(); return; }
      eventInFlight = event;
      try {
        await call("ui/update-model-context", {content:[{type:"text", text:event.modelContext || ""}]});
      } catch (_) { await report("bridge_listener_release", {eventId:event.id, safeErrorCode:"CONTEXT_UPDATE_FAILED"}); eventInFlight = null; schedulePoll(); return; }
      try { await appCall("bridge_listener_dispatch_started", {eventId:event.id}); } catch (_) { eventInFlight = null; return; }
      try {
        await call("ui/message", {content:[{type:"text", text:"@LeileiOS " + event.visibleText}]});
      } catch (error) {
        if (error && error.ambiguous) await report("bridge_listener_delivery_unknown", {eventId:event.id, safeErrorCode:"UI_MESSAGE_AMBIGUOUS"});
        else await report("bridge_listener_release", {eventId:event.id, safeErrorCode:"UI_MESSAGE_REJECTED"});
        eventInFlight = null; schedulePoll(); return;
      }
      await report("bridge_listener_delivered", {eventId:event.id});
      eventInFlight = null; schedulePoll();
    } catch (_) { schedulePoll(); } finally { syncing = false; }
  };
  const start = async () => { if (running) return; await appCall("bridge_listener_start"); running = true; renewTimer = setInterval(() => { void appCall("bridge_listener_start").catch(() => undefined); }, RENEW_MS); if (renewTimer.unref) renewTimer.unref(); await sync(); };
  const stop = async () => { if (!running) return; running = false; if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } if (renewTimer) { clearInterval(renewTimer); renewTimer = null; } await report("bridge_listener_stop"); };
  window.addEventListener("focus", () => { if (running) { void appCall("bridge_listener_start").then(sync).catch(() => undefined); } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && running) { void appCall("bridge_listener_start").then(sync).catch(() => undefined); } });
  window.bridgeListener = {call, start, stop, sync};
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
