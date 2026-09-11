import { readFileSync } from "node:fs";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SHARED_PAPER_APP_RESOURCE_URI = "ui://leileios/shared-paper/v1";
export const CHATGPT_SHARED_PAPER_APP_RESOURCE_URI = "ui://widget/leileios-shared-paper-v1.html";

const BROWSER_BUNDLE = readFileSync(new URL("./browser-runtime.js", import.meta.url), "utf8");

const RESOURCE_META = {
  ui: {
    csp: {
      connectDomains: [],
      resourceDomains: [],
    },
    prefersBorder: true,
  },
  "openai/widgetPrefersBorder": true,
  "openai/widgetDescription": "LeileiOS Shared Paper editor.",
} as const;

function escapeInlineScript(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}

export function createSharedPaperAppHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shared Paper</title><style>
:root {
  color-scheme: light dark;
  font: 14px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --paper:#fffdf8; --ink:#26231f; --muted:#817b70; --line:#ddd7cc; --panel:#f7f3eb; --danger:#9b2c2c;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --paper:#1c1b18; --ink:#f2eee6; --muted:#aaa397; --line:#403c35; --panel:#25231f; --danger:#ff8a8a;
}
* { box-sizing:border-box; }
body { margin:0; padding:12px; background:transparent; color:var(--ink); }
button,input,textarea { font:inherit; color:inherit; }
button { border:0; background:transparent; cursor:pointer; }
button:disabled { opacity:.5; cursor:default; }
[data-shared-paper-app] { border:1px solid var(--line); border-radius:14px; overflow:hidden; background:var(--paper); min-height:360px; }
[data-paper-header] { display:flex; gap:8px; align-items:center; padding:12px 14px; border-bottom:1px solid var(--line); }
[data-paper-title] { font-weight:700; flex:1; }
[data-paper-scope],[data-paper-close-history] { color:var(--muted); }
[data-paper-search] { width:100%; padding:9px 12px; border:0; border-bottom:1px solid var(--line); outline:none; background:var(--panel); }
[data-paper-status] { min-height:20px; padding:7px 14px; color:var(--muted); font-size:12px; }
[data-paper-layout] { display:grid; grid-template-columns:minmax(150px, 34%) minmax(0, 1fr); min-height:300px; }
[data-paper-list] { border-right:1px solid var(--line); overflow:auto; max-height:560px; }
[data-paper-row] { display:block; width:100%; text-align:left; padding:11px 12px; border-bottom:1px solid var(--line); }
[data-paper-row][aria-current="true"] { background:var(--panel); }
[data-paper-row-title] { display:block; font-weight:650; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
[data-paper-row-preview] { display:block; color:var(--muted); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px; }
[data-paper-detail] { min-width:0; padding:14px; overflow:auto; max-height:560px; }
[data-paper-detail][hidden],[data-paper-editor][hidden],[data-paper-history-panel][hidden],[data-paper-conflict][hidden],[data-paper-delete-confirm][hidden] { display:none; }
[data-paper-detail-head] { display:flex; align-items:flex-start; gap:10px; margin-bottom:10px; }
[data-paper-detail-title] { flex:1; font-size:17px; font-weight:700; overflow-wrap:anywhere; }
[data-paper-actions] { display:flex; flex-wrap:wrap; gap:6px; justify-content:flex-end; }
[data-paper-actions] button { color:var(--muted); padding:2px 4px; }
[data-paper-actions] button:hover { color:var(--ink); }
[data-paper-meta] { color:var(--muted); font-size:12px; margin-bottom:12px; }
[data-paper-content] { white-space:pre-wrap; overflow-wrap:anywhere; min-height:120px; line-height:1.75; }
[data-paper-editor] textarea { display:block; width:100%; min-height:240px; resize:none; overflow:hidden; border:0; outline:none; padding:0; background:transparent; line-height:1.75; }
[data-paper-editor-actions] { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; }
[data-paper-editor-actions] button,[data-paper-conflict] button,[data-paper-delete-confirm] button { padding:6px 10px; border:1px solid var(--line); border-radius:7px; }
[data-paper-save] { background:var(--ink); color:var(--paper); }
[data-paper-conflict],[data-paper-delete-confirm] { margin:10px 0; padding:10px; border:1px solid var(--line); border-radius:8px; background:var(--panel); }
[data-paper-delete],[data-paper-confirm-delete] { color:var(--danger)!important; }
[data-paper-history-panel] { font-size:13px; }
[data-paper-history-item] { padding:8px 0; border-bottom:1px solid var(--line); }
[data-paper-history-meta] { color:var(--muted); font-size:11px; }
[data-paper-history-delta] { white-space:pre-wrap; overflow-wrap:anywhere; margin-top:3px; }
[data-paper-history-delta] del { color:var(--danger); }
[data-paper-empty] { padding:24px 14px; color:var(--muted); }
@media (max-width:520px) {
  body { padding:0; }
  [data-shared-paper-app] { border-radius:0; border-left:0; border-right:0; }
  [data-paper-layout] { grid-template-columns:1fr; }
  [data-paper-list] { border-right:0; max-height:220px; border-bottom:1px solid var(--line); }
  [data-paper-detail] { max-height:none; }
}
</style></head><body><main data-shared-paper-app aria-label="LeileiOS Shared Paper">
<header data-paper-header>
  <div data-paper-title>Shared Paper</div>
  <button type="button" data-paper-scope>归档</button>
</header>
<input data-paper-search type="search" aria-label="搜索 Shared Paper" placeholder="搜索标题或正文">
<div data-paper-status role="status">正在连接…</div>
<div data-paper-layout>
  <section data-paper-list aria-label="Shared Paper 列表"></section>
  <section data-paper-detail hidden>
    <div data-paper-detail-head>
      <div data-paper-detail-title></div>
      <div data-paper-actions>
        <button type="button" data-paper-history>历史</button>
        <button type="button" data-paper-archive>归档</button>
        <button type="button" data-paper-restore hidden>恢复</button>
        <button type="button" data-paper-delete hidden>删除</button>
        <button type="button" data-paper-edit>编辑</button>
      </div>
    </div>
    <div data-paper-meta></div>
    <div data-paper-conflict hidden>
      <div>这张纸已经有更新。当前草稿已保留。</div>
      <button type="button" data-paper-use-latest>使用最新</button>
      <button type="button" data-paper-keep-draft>保留草稿</button>
    </div>
    <div data-paper-delete-confirm hidden>
      <div>永久删除会同时删除这张纸的历史，无法恢复。</div>
      <button type="button" data-paper-cancel-delete>取消</button>
      <button type="button" data-paper-confirm-delete>确认永久删除</button>
    </div>
    <article data-paper-content></article>
    <div data-paper-editor hidden>
      <textarea aria-label="Shared Paper 正文"></textarea>
      <div data-paper-editor-actions>
        <button type="button" data-paper-cancel>取消</button>
        <button type="button" data-paper-save>保存</button>
      </div>
    </div>
    <section data-paper-history-panel hidden>
      <button type="button" data-paper-close-history>返回</button>
      <div data-paper-history-list></div>
    </section>
  </section>
</div>
<div data-paper-empty hidden>还没有 Shared Paper。</div>
</main><script>${escapeInlineScript(BROWSER_BUNDLE)}</script></body></html>`;
}

export function registerSharedPaperAppResource(server: McpServer): void {
  for (const uri of [SHARED_PAPER_APP_RESOURCE_URI, CHATGPT_SHARED_PAPER_APP_RESOURCE_URI]) {
    registerAppResource(
      server,
      "LeileiOS Shared Paper",
      uri,
      { mimeType: RESOURCE_MIME_TYPE, _meta: RESOURCE_META },
      async () => ({
        contents: [{
          uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: createSharedPaperAppHtml(),
          _meta: RESOURCE_META,
        }],
      }),
    );
  }
}
