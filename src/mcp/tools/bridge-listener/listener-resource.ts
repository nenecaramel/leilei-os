import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const BRIDGE_RESOURCE_URI = "ui://leileios/message-bridge/v1";

export function createBridgeListenerHtml(): string {
  return `<!doctype html><meta charset="utf-8"><title>LeileiOS Message Bridge</title><style>
  :root { color-scheme: light; font: 14px system-ui, sans-serif; }
  body { margin: 0; padding: 16px; color: #333; background: #fff; }
  h1 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
  [data-bridge-status] { margin: 0 0 12px; color: #666; }
  [data-bridge-occupied] { margin: 0 0 12px; color: #777; }
  button { margin-right: 8px; padding: 6px 10px; border: 1px solid #bbb; border-radius: 5px; background: #fff; color: #333; cursor: pointer; }
  button:disabled { cursor: default; opacity: .55; }
</style><main aria-label="LeileiOS Message Bridge">
  <h1>LeileiOS Message Bridge</h1>
  <p data-bridge-status role="status">Idle</p>
  <p data-bridge-occupied hidden>Another listener is already active.</p>
  <button type="button" data-bridge-start>Start</button>
  <button type="button" data-bridge-stop disabled>Stop</button>
</main><script>
(() => {
  const POLL_MS = 10000, RENEW_MS = 30000, TIMEOUT_MS = 18000;
  const pending = new Map(); let nextId = 1, running = false, starting = false, syncing = false, eventInFlight = null, pollTimer = null, renewTimer = null;
  const startButton = document.querySelector('[data-bridge-start]');
  const stopButton = document.querySelector('[data-bridge-stop]');
  const statusNode = document.querySelector('[data-bridge-status]');
  const occupiedNode = document.querySelector('[data-bridge-occupied]');
  const setUiState = (state) => {
    const labels = { idle: 'Idle', starting: 'Starting', running: 'Running', occupied: 'Occupied' };
    if (statusNode) statusNode.textContent = labels[state] || labels.idle;
    if (occupiedNode) occupiedNode.hidden = state !== 'occupied';
    if (startButton) startButton.disabled = state === 'starting' || state === 'running';
    if (stopButton) stopButton.disabled = state !== 'running';
  };
  const call = (method, params, timeout = TIMEOUT_MS) => new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, {resolve, reject});
    window.parent.postMessage({jsonrpc:'2.0', id, method, params}, '*');
    setTimeout(() => { if (pending.delete(id)) reject(Object.assign(new Error('timeout'), {ambiguous: method === 'ui/message'})); }, timeout);
  });
  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const msg = event.data;
    if (!msg || msg.jsonrpc !== '2.0' || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(msg.error) : p.resolve(msg.result);
  });
  const appCall = async (name, args) => {
    const result = await call('tools/call', {name, arguments: args || {}});
    const structured = result && result.structuredContent;
    if (!result || result.isError === true || !structured || structured.success !== true) {
      const code = structured && structured.error && structured.error.code;
      throw Object.assign(new Error('Bridge tool call failed'), {code: code || 'BRIDGE_UNAVAILABLE'});
    }
    return result;
  };
  const report = (name, args) => appCall(name, args).catch(() => undefined);
  const schedulePoll = () => { if (running && !pollTimer) pollTimer = setTimeout(() => { pollTimer = null; void sync(); }, POLL_MS); };
  const sync = async () => {
    if (!running || syncing) return; syncing = true;
    try {
      const result = await appCall('bridge_listener_sync');
      const event = result && result._meta && result._meta.bridgeEvent;
      if (!event || eventInFlight) { schedulePoll(); return; }
      eventInFlight = event;
      try {
        await call('ui/update-model-context', {content:[{type:'text', text:event.modelContext || ''}]});
      } catch (_) { await report('bridge_listener_release', {eventId:event.id, safeErrorCode:'CONTEXT_UPDATE_FAILED'}); eventInFlight = null; schedulePoll(); return; }
      try {
        await appCall('bridge_listener_dispatch_started', {eventId:event.id});
      } catch (error) {
        if (!error || !error.ambiguous) await report('bridge_listener_release', {eventId:event.id, safeErrorCode:'DISPATCH_START_FAILED'});
        eventInFlight = null; schedulePoll(); return;
      }
      try {
        const messageResult = await call('ui/message', {role:'user', content:[{type:'text', text:'@LeileiOS ' + event.visibleText}]});
        if (messageResult && messageResult.isError === true) throw Object.assign(new Error('Host rejected ui/message'), {ambiguous:false});
        if (messageResult == null) throw Object.assign(new Error('Host ui/message outcome was ambiguous'), {ambiguous:true});
      } catch (error) {
        if (error && error.ambiguous) await report('bridge_listener_delivery_unknown', {eventId:event.id, safeErrorCode:'UI_MESSAGE_AMBIGUOUS'});
        else await report('bridge_listener_release', {eventId:event.id, safeErrorCode:'UI_MESSAGE_REJECTED'});
        eventInFlight = null; schedulePoll(); return;
      }
      await report('bridge_listener_delivered', {eventId:event.id});
      eventInFlight = null; schedulePoll();
    } catch (_) { schedulePoll(); } finally { syncing = false; }
  };
  const start = async () => {
    if (running || starting) return;
    starting = true; setUiState('starting');
    try {
      await appCall('bridge_listener_start');
      running = true; starting = false; setUiState('running');
      renewTimer = setInterval(() => { void appCall('bridge_listener_start').catch(() => undefined); }, RENEW_MS); if (renewTimer.unref) renewTimer.unref();
      await sync();
    } catch (error) {
      running = false; starting = false; setUiState(error && error.code === 'LISTENER_BUSY' ? 'occupied' : 'idle');
      throw error;
    }
  };
  const stop = async () => {
    if (!running && !starting) return;
    running = false; starting = false; setUiState('idle');
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (renewTimer) { clearInterval(renewTimer); renewTimer = null; }
    await report('bridge_listener_stop');
  };
  if (startButton) startButton.addEventListener('click', () => { void start().catch(() => undefined); });
  if (stopButton) stopButton.addEventListener('click', () => { void stop(); });
  window.addEventListener('focus', () => { if (running) { void appCall('bridge_listener_start').then(sync).catch(() => undefined); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && running) { void appCall('bridge_listener_start').then(sync).catch(() => undefined); } });
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
