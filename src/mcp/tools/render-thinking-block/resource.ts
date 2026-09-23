import { readFileSync } from "node:fs";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const RENDER_WORKING_NOTE_RESOURCE_URI =
  "ui://widget/leileios-working-note-v1.html";
export const CHATGPT_RENDER_WORKING_NOTE_RESOURCE_URI =
  "ui://widget/leileios-working-note-chatgpt-v1.html";

export const RENDER_THINKING_BLOCK_RESOURCE_URI =
  "ui://widget/leileios-thinking-block-v3.html";
export const CHATGPT_RENDER_THINKING_BLOCK_RESOURCE_URI =
  "ui://widget/leileios-thinking-block-chatgpt-v3.html";

const LEGACY_RENDER_THINKING_BLOCK_RESOURCE_URIS = [
  "ui://widget/leileios-thinking-block-v2.html",
  "ui://widget/leileios-thinking-block-v1.html",
] as const;

const THINKING_BLOCK_BROWSER_BUNDLE = readFileSync(
  new URL("./browser-runtime.js", import.meta.url),
  "utf8",
);

function escapeInlineScript(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}

const RESOURCE_META = {
  ui: {
    csp: { connectDomains: [], resourceDomains: [] },
    prefersBorder: true,
  },
  "openai/widgetPrefersBorder": true,
  "openai/widgetDescription": "LeileiOS 用户可见工作笔记卡片。",
};

export function createWorkingNoteHtml(): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LeileiOS Working Note</title><style>
:root {
  color-scheme: light dark;
  font: 14px/1.6 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --card-background: #FCFCFC;
  --main-text: #181818;
  --secondary-text: #777777;
  --border: #DDDDDD;
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] {
  color-scheme: dark;
  --card-background: #191919;
  --main-text: #F0F0F0;
  --secondary-text: #A0A0A0;
  --border: #383838;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --card-background: #191919;
    --main-text: #F0F0F0;
    --secondary-text: #A0A0A0;
    --border: #383838;
  }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 12px; color: var(--main-text); }
[data-thinking-card] { overflow: hidden; padding: 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--card-background); }
[data-thinking-header] { display: flex; align-items: center; gap: 10px; }
[data-thinking-title] { flex: 1; min-width: 0; color: var(--main-text); font-weight: 650; letter-spacing: .01em; }
[data-thinking-meta] { margin: 4px 0 14px; color: var(--secondary-text); font-size: 12px; }
[data-thinking-toggle] { flex: 0 0 auto; border: 0; padding: 0; color: var(--secondary-text); background: transparent; cursor: pointer; font: inherit; font-size: 12px; }
[data-thinking-toggle]:focus-visible { outline: 2px solid var(--secondary-text); outline-offset: 2px; }
[data-thinking-content] { margin: 0; padding: 0; color: var(--main-text); white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; }
[data-thinking-content][data-scrollable="true"] { overscroll-behavior: contain; }
[data-thinking-card][data-collapsed="true"] [data-thinking-content] { display: none; }
button { -webkit-tap-highlight-color: transparent; }
</style><main data-thinking-card aria-label="LeileiOS 用户可见工作笔记卡片">
  <header data-thinking-header>
    <div data-thinking-title>Working Note</div>
    <button type="button" data-thinking-toggle aria-expanded="true">折叠</button>
  </header>
  <div data-thinking-meta aria-label="工作笔记设置"></div>
  <section data-thinking-content aria-live="polite"></section>
</main><script>${escapeInlineScript(THINKING_BLOCK_BROWSER_BUNDLE)}</script>`;
}

export function createRenderThinkingBlockHtml(): string {
  return createWorkingNoteHtml();
}

export function registerWorkingNoteResource(server: McpServer): void {
  for (const resourceUri of [
    RENDER_WORKING_NOTE_RESOURCE_URI,
    CHATGPT_RENDER_WORKING_NOTE_RESOURCE_URI,
    RENDER_THINKING_BLOCK_RESOURCE_URI,
    CHATGPT_RENDER_THINKING_BLOCK_RESOURCE_URI,
    ...LEGACY_RENDER_THINKING_BLOCK_RESOURCE_URIS,
  ]) {
    registerAppResource(
      server,
      "LeileiOS Working Note",
      resourceUri,
      { mimeType: RESOURCE_MIME_TYPE, _meta: RESOURCE_META },
      async () => ({
        contents: [{
          uri: resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: createWorkingNoteHtml(),
          _meta: RESOURCE_META,
        }],
      }),
    );
  }
}


export function registerRenderThinkingBlockResource(server: McpServer): void {
  registerWorkingNoteResource(server);
}
