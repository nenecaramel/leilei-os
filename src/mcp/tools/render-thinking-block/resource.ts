import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const RENDER_THINKING_BLOCK_RESOURCE_URI =
  "ui://widget/leileios-thinking-block-v1.html";

const RESOURCE_META = {
  ui: {
    csp: { connectDomains: [], resourceDomains: [] },
    prefersBorder: true,
  },
  "openai/widgetPrefersBorder": true,
  "openai/widgetDescription": "LeileiOS 外置工作文本思考卡片。",
};

export function createRenderThinkingBlockHtml(): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LeileiOS Thinking Block</title><style>
:root {
  color-scheme: light dark;
  font: 14px/1.6 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --paper: #f5efe5;
  --paper-deep: #e8ddcd;
  --ink: #2d332d;
  --muted: #6d756d;
  --line: #cfd5c8;
  --accent: #688273;
  --accent-soft: #dbe6da;
  --glow: #f6f8f6;
  --shadow: rgba(58, 72, 60, .14);
}
:root[data-skin="microglow"] {
  --paper: #edf5f8;
  --paper-deep: #dbe9f1;
  --ink: #273340;
  --muted: #687a8a;
  --line: #c8d9e4;
  --accent: #5f93aa;
  --accent-soft: #d9edf2;
  --glow: #fbfdff;
  --shadow: rgba(70, 117, 145, .16);
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] {
  color-scheme: dark;
  --paper: #202923;
  --paper-deep: #2a352d;
  --ink: #e9eee8;
  --muted: #b1beb2;
  --line: #4a5a4e;
  --accent: #a6c4ae;
  --accent-soft: #3b5142;
  --glow: #253029;
  --shadow: rgba(0, 0, 0, .28);
}
:root[data-theme="dark"][data-skin="microglow"] {
  --paper: #202b34;
  --paper-deep: #2b3a47;
  --ink: #ecf5f8;
  --muted: #b4c8d1;
  --line: #49616d;
  --accent: #a9dbea;
  --accent-soft: #304c59;
  --glow: #26343e;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #202923; --paper-deep: #2a352d; --ink: #e9eee8; --muted: #b1beb2;
    --line: #4a5a4e; --accent: #a6c4ae; --accent-soft: #3b5142; --glow: #253029; --shadow: rgba(0,0,0,.28);
  }
  :root:not([data-theme="light"])[data-skin="microglow"] {
    --paper: #202b34; --paper-deep: #2b3a47; --ink: #ecf5f8; --muted: #b4c8d1;
    --line: #49616d; --accent: #a9dbea; --accent-soft: #304c59; --glow: #26343e;
  }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 12px; color: var(--ink); background: var(--paper); }
[data-thinking-card] { overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: linear-gradient(145deg, var(--glow), var(--paper)); box-shadow: 0 8px 24px var(--shadow); }
[data-thinking-header] { display: flex; align-items: center; gap: 10px; padding: 12px 14px 10px; background: linear-gradient(110deg, var(--paper-deep), transparent); }
[data-thinking-title] { flex: 1; min-width: 0; font-weight: 650; letter-spacing: .01em; }
[data-thinking-subtitle] { color: var(--muted); font-size: 11px; }
[data-thinking-badges] { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 14px 10px; }
[data-thinking-badge] { padding: 2px 7px; border: 1px solid var(--line); border-radius: 999px; color: var(--accent); background: var(--accent-soft); font-size: 11px; }
[data-thinking-toggle] { flex: 0 0 auto; border: 1px solid var(--line); border-radius: 999px; padding: 4px 9px; color: var(--ink); background: transparent; cursor: pointer; font: inherit; font-size: 12px; }
[data-thinking-toggle]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
[data-thinking-content] { margin: 0 14px 14px; padding: 12px; border: 1px solid var(--line); border-radius: 11px; color: var(--ink); background: color-mix(in srgb, var(--glow) 84%, transparent); white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; }
[data-thinking-content][data-scrollable="true"] { overscroll-behavior: contain; }
[data-thinking-card][data-collapsed="true"] [data-thinking-content] { display: none; }
[data-thinking-card][data-collapsed="true"] [data-thinking-toggle] { color: var(--accent); }
button { -webkit-tap-highlight-color: transparent; }
</style><main data-thinking-card aria-label="LeileiOS 外置工作文本思考卡片">
  <header data-thinking-header>
    <div data-thinking-title>Thinking block<div data-thinking-subtitle>本轮外置工作文本</div></div>
    <button type="button" data-thinking-toggle aria-expanded="true">折叠</button>
  </header>
  <div data-thinking-badges aria-label="思考块设置">
    <span data-thinking-badge data-style-badge></span>
    <span data-thinking-badge data-effort-badge></span>
    <span data-thinking-badge data-skin-badge></span>
  </div>
  <section data-thinking-content aria-live="polite"></section>
</main><script>
(() => {
  const card = document.querySelector('[data-thinking-card]');
  const content = document.querySelector('[data-thinking-content]');
  const toggle = document.querySelector('[data-thinking-toggle]');
  const styleBadge = document.querySelector('[data-style-badge]');
  const effortBadge = document.querySelector('[data-effort-badge]');
  const skinBadge = document.querySelector('[data-skin-badge]');
  let collapsed = false;
  let heightFrame = 0;
  let lastMeasuredHeight = -1;
  let mergedGlobals = {};

  const objectOrEmpty = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const resultMetadata = (api) => {
    const response = objectOrEmpty(api.toolResponseMetadata || api.toolResultMetadata);
    const output = objectOrEmpty(api.toolOutput || api.toolResult);
    const candidates = [
      objectOrEmpty(response.mcp_tool_result)._meta,
      objectOrEmpty(response.call_tool_result)._meta,
      response._meta,
      response,
      objectOrEmpty(output)._meta,
      api._meta,
      output,
    ];
    return candidates.filter((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate));
  };
  const stringValue = (source, key) => typeof source[key] === 'string' ? source[key] : '';
  const pick = (sources, key, fallback) => {
    for (const source of sources) {
      const value = stringValue(source, key);
      if (value) return value;
    }
    return fallback;
  };
  const requestIntrinsicHeight = (force = false) => {
    const host = objectOrEmpty(mergedGlobals);
    if (typeof host.notifyIntrinsicHeight !== 'function') return;
    if (heightFrame) window.cancelAnimationFrame(heightFrame);
    heightFrame = window.requestAnimationFrame(() => {
      const measuredHeight = Math.ceil(document.documentElement.scrollHeight);
      if (!force && measuredHeight === lastMeasuredHeight) return;
      lastMeasuredHeight = measuredHeight;
      try { host.notifyIntrinsicHeight(); } catch (_) {}
    });
  };
  const applyHostHeightLimit = (api) => {
    const maxHeight = Number(api.maxHeight);
    if (!Number.isFinite(maxHeight) || maxHeight <= 0) {
      content.style.maxHeight = '';
      delete content.dataset.scrollable;
      return;
    }
    const chromeHeight = toggle.getBoundingClientRect().height + 58;
    content.style.maxHeight = Math.max(180, Math.floor(maxHeight - chromeHeight)) + 'px';
    content.dataset.scrollable = 'true';
  };
  const setCollapsed = (value) => {
    collapsed = Boolean(value);
    card.dataset.collapsed = collapsed ? 'true' : 'false';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = collapsed ? '展开' : '折叠';
    requestIntrinsicHeight(true);
  };
  const render = (event) => {
    const bridge = objectOrEmpty(window.openai);
    const eventGlobals = objectOrEmpty(event && event.detail && event.detail.globals);
    const previousGlobals = mergedGlobals;
    mergedGlobals = Object.assign({}, previousGlobals, bridge, eventGlobals);
    for (const key of ['toolInput', 'toolOutput', 'toolResult', 'toolResponseMetadata', 'toolResultMetadata']) {
      const nested = Object.assign({}, objectOrEmpty(bridge[key]), objectOrEmpty(previousGlobals[key]), objectOrEmpty(eventGlobals[key]));
      if (Object.keys(nested).length > 0) mergedGlobals[key] = nested;
    }
    const api = mergedGlobals;
    const input = objectOrEmpty(api.toolInput);
    const output = objectOrEmpty(api.toolOutput || api.toolResult);
    const metadataSources = resultMetadata(api);
    const sources = [...metadataSources, input, output];
    const style = pick(sources, 'style', 'deep_think');
    const effort = pick(sources, 'effort', '');
    const skin = pick(sources, 'skin', 'botanical');
    const thinking = pick(sources, 'thinking', '本轮没有提供外置工作文本。');
    if (style === 'relational' || style === 'deep_think') styleBadge.textContent = style;
    else styleBadge.textContent = 'deep_think';
    effortBadge.textContent = effort ? 'effort: ' + effort : 'effort';
    document.documentElement.dataset.skin = skin === 'microglow' ? 'microglow' : 'botanical';
    skinBadge.textContent = document.documentElement.dataset.skin;
    content.textContent = thinking;
    if (api.theme === 'light' || api.theme === 'dark') document.documentElement.dataset.theme = api.theme;
    applyHostHeightLimit(api);
    requestIntrinsicHeight(true);
  };
  toggle.addEventListener('click', () => setCollapsed(!collapsed));
  window.addEventListener('openai:set_globals', render);
  if (typeof window.ResizeObserver === 'function') new window.ResizeObserver(() => requestIntrinsicHeight()).observe(document.body);
  render();
  window.thinkingBlock = { render, setCollapsed };
})();</script>`;
}

export function registerRenderThinkingBlockResource(server: McpServer): void {
  registerAppResource(
    server,
    "LeileiOS Thinking Block",
    RENDER_THINKING_BLOCK_RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE, _meta: RESOURCE_META },
    async () => ({
      contents: [{
        uri: RENDER_THINKING_BLOCK_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: createRenderThinkingBlockHtml(),
        _meta: RESOURCE_META,
      }],
    }),
  );
}
