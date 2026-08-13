import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import test from "node:test";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import { SystemDataPageContent } from "../web/src/pages/SystemDataPageContent.js";

function installDom(url: string) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "React", "URL"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "React" ? React : key === "URL" ? dom.window.URL : dom.window[key as keyof Window] });
  }
  return { dom, restore() { for (const key of ["window", "document", "navigator", "React", "URL"]) { const descriptor = previous.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } dom.window.close(); } };
}

const waitForPaint = () => new Promise((resolve) => setTimeout(resolve, 35));
const summary = () => ({ success: true as const, data: { memory: { active: 0, archived: 0 }, diary: { active: 0, archived: 0 }, task: { active: 0, archived: 0 }, health: { total: 0 } } });

test("Data restore previews a selected file and executes only after explicit confirmation", async () => {
  const env = installDom("https://leilei.test/system/data");
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init });
      if (path === "/system/data") return summary() as T;
      if (path === "/system/import/preview") return { data: { package_sha256: "a".repeat(64), preview_fingerprint: "b".repeat(64), can_execute: true, summary: { memory: { create: 1, duplicate: 0, conflict: 0, invalid: 0 } } } } as T;
      return { data: { package_sha256: "a".repeat(64), preview_fingerprint: "b".repeat(64), summary: {} } } as T;
    },
  };
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  root.render(React.createElement(SystemDataPageContent, { api }));
  await waitForPaint();
  const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
  const file = new env.dom.window.File(["{}"], "backup.json", { type: "application/json" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new env.dom.window.Event("change", { bubbles: true }));
  await waitForPaint();
  assert.match(container.textContent ?? "", /Ready to restore new records/);
  const restore = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Restore selected data");
  assert.ok(restore);
  restore.click();
  await waitForPaint();
  assert.deepEqual(calls.map((call) => call.path), ["/system/data", "/system/import/preview", "/system/import/execute?expected_preview_fingerprint=" + "b".repeat(64), "/system/data"]);
  assert.equal(calls[1]?.init?.headers instanceof Object, true);
  assert.equal((calls[1]?.init?.headers as Record<string, string>)["Content-Type"], "application/octet-stream");
  root.unmount();
  await waitForPaint();
  env.restore();
});

