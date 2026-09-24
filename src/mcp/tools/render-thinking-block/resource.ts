import { readFileSync } from "node:fs";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const RENDER_NOTE_CARD_RESOURCE_URI =
  "ui://widget/leileios-note-card-v1.html";
export const CHATGPT_RENDER_NOTE_CARD_RESOURCE_URI =
  "ui://widget/leileios-note-card-chatgpt-v1.html";

const NOTE_CARD_BROWSER_BUNDLE = readFileSync(
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
  "openai/widgetDescription": "LeileiOS 用户可见笔记卡片。",
};

export function createNoteCardHtml(): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LeileiOS Note Card</title><style>
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
[data-note-card] { overflow: clip; padding: 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--card-background); }
[data-note-header] { display: flex; align-items: center; gap: 10px; }
[data-note-title] { flex: 1; min-width: 0; color: var(--main-text); font-weight: 650; letter-spacing: .01em; }
[data-note-meta] { margin: 4px 0 14px; color: var(--secondary-text); font-size: 12px; }
[data-note-toggle] { flex: 0 0 auto; border: 0; padding: 0; color: var(--secondary-text); background: transparent; cursor: pointer; font: inherit; font-size: 12px; }
[data-note-toggle]:focus-visible { outline: 2px solid var(--secondary-text); outline-offset: 2px; }
[data-note-content] { margin: 0; padding: 0; color: var(--main-text); white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; }
[data-note-content][data-scrollable="true"] { overscroll-behavior: contain; }
[data-note-card][data-collapsed="true"] [data-note-content] { display: none; }
button { -webkit-tap-highlight-color: transparent; }
</style><main data-note-card aria-label="LeileiOS 用户可见笔记卡片">
  <header data-note-header>
    <div data-note-title>Note</div>
    <button type="button" data-note-toggle aria-expanded="true">折叠</button>
  </header>
  <div data-note-meta aria-label="笔记卡片设置"></div>
  <section data-note-content aria-live="polite"></section>
</main><script>${escapeInlineScript(NOTE_CARD_BROWSER_BUNDLE)}</script>`;
}

export function registerNoteCardResource(server: McpServer): void {
  for (const resourceUri of [
    RENDER_NOTE_CARD_RESOURCE_URI,
    CHATGPT_RENDER_NOTE_CARD_RESOURCE_URI,
  ]) {
    registerAppResource(
      server,
      "LeileiOS Note Card",
      resourceUri,
      { mimeType: RESOURCE_MIME_TYPE, _meta: RESOURCE_META },
      async () => ({
        contents: [{
          uri: resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: createNoteCardHtml(),
          _meta: RESOURCE_META,
        }],
      }),
    );
  }
}
