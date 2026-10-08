import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../web/node_modules/react-dom/server.js";
import { formatDiarySourceDate, sourceOptionFromSummary, formatUniverseNodeTimestamp, formatStandaloneDate, formatMembershipWeight, canonicalWeightTextToPercentText, percentWeightTextToCanonicalText } from "../web/src/pages/universe/universe-node-presentation.js";
import { DiaryProvenanceTimeline } from "../web/src/pages/universe/DiaryProvenanceTimeline.js";
import { UniverseHeader, UniverseFrame, UniverseLoadingState, UniverseStatus } from "../web/src/pages/universe/UniversePagePresentation.js";
Object.assign(globalThis, { React });
test("Diary source date is sliced without timezone conversion and invalid text is retained", () => {
  assert.equal(formatDiarySourceDate("2026-10-08T23:00:00-07:00"), "2026.10.08");
  assert.equal(formatDiarySourceDate("unknown"), "unknown");
});
test("Node timestamp keeps explicit timezone and invalid-time fallback", () => {
  assert.equal(formatUniverseNodeTimestamp("2026-10-08T01:02:59Z", "UTC"), "2026.10.08 01:02");
  assert.equal(formatUniverseNodeTimestamp("2026-10-08T01:02:59Z", "Asia/Shanghai"), "2026.10.08 09:02");
  assert.equal(formatUniverseNodeTimestamp("bad"), "时间未知");
  assert.equal(formatStandaloneDate("bad"), "时间未知");
  assert.equal(formatStandaloneDate(new Date(2026, 0, 2).toISOString()), "2026/1/2");
});
test("Weights keep percent boundaries and non-fraction formatting", () => {
  assert.deepEqual([0, 0.314, 1, 1.234, -0.12].map(formatMembershipWeight), ["0%", "31%", "100%", "1.23", "-0.12"]);
});
test("Canonical text to percentage retains empty/invalid input and rounding", () => {
  for (const [input, expected] of [["", ""], ["  ", ""], ["bad", ""], ["Infinity", ""], ["0", "0"], ["0.314159", "31.416"], ["-0.2", "-20"]]) {
    assert.equal(canonicalWeightTextToPercentText(input), expected);
  }
});
test("Percentage to canonical text preserves rounding and does not clamp", () => {
  for (const [input, expected] of [["", ""], ["bad", ""], ["Infinity", ""], ["31.4159265", "0.314159"], ["120", "1.2"], ["-20", "-0.2"]]) {
    assert.equal(percentWeightTextToCanonicalText(input), expected);
  }
});
test("Source summary conversion preserves source identity and archived status", () => {
  assert.deepEqual(sourceOptionFromSummary({ nodeId: "n1", diaryId: "d1", title: "Day", date: "2026-01-02", status: "archived" }), { id: "d1", title: "Day", date: "2026-01-02", status: "archived" });
});
test("Provenance keeps date/id ordering, source array intact, DOM and exact open callback", () => {
  const source = { nodeId: "n1", diaryId: "b", title: "Second", date: "2026-01-02", status: "active" as const };
  const sources = [source, { ...source, diaryId: "c", title: "Last" }, { ...source, diaryId: "a", title: "First", date: "2026-01-01" }];
  const opened: string[] = [];
  const tree = DiaryProvenanceTimeline({ sources, onOpen: (id) => opened.push(id) });
  const dom = new JSDOM(renderToStaticMarkup(tree));
  try {
    assert.deepEqual([...dom.window.document.querySelectorAll(".universe-diary-provenance-title")].map((el) => el.textContent), ["First", "Second", "Last"]);
    assert.equal(dom.window.document.querySelectorAll(".universe-diary-provenance-row > .universe-diary-provenance-line[aria-hidden=true] > i").length, 3);
    assert.equal(dom.window.document.querySelector(".universe-diary-provenance")?.getAttribute("aria-label"), "来源日记");
    const rows = tree!.props.children as React.ReactElement<any>[];
    rows[1].props.children[1].props.onClick();
    assert.deepEqual(opened, ["b"]);
    assert.deepEqual(sources.map((s) => s.diaryId), ["b", "c", "a"]);
    assert.equal(DiaryProvenanceTimeline({ sources: [] }), null);
  } finally { dom.window.close(); }
});
test("Universe frame adds no wrapper beyond original page/header and preserves loading status", () => {
  const tree = React.createElement(UniverseFrame, { children: React.createElement(UniverseLoadingState) });
  const dom = new JSDOM(renderToStaticMarkup(tree));
  try {
    const page = dom.window.document.querySelector(".page.memory-page.universe-page")!;
    assert.deepEqual([...page.children].map((el) => el.tagName), ["HEADER", "SECTION"]);
    assert.equal(page.querySelector(".memory-page-title")?.textContent, "Universe");
    assert.equal(page.querySelector('[role="status"]')?.textContent, "Reading...");
    assert.ok(page.querySelector(".universe-cosmos.universe-cosmos-loading"));
  } finally { dom.window.close(); }
});
test("Universe header trims notice punctuation and keeps actions after heading", () => {
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(UniverseHeader, { notice: " 完成！？ ", actions: React.createElement("button", null, "Action") })));
  try {
    assert.equal(dom.window.document.querySelector(".universe-header-notice")?.textContent, "完成");
    assert.deepEqual([...dom.window.document.querySelector("header")!.children].map((el) => el.className), ["memory-page-heading universe-page-heading", "universe-page-tools"]);
  } finally { dom.window.close(); }
});
test("Universe error retains alert/retry and passes the retry handler unchanged", () => {
  const retry = () => {};
  const tree = UniverseStatus({ onRetry: retry });
  assert.equal(tree.props.onRetry, retry);
  const dom = new JSDOM(renderToStaticMarkup(tree));
  try {
    assert.equal(dom.window.document.querySelector('[role="alert"] p')?.textContent, "Unable to read Universe.");
    assert.equal(dom.window.document.querySelector("button")?.textContent, "Retry");
  } finally { dom.window.close(); }
});
