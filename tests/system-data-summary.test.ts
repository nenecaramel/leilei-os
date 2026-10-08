import assert from "node:assert/strict";
import React from "../web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../web/node_modules/react-dom/server.js";
import test from "node:test";
import {
  countImport,
  fileSummary,
  formatExportedAt,
  formatModuleCounts,
  moduleCounts,
} from "../web/src/pages/system-data/system-data-format.js";
import {
  ArchivedCountRow,
  ModuleSummaryRows,
  SimpleCountRow,
} from "../web/src/pages/system-data/SystemDataSummary.js";

test("backup file summaries preserve byte thresholds, precision and invalid timestamp fallback", () => {
  for (const [size, text] of [
    [0, "0 B"], [1023, "1023 B"], [1024, "1.0 KB"],
    [1536, "1.5 KB"], [1048576, "1.0 MB"],
  ] as const) assert.equal(fileSummary("备份.json", size), `备份.json · ${text}`);
  assert.equal(formatExportedAt("invalid timestamp"), "invalid timestamp");
});

test("sparse import counts remain read-only and preserve the zero-module fallback", () => {
  const summary = Object.freeze({
    diary: Object.freeze({ create: 2, duplicate: 3, conflict: 1, invalid: 0 }),
    todo: Object.freeze({ create: 4, duplicate: 0, conflict: 0, invalid: 2 }),
  });
  assert.equal(countImport(summary, "create"), 6);
  assert.equal(countImport(summary, "duplicate"), 3);
  assert.equal(countImport(summary, "conflict"), 1);
  assert.equal(countImport(summary, "invalid"), 2);
  assert.deepEqual(moduleCounts(summary, "mind"), { create: 0, duplicate: 0, conflict: 0, invalid: 0 });
  assert.equal(countImport({}, "create"), 0);
});

test("module count copy keeps its order and omits zero categories", () => {
  assert.equal(formatModuleCounts({ create: 2, duplicate: 3, conflict: 4, invalid: 5 }), "2 new · 3 already here · 4 conflict · 5 invalid");
  assert.equal(formatModuleCounts({ create: 0, duplicate: 3, conflict: 0, invalid: 0 }), "3 already here");
  assert.equal(formatModuleCounts({ create: 0, duplicate: 0, conflict: 0, invalid: 0 }), "No records");
});

test("summary rows preserve their exact DOM, labels and class names without extra wrappers", () => {
  assert.equal(renderToStaticMarkup(React.createElement(SimpleCountRow, { label: "Mind", value: 9 })), '<div class="system-data-row"><strong>Mind</strong><div class="system-count-pair"><div class="system-count-cell"><span>Stored</span><strong>9</strong></div></div></div>');
  assert.equal(renderToStaticMarkup(React.createElement(SimpleCountRow, { label: "Universe", value: 2, valueLabel: "Nodes" })), '<div class="system-data-row"><strong>Universe</strong><div class="system-count-pair"><div class="system-count-cell"><span>Nodes</span><strong>2</strong></div></div></div>');
  assert.equal(renderToStaticMarkup(React.createElement(ArchivedCountRow, { label: "Diary", active: 2, archived: 1 })), '<div class="system-data-row"><strong>Diary</strong><div class="system-count-pair"><div class="system-count-cell"><span>Active</span><strong>2</strong></div><div class="system-count-cell"><span>Archived</span><strong>1</strong></div></div></div>');
});

test("import summary uses canonical module order, filters missing modules and keeps blocked styling", () => {
  const props = {
    summary: { diary: { create: 2, duplicate: 0, conflict: 0, invalid: 0 } },
    includedModules: ["mind", "diary", "mind"] as ("mind" | "diary")[],
  };
  const ordinary = renderToStaticMarkup(React.createElement(ModuleSummaryRows, props));
  assert.equal(ordinary, '<div class="system-import-row system-import-module-row"><span class="system-import-row-label">Diary</span><span class="system-import-row-value">2 new</span></div><div class="system-import-row system-import-module-row"><span class="system-import-row-label">Mind records</span><span class="system-import-row-value">No records</span></div>');
  const blocked = renderToStaticMarkup(React.createElement(ModuleSummaryRows, { ...props, blocked: true }));
  assert.equal(blocked, ordinary.replaceAll('class="system-import-row-value"', 'class="system-import-row-value system-import-row-value-blocked"'));
});
