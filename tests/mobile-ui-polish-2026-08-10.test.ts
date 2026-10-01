import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { BrowserRouter } from "../web/node_modules/react-router-dom/dist/index.mjs";
import { DashboardPageContent } from "../web/src/pages/DashboardPage.js";

const diaryHeader = readFileSync(
  new URL("../web/src/pages/DiaryPageHeader.tsx", import.meta.url),
  "utf8",
);
const diaryPage = readFileSync(
  new URL("../web/src/pages/DiaryPage.tsx", import.meta.url),
  "utf8",
);
const dashboard = readFileSync(
  new URL("../web/src/pages/DashboardPage.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

const START = "/* leilei-mobile-ui-polish-2026-08-10:start */";
const END = "/* leilei-mobile-ui-polish-2026-08-10:end */";

function mobileBlock(): string {
  const start = css.indexOf(START);
  const end = css.indexOf(END);
  assert.ok(start >= 0, "mobile polish start marker missing");
  assert.ok(end > start, "mobile polish end marker missing");
  return css.slice(start, end);
}

test("Diary date filter exposes one atomic 全部时间 action", () => {
  assert.match(diaryHeader, /onDateRangeClear\(\): void/);
  assert.match(diaryHeader, />\s*全部时间\s*<\/button>/);
  assert.match(diaryHeader, /onClick=\{\(\) => \{[\s\S]*?onDateRangeClear\(\);/);
  assert.match(
    diaryPage,
    /onDateRangeClear=\{\(\) =>\s*commitFilters\(\{[\s\S]*?dateFrom:\s*""[\s\S]*?dateTo:\s*""/,
  );
});

test("mobile paper dialogs move exactly 20px upward", () => {
  assert.match(
    css,
    /\.paper-detail-paper\s*\{[\s\S]*?transform:\s*translateY\(31px\)/,
  );
  assert.match(
    mobileBlock(),
    /\.paper-detail-paper\s*\{[^}]*transform:\s*translateY\(11px\)\s*!important;/,
  );
});

test("mobile auth composition moves up without overriding orb rotation", () => {
  const block = mobileBlock();
  assert.match(
    block,
    /\.auth-screen\s*\{[^}]*padding-bottom:\s*64px\s*!important;/,
  );
  assert.match(
    block,
    /\.auth-minimal\s*\{[^}]*transform:\s*none\s*!important;/,
  );
  assert.doesNotMatch(
    block,
    /\.loading-orb\s*\{[^}]*transform:/,
  );
});

test("top quick search compensates for its border width", () => {
  const block = mobileBlock();
  assert.match(
    block,
    /\.quick-search-panel\s*\{[^}]*right:\s*max\(23px,\s*env\(safe-area-inset-right,\s*0px\)\)/,
  );
  assert.match(
    block,
    /\.quick-search-panel\s*\{[^}]*left:\s*max\(23px,\s*env\(safe-area-inset-left,\s*0px\)\)/,
  );
});

function installDom() {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "https://leilei.test/" },
  );
  const previous = new Map<string, PropertyDescriptor | undefined>();

  for (const key of ["window", "document", "navigator", "React"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        key === "React"
          ? React
          : dom.window[key as keyof Window],
    });
  }

  dom.window.requestAnimationFrame = (callback) =>
    dom.window.setTimeout(callback, 0);
  dom.window.cancelAnimationFrame = (handle) =>
    dom.window.clearTimeout(handle);

  return {
    dom,
    restore() {
      for (const key of ["window", "document", "navigator", "React"]) {
        const descriptor = previous.get(key);
        if (descriptor) {
          Object.defineProperty(globalThis, key, descriptor);
        } else {
          Reflect.deleteProperty(globalThis, key);
        }
      }
      dom.window.close();
    },
  };
}

const waitForPaint = () =>
  new Promise((resolve) => setTimeout(resolve, 20));
