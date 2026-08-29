import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeEventRecord } from "../../../domains/bridge/bridge-event-types.js";

export const BRIDGE_RESOURCE_URI = "ui://leileios/message-bridge/v2";

export function composeBridgeDispatchContext(
  event: Pick<BridgeEventRecord, "id" | "modelContext">,
): string {
  return `${event.modelContext}\n\nEvent ID: ${event.id}. Call bridge_event_claim(eventId) before handling this event; call bridge_event_complete(eventId) after requested processing/tool work and before the final assistant response.`;
}

export function createBridgeListenerHtml(): string {
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
</main><script>
(() => {
  const POLL_MS = 10000, RENEW_MS = 30000, TIMEOUT_MS = 18000, PROTOCOL_VERSION = '2026-01-26', DIAG_LIMIT = 24;
  const listenerInstanceId = crypto.randomUUID();
  const pending = new Map(); const diagLines = []; let nextId = 1, initialized = false, initializePromise = null, running = false, starting = false, syncing = false, eventInFlight = null, pollTimer = null, renewTimer = null;
  const startButton = document.querySelector('[data-bridge-start]');
  const stopButton = document.querySelector('[data-bridge-stop]');
  const syncButton = document.querySelector('[data-bridge-sync]');
  const statusNode = document.querySelector('[data-bridge-status]');
  const occupiedNode = document.querySelector('[data-bridge-occupied]');
  const diagNode = document.querySelector('[data-bridge-diag]');
  const recordDiag = (message) => {
    const stamp = new Date().toISOString().slice(11, 23);
    diagLines.push(stamp + ' ' + String(message));
    while (diagLines.length > DIAG_LIMIT) diagLines.shift();
    if (diagNode) { diagNode.textContent = diagLines.join('\\n'); diagNode.scrollTop = diagNode.scrollHeight; }
  };
  const errorSummary = (error) => {
    if (!error) return 'unknown';
    const code = typeof error.code === 'string' || typeof error.code === 'number' ? String(error.code) : '';
    const rawMessage = typeof error.message === 'string' ? error.message : typeof error === 'string' ? error : '';
    const message = rawMessage.replace(/\\s+/g, ' ').slice(0, 120);
    return (code ? 'code=' + code : '') + (code && message ? ' ' : '') + (message || (!code ? 'unknown' : ''));
  };
  const setUiState = (state) => {
    const labels = { idle: 'Idle', starting: 'Starting', running: 'Running', occupied: 'Occupied', unavailable: 'Host init failed' };
    if (statusNode) statusNode.textContent = labels[state] || labels.idle;
    if (occupiedNode) occupiedNode.hidden = state !== 'occupied';
    if (startButton) startButton.disabled = state === 'starting' || state === 'running';
    if (stopButton) stopButton.disabled = state !== 'running';
    if (syncButton) syncButton.disabled = state !== 'running';
  };
  const callLabel = (method, params) => method === 'tools/call' && params && typeof params.name === 'string' ? params.name : method;
  const call = (method, params, timeout = TIMEOUT_MS) => new Promise((resolve, reject) => {
    const id = nextId++; const label = callLabel(method, params); pending.set(id, {resolve, reject, label});
    recordDiag(label + ' sent id=' + id);
    window.parent.postMessage({jsonrpc:'2.0', id, method, params}, '*');
    setTimeout(() => {
      if (!pending.delete(id)) return;
      recordDiag(label + ' timeout id=' + id);
      reject(Object.assign(new Error('timeout'), {ambiguous: method === 'ui/message'}));
    }, timeout);
  });
  const notify = (method, params) => {
    const message = {jsonrpc:'2.0', method};
    if (params !== undefined) message.params = params;
    recordDiag(method + ' notify');
    window.parent.postMessage(message, '*');
  };
  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const msg = event.data;
    if (!msg || msg.jsonrpc !== '2.0' || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) {
      recordDiag(p.label + ' error id=' + msg.id + ' ' + errorSummary(msg.error));
      p.reject(msg.error);
    } else {
      recordDiag(p.label + ' response id=' + msg.id);
      p.resolve(msg.result);
    }
  });
  const initializeHost = async () => {
    if (initialized) { recordDiag('ui/initialize already ready'); return; }
    if (initializePromise) { recordDiag('ui/initialize await existing'); return initializePromise; }
    recordDiag('ui/initialize enter');
    initializePromise = (async () => {
      try {
        const result = await call('ui/initialize', {
          appInfo: {name:'LeileiOS Message Bridge', version:'1.0.0'},
          appCapabilities: {},
          protocolVersion: PROTOCOL_VERSION,
        });
        if (!result || typeof result.protocolVersion !== 'string') throw new Error('Invalid ui/initialize result');
        notify('ui/notifications/initialized');
        initialized = true;
        recordDiag('ui/initialize success');
      } catch (error) {
        recordDiag('ui/initialize failed ' + errorSummary(error));
        throw Object.assign(new Error('MCP Apps initialization failed'), {code:'HOST_INIT_FAILED', cause:error});
      } finally {
        initializePromise = null;
      }
    })();
    return initializePromise;
  };
  const appCall = async (name, args) => {
    const bridgeArgs = {listenerInstanceId, ...(args || {})};
    const result = await call('tools/call', {name, arguments: bridgeArgs});
    const structured = result && result.structuredContent;
    if (!result || result.isError === true || !structured || structured.success !== true) {
      const code = structured && structured.error && structured.error.code;
      const error = Object.assign(new Error('Bridge tool call failed'), {code: code || 'BRIDGE_UNAVAILABLE'});
      recordDiag(name + ' semantic error ' + errorSummary(error));
      throw error;
    }
    return result;
  };
  const report = (name, args) => appCall(name, args).catch((error) => { recordDiag(name + ' report failed ' + errorSummary(error)); return undefined; });
  const schedulePoll = () => {
    if (running && !pollTimer) pollTimer = setTimeout(() => { pollTimer = null; void sync('poll'); }, POLL_MS);
  };
  const sync = async (source = 'auto') => {
    recordDiag('sync enter source=' + source + ' running=' + running + ' syncing=' + syncing);
    if (!running) { recordDiag('sync skipped not-running'); return; }
    if (syncing) { recordDiag('sync skipped already-running'); return; }
    syncing = true;
    try {
      const result = await appCall('bridge_listener_sync');
      recordDiag('sync tool success source=' + source);
      const event = result && result._meta && result._meta.bridgeEvent;
      if (!event || eventInFlight) { schedulePoll(); return; }
      eventInFlight = event;
      try {
        await call('ui/update-model-context', {content:[{type:'text', text:(event.modelContext || '') + '\\n\\nEvent ID: ' + event.id + '. Call bridge_event_claim(eventId) before handling this event; call bridge_event_complete(eventId) after requested processing/tool work and before the final assistant response.'}]});
      } catch (error) { recordDiag('context update failed ' + errorSummary(error)); await report('bridge_listener_release', {eventId:event.id, safeErrorCode:'CONTEXT_UPDATE_FAILED'}); eventInFlight = null; schedulePoll(); return; }
      try {
        await appCall('bridge_listener_dispatch_started', {eventId:event.id});
      } catch (error) {
        recordDiag('dispatch start failed ' + errorSummary(error));
        if (!error || !error.ambiguous) await report('bridge_listener_release', {eventId:event.id, safeErrorCode:'DISPATCH_START_FAILED'});
        eventInFlight = null; schedulePoll(); return;
      }
      try {
        const messageResult = await call('ui/message', {role:'user', content:[{type:'text', text:'@LeileiOS ' + event.visibleText}]});
        if (messageResult && messageResult.isError === true) throw Object.assign(new Error('Host rejected ui/message'), {ambiguous:false});
        if (messageResult == null) throw Object.assign(new Error('Host ui/message outcome was ambiguous'), {ambiguous:true});
      } catch (error) {
        recordDiag('ui/message failed ' + errorSummary(error));
        if (error && error.ambiguous) await report('bridge_listener_delivery_unknown', {eventId:event.id, safeErrorCode:'UI_MESSAGE_AMBIGUOUS'});
        else await report('bridge_listener_release', {eventId:event.id, safeErrorCode:'UI_MESSAGE_REJECTED'});
        eventInFlight = null; schedulePoll(); return;
      }
      await report('bridge_listener_delivered', {eventId:event.id});
      eventInFlight = null; schedulePoll();
    } catch (error) {
      recordDiag('sync failed source=' + source + ' ' + errorSummary(error));
      schedulePoll();
    } finally { syncing = false; }
  };
  const renew = async (source) => {
    recordDiag('renew tick source=' + source);
    try {
      await appCall('bridge_listener_start');
      recordDiag('renew success source=' + source);
      await sync(source);
    } catch (error) { recordDiag('renew failed source=' + source + ' ' + errorSummary(error)); }
  };
  const start = async () => {
    recordDiag('start enter running=' + running + ' starting=' + starting);
    if (running || starting) return;
    starting = true; setUiState('starting');
    try {
      await initializeHost();
      await appCall('bridge_listener_start');
      recordDiag('start success');
      running = true; starting = false; setUiState('running');
      renewTimer = setInterval(() => { void renew('timer'); }, RENEW_MS); if (renewTimer.unref) renewTimer.unref();
      await sync('start');
    } catch (error) {
      recordDiag('start failed ' + errorSummary(error));
      running = false; starting = false; setUiState(error && error.code === 'LISTENER_BUSY' ? 'occupied' : error && error.code === 'HOST_INIT_FAILED' ? 'unavailable' : 'idle');
      throw error;
    }
  };
  const stop = async () => {
    recordDiag('stop enter');
    if (!running && !starting) return;
    running = false; starting = false; setUiState('idle');
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (renewTimer) { clearInterval(renewTimer); renewTimer = null; }
    await report('bridge_listener_stop');
    recordDiag('stop complete');
  };
  if (startButton) startButton.addEventListener('click', () => { void start().catch(() => undefined); });
  if (stopButton) stopButton.addEventListener('click', () => { void stop(); });
  if (syncButton) syncButton.addEventListener('click', () => { void sync('manual'); });
  window.addEventListener('focus', () => { if (running) { recordDiag('focus resume'); void renew('focus'); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && running) { recordDiag('visibility resume'); void renew('visibility'); } });
  recordDiag('iframe ready');
  window.bridgeListener = {call, initializeHost, start, stop, sync, diagnostics: () => diagLines.slice()};
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
