import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const header = readFileSync(
  new URL("../web/src/pages/MemoryPageHeader.tsx", import.meta.url),
  "utf8",
);

const icons = readFileSync(
  new URL("../web/src/components/icons.tsx", import.meta.url),
  "utf8",
);

const styles = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

test("Memory header tools use the accepted optical balance", () => {
  assert.ok(
    header.includes(
      '<DashboardIcon className="memory-page-category-icon" />',
    ),
  );

  assert.ok(
    header.includes(
      '<span className="memory-page-tag-icon" aria-hidden="true">#</span>',
    ),
  );

  assert.ok(
    icons.includes(
      '<g transform="translate(24 0) scale(-1 1)">',
    ),
  );

  const marker = styles.indexOf(
    "/* Memory visual acceptance fixes */",
  );
  assert.notEqual(marker, -1);

  const fixes = styles.slice(marker);

  assert.ok(
    fixes.includes(
      ".memory-page-category-icon {\n" +
      "    width: 18px !important;",
    ),
  );

  assert.ok(
    fixes.includes(
      ".memory-page-tag-icon {\n" +
      "    display: inline-block;\n" +
      "    font-size: 20px;",
    ),
  );

  const create = styles.indexOf(
    ".memory-page-create-icon {",
  );
  assert.notEqual(create, -1);

  const createEnd = styles.indexOf("}", create);
  const createBlock = styles.slice(create, createEnd);

  assert.ok(createBlock.includes("transform: none;"));
  assert.equal(createBlock.includes("scaleX(-1)"), false);
});

test("Memory search contains no right-side cancel cross", () => {
  assert.equal(header.includes('type="search"'), false);
  assert.ok(header.includes('type="text"'));

  assert.equal(
    header.includes('aria-label="清除筛选"'),
    false,
  );

  assert.equal(
    header.includes(">×</button>"),
    false,
  );
});

test("Memory edit and create controls stay on paper coordinates", () => {
  const marker = styles.indexOf(
    "/* Memory visual acceptance fixes */",
  );
  assert.notEqual(marker, -1);

  const fixes = styles.slice(marker);

  assert.equal(
    fixes.includes(".memory-paper-form"),
    false,
  );

  assert.ok(
    fixes.includes(
      '.paper-detail-paper[id^="memory-"] .memory-paper-title',
    ),
  );

  assert.ok(
    fixes.includes(
      '.paper-detail-paper[id^="memory-"] input[placeholder="Key"]',
    ),
  );

  assert.ok(fixes.includes("margin: 0 0 14px;"));
  assert.ok(fixes.includes("height: 23px;"));

  assert.ok(
    fixes.includes(
      '.paper-detail-paper[id^="memory-"] .memory-paper-content',
    ),
  );

  assert.ok(
    fixes.includes(
      '.paper-detail-paper[id^="memory-"] .memory-paper-editor textarea',
    ),
  );

  assert.ok(fixes.includes("line-height: 30px;"));
});

test("Memory paper focus looks like direct writing", () => {
  const marker = styles.indexOf(
    "/* Memory visual acceptance fixes */",
  );
  assert.notEqual(marker, -1);

  const fixes = styles.slice(marker);

  assert.ok(
    fixes.includes(
      '.paper-detail-paper[id^="memory-"] input:focus',
    ),
  );

  assert.ok(
    fixes.includes(
      '.paper-detail-paper[id^="memory-"] textarea:focus',
    ),
  );

  assert.ok(fixes.includes("border: 0;"));
  assert.ok(fixes.includes("outline: none;"));
  assert.ok(fixes.includes("background: transparent;"));
  assert.ok(fixes.includes("box-shadow: none;"));
});

test("Memory bottom metadata retains its fixed paper slot", () => {
  const marker = styles.indexOf(
    "/* Memory visual acceptance fixes */",
  );
  assert.notEqual(marker, -1);

  const fixes = styles.slice(marker);

  assert.ok(
    fixes.includes(
      '.paper-detail-paper[id^="memory-"] ' +
      ".paper-detail-bottom-left",
    ),
  );

  assert.ok(fixes.includes("min-height: 20px;"));
  assert.ok(fixes.includes("line-height: 20px;"));
});

test("Archive return has an unobstructed hit target", () => {
  const marker = styles.indexOf(
    "/* Memory visual acceptance fixes */",
  );
  assert.notEqual(marker, -1);

  const fixes = styles.slice(marker);

  assert.ok(
    fixes.includes(".memory-archive-header {"),
  );

  assert.ok(
    fixes.includes(".memory-archive-back {"),
  );

  assert.ok(fixes.includes("z-index: 5;"));
  assert.ok(fixes.includes("pointer-events: auto;"));
});


test("Memory final visual acceptance keeps pen alignment and routed Archive return", () => {
  const pageSource = readFileSync(
    new URL("../web/src/pages/MemoryPage.tsx", import.meta.url),
    "utf8",
  );

  const marker = styles.indexOf(
    "/* Memory pen optical alignment */",
  );
  assert.notEqual(marker, -1);

  const penFix = styles.slice(marker);

  assert.ok(
    penFix.includes(
      ".memory-page-tools .memory-page-create-icon {",
    ),
  );
  assert.ok(penFix.includes("width: 22px;"));
  assert.ok(penFix.includes("height: 22px;"));
  assert.ok(penFix.includes("top: -0.5px;"));

  const closeStart = pageSource.indexOf(
    "function closeArchive(): void {",
  );
  assert.notEqual(closeStart, -1);

  const closeEnd = pageSource.indexOf(
    "function openArchivedMemory",
    closeStart,
  );
  assert.notEqual(closeEnd, -1);

  const closeArchive = pageSource.slice(
    closeStart,
    closeEnd,
  );

  assert.ok(
    closeArchive.includes(
      "navigateWithinApp(returnTo, window.history.state, { resetScroll: false });",
    ),
  );

  assert.equal(
    closeArchive.includes(
      'window.history.pushState(null, "", returnTo);',
    ),
    false,
  );
});
