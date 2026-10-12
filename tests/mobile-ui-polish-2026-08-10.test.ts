import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { DiaryPageHeader } from "../web/src/pages/DiaryPageHeader.js";

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

// f1fa4659 delegates date/search controls to ModulePageHeader. Exercise the
// Diary wrapper so an unforwarded callback or split clear is still caught.
test("Diary date filter exposes one atomic 全部时间 action", async () => {
  assert.match(diaryPage, /onDateRangeClear=\{\(\) =>\s*commitFilters\(\{[\s\S]*?dateFrom:\s*""[\s\S]*?dateTo:\s*""/);
  const { dom, restore } = installDom();
  const root = createRoot(dom.window.document.getElementById("root")!);
  let clears = 0;
  let individualChanges = 0;
  try {
    await React.act(async () => {
      root.render(React.createElement(DiaryPageHeader, {
        count: 1, dateFrom: "2026-08-01", dateTo: "2026-08-10",
        moodDraft: "", tagDraft: "", searchDraft: "", filterError: "", busy: false,
        onDateFromChange() { individualChanges += 1; },
        onDateToChange() { individualChanges += 1; },
        onDateRangeClear() { clears += 1; },
        onMoodChange() {}, onTagChange() {}, onSearchChange() {},
        onOpenArchive() {}, onCreate() {},
      }));
    });
    await React.act(async () => {
      (dom.window.document.querySelector('[aria-label="按日期筛选"]') as HTMLButtonElement).click();
    });
    const dates = [...dom.window.document.querySelectorAll('input[type="date"]')];
    assert.equal(dates.length, 2);
    assert.deepEqual(dates.map((input) => (input as HTMLInputElement).value), ["2026-08-01", "2026-08-10"]);
    assert.equal(dates[0].getAttribute("max"), "2026-08-10");
    assert.equal(dates[1].getAttribute("min"), "2026-08-01");
    for (const input of dates) {
      assert.ok(input.classList.contains("native-date-input"));
      assert.ok(input.closest(".native-date-field"));
    }
    const clear = [...dom.window.document.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "全部时间");
    assert.equal(clear.length, 1);
    await React.act(async () => { clear[0].click(); });
    assert.equal(clears, 1);
    assert.equal(individualChanges, 0);
    assert.equal(dom.window.document.querySelectorAll('input[type="date"]').length, 0);
  } finally {
    try { await React.act(async () => { root.unmount(); }); }
    finally { restore(); }
  }
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

  for (const key of ["window", "document", "navigator", "React", "IS_REACT_ACT_ENVIRONMENT"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        key === "React"
          ? React
          : key === "IS_REACT_ACT_ENVIRONMENT"
            ? true
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
      for (const key of ["window", "document", "navigator", "React", "IS_REACT_ACT_ENVIRONMENT"]) {
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
