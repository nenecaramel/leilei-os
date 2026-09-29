import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import test from "node:test";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import { SystemDataPageContent } from "../web/src/pages/SystemDataPageContent.js";
import type { WebExportDocument } from "../web/src/system/export-types.js";

function installDom(url: string) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "React", "URL"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "React" ? React : key === "URL" ? dom.window.URL : dom.window[key as keyof Window],
    });
  }
  return {
    dom,
    restore() {
      for (const key of ["window", "document", "navigator", "React", "URL"]) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      dom.window.close();
    },
  };
}

const waitForPaint = () => new Promise((resolve) => setTimeout(resolve, 35));

async function waitFor(condition: () => boolean, label: string, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`Timed out waiting for ${label}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function summary() {
  return {
    success: true as const,
    data: {
      diary: { active: 3, archived: 4 },
      diary_comments: { count: 5 },
      todo: { active: 9, count: 9 },
      workspaces: { count: 2 },
      conversations: { active: 6, archived: 1 },
      mind: { count: 8 },
      universe: { nodes: 7 },
    },
  };
}

function exportDocument(): WebExportDocument {
  return {
    schema_version: 4,
    owner_fingerprint: "a".repeat(64),
    exported_at: "2026-08-13T05:42:00.000Z",
    data: { diary: [{ title: "approved" }] },
  };
}

function render(api: WebApiClient) {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  root.render(React.createElement(SystemDataPageContent, { api }));
  return { root, container };
}

test("Data renders truthful Backup actions and inactive diagnostic audit control", async () => {
  const env = installDom("https://leilei.test/system/data");
  const paths: string[] = [];
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      paths.push(path);
      return (path === "/system/data" ? summary() : exportDocument()) as T;
    },
  };
  const { root, container } = render(api);
  await waitFor(
    () => paths.includes("/system/data") && container.querySelector(".system-export-card") !== null,
    "the System Data request and Export card",
  );

  assert.deepEqual(paths, ["/system/data"]);
  const card = container.querySelector(".system-export-card");
  assert.ok(card);
  assert.equal(card.querySelector(".system-export-label")?.textContent, "Backup");
  assert.ok(card.querySelector(".system-export-action-row"));
  const labels = Array.from(card.querySelectorAll(".system-export-action"), (button) => button.textContent);
  assert.deepEqual(labels, ["Full Backup", "Diary", "Todo"]);

  const auditControl = card.querySelector<HTMLElement>(".system-export-audit");
  assert.ok(auditControl);
  assert.equal(auditControl.dataset.active, "false");
  assert.equal(card.querySelector(".system-export-audit-check"), null);
  const audit = card.querySelector<HTMLInputElement>(".system-export-audit-input");
  assert.ok(audit);
  assert.equal(audit.checked, false);

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("audit text control becomes active with a plain check and still sends include_audit", async () => {
  const env = installDom("https://leilei.test/system/data");
  const paths: string[] = [];
  const blobs: Blob[] = [];
  const clicked: HTMLAnchorElement[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob: Blob) => {
    blobs.push(blob);
    return "blob:test";
  };
  URL.revokeObjectURL = () => {};
  const originalClick = env.dom.window.HTMLAnchorElement.prototype.click;
  env.dom.window.HTMLAnchorElement.prototype.click = function click() { clicked.push(this); };
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      paths.push(path);
      return (path === "/system/data" ? summary() : exportDocument()) as T;
    },
  };
  const { root, container } = render(api);
  await waitForPaint();

  const buttons = container.querySelectorAll<HTMLButtonElement>(".system-export-action");
  buttons[1].click();
  await waitForPaint();

  const audit = container.querySelector<HTMLInputElement>(".system-export-audit-input")!;
  audit.click();
  await waitForPaint();
  const auditControl = container.querySelector<HTMLElement>(".system-export-audit")!;
  assert.equal(auditControl.dataset.active, "true");
  assert.equal(container.querySelector(".system-export-audit-check")?.textContent, "✓");

  buttons[0].click();
  await waitForPaint();

  assert.deepEqual(paths, ["/system/data", "/system/export?scope=diary", "/system/export?scope=all&include_audit=true"]);
  assert.equal(blobs.length, 2);
  assert.equal(clicked.length, 2);
  assert.equal(clicked[0].download, "leileios-export-20260813T054200Z.json");
  assert.deepEqual(JSON.parse(await blobs[1].text()), exportDocument());

  env.dom.window.HTMLAnchorElement.prototype.click = originalClick;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("export failures are local and do not erase the loaded summary", async () => {
  const env = installDom("https://leilei.test/system/data");
  let attempts = 0;
  let clicks = 0;
  const originalClick = env.dom.window.HTMLAnchorElement.prototype.click;
  env.dom.window.HTMLAnchorElement.prototype.click = () => { clicks += 1; };
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      if (path === "/system/data") return summary() as T;
      attempts += 1;
      throw new Error("export unavailable");
    },
  };
  const { root, container } = render(api);
  await waitForPaint();
  container.querySelector<HTMLButtonElement>(".system-export-action")!.click();
  await waitForPaint();
  assert.equal(attempts, 1);
  assert.equal(clicks, 0);
  assert.match(container.textContent ?? "", /Unable to create this backup/);
  env.dom.window.HTMLAnchorElement.prototype.click = originalClick;
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("pending export disables all export actions without changing summary state", async () => {
  const env = installDom("https://leilei.test/system/data");
  let resolveExport!: (value: WebExportDocument) => void;
  const pending = new Promise<WebExportDocument>((resolve) => { resolveExport = resolve; });
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      return (path === "/system/data" ? summary() : pending) as T;
    },
  };
  const { root, container } = render(api);
  await waitForPaint();
  const buttons = container.querySelectorAll<HTMLButtonElement>(".system-export-action");
  buttons[0].click();
  await waitForPaint();
  assert.equal(Array.from(buttons).every((button) => button.disabled), true);
  resolveExport(exportDocument());
  await waitForPaint();
  assert.equal(Array.from(buttons).some((button) => button.disabled), false);
  root.unmount();
  await waitForPaint();
  env.restore();
});
