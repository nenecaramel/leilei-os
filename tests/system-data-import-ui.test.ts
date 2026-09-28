import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import test from "node:test";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import { WebApiError } from "../web/src/api/web-api-error.js";
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
const summary = () => ({ success: true as const, data: { diary: { active: 0, archived: 0 }, todo: { active: 0 } } });

function render(api: WebApiClient) {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  root.render(React.createElement(SystemDataPageContent, { api }));
  return { container, root };
}

async function selectFile(env: ReturnType<typeof installDom>, container: HTMLElement, name = "backup.json") {
  const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
  const file = new env.dom.window.File(["{}"], name, { type: "application/json" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new env.dom.window.Event("change", { bubbles: true }));
  await waitForPaint();
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === text);
}

test("Data restore keeps selection, preview, and execute inside the compact System row language", async () => {
  const env = installDom("https://leilei.test/system/data");
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init });
      if (path === "/system/data") return summary() as T;
      if (path === "/system/import/preview") return { data: { package_sha256: "a".repeat(64), preview_fingerprint: "b".repeat(64), can_execute: true, summary: {
        diary: { create: 1, duplicate: 0, conflict: 0, invalid: 0 },
        todo: { create: 2, duplicate: 0, conflict: 0, invalid: 0 },
      } } } as T;
      return { data: { package_sha256: "a".repeat(64), preview_fingerprint: "b".repeat(64), summary: {
        diary: { create: 1, duplicate: 0, conflict: 0, invalid: 0 },
        todo: { create: 2, duplicate: 0, conflict: 0, invalid: 0 },
      } } } as T;
    },
  };
  const { container, root } = render(api);
  await waitForPaint();

  const card = container.querySelector<HTMLElement>(".system-import-card");
  assert.ok(card);
  assert.equal(card.querySelector(".system-export-label")?.textContent, "Restore");
  assert.match(card.textContent ?? "", /Export file/);
  assert.equal(findButton(card, "Choose")?.classList.contains("system-import-action"), true);
  assert.equal(card.querySelector(".secondary-button"), null);
  assert.doesNotMatch(card.textContent ?? "", /Validate an export/);

  await selectFile(env, container);
  assert.match(card.textContent ?? "", /backup\.json · 0\.0 KB/);
  assert.ok(findButton(card, "Preview"));
  assert.doesNotMatch(card.textContent ?? "", /Preview restore/);

  findButton(card, "Preview")!.click();
  await waitForPaint();
  assert.match(card.textContent ?? "", /Diary/);
  assert.match(card.textContent ?? "", /Todo/);
  assert.match(card.textContent ?? "", /1 new/);
  assert.match(card.textContent ?? "", /2 new/);
  assert.match(card.textContent ?? "", /3 new records/);
  assert.doesNotMatch(card.textContent ?? "", /create 1|duplicate 0|conflict 0|invalid 0/);

  const restore = findButton(card, "Restore");
  assert.ok(restore);
  restore.click();
  await waitForPaint();
  assert.match(card.textContent ?? "", /Restored 3 records/);
  assert.deepEqual(calls.map((call) => call.path), ["/system/data", "/system/import/preview", "/system/import/execute?expected_preview_fingerprint=" + "b".repeat(64), "/system/data"]);
  assert.equal(calls[1]?.init?.headers instanceof Object, true);
  assert.equal((calls[1]?.init?.headers as Record<string, string>)["Content-Type"], "application/octet-stream");

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Data restore treats an all-duplicate preview as a quiet completed state with no restore action", async () => {
  const env = installDom("https://leilei.test/system/data");
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      if (path === "/system/data") return summary() as T;
      return { data: { package_sha256: "a".repeat(64), preview_fingerprint: "b".repeat(64), can_execute: false, summary: { diary: { create: 0, duplicate: 2, conflict: 0, invalid: 0 } } } } as T;
    },
  };
  const { container, root } = render(api);
  await waitForPaint();
  await selectFile(env, container);
  findButton(container, "Preview")!.click();
  await waitForPaint();

  const card = container.querySelector<HTMLElement>(".system-import-card")!;
  assert.match(card.textContent ?? "", /Everything is already here/);
  assert.equal(findButton(card, "Restore"), undefined);
  assert.doesNotMatch(card.textContent ?? "", /duplicate 2|Restore 0 records/);

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Data restore turns conflict and invalid planner counts into human-facing blocked rows", async () => {
  const env = installDom("https://leilei.test/system/data");
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      if (path === "/system/data") return summary() as T;
      return { data: { package_sha256: "a".repeat(64), preview_fingerprint: "b".repeat(64), can_execute: false, summary: {
        diary: { create: 0, duplicate: 0, conflict: 1, invalid: 0 },
        todo: { create: 0, duplicate: 0, conflict: 0, invalid: 1 },
      } } } as T;
    },
  };
  const { container, root } = render(api);
  await waitForPaint();
  await selectFile(env, container);
  findButton(container, "Preview")!.click();
  await waitForPaint();

  const card = container.querySelector<HTMLElement>(".system-import-card")!;
  assert.match(card.textContent ?? "", /Diary\s*Conflict/);
  assert.match(card.textContent ?? "", /Todo\s*Invalid/);
  assert.match(card.textContent ?? "", /Nothing will be overwritten/);
  assert.equal(findButton(card, "Restore"), undefined);
  assert.doesNotMatch(card.textContent ?? "", /conflict 1|invalid 1/);

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Data restore preserves a safe Web API validation message", async () => {
  const env = installDom("https://leilei.test/system/data");
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      if (path === "/system/data") return summary() as T;
      throw new WebApiError(403, "IMPORT_OWNER_MISMATCH", "Import package does not belong to this account.");
    },
  };
  const { container, root } = render(api);
  await waitForPaint();
  await selectFile(env, container);
  findButton(container, "Preview")!.click();
  await waitForPaint();

  const card = container.querySelector<HTMLElement>(".system-import-card")!;
  assert.match(card.textContent ?? "", /Import package does not belong to this account/);
  assert.ok(findButton(card, "Choose"));

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Data restore keeps the generic validation fallback for unknown errors", async () => {
  const env = installDom("https://leilei.test/system/data");
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      if (path === "/system/data") return summary() as T;
      throw new Error("internal details");
    },
  };
  const { container, root } = render(api);
  await waitForPaint();
  await selectFile(env, container);
  findButton(container, "Preview")!.click();
  await waitForPaint();

  const card = container.querySelector<HTMLElement>(".system-import-card")!;
  assert.match(card.textContent ?? "", /Unable to validate this export file/);
  assert.doesNotMatch(card.textContent ?? "", /internal details/);

  root.unmount();
  await waitForPaint();
  env.restore();
});
