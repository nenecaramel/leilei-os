import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

const taskPage = readFileSync(
  new URL("../web/src/pages/TaskPage.tsx", import.meta.url),
  "utf8",
);

const diaryPage = readFileSync(
  new URL("../web/src/pages/DiaryPage.tsx", import.meta.url),
  "utf8",
);

test("shared native date controls can shrink inside form cards", () => {
  const dateControls = styles.match(
    /input\[type="date"\],[\s\S]*?color-scheme: light;/,
  )?.[0];

  assert.ok(dateControls);
  assert.match(dateControls, /input\[type="datetime-local"\]/);
  assert.match(dateControls, /input\[type="time"\]/);
  assert.match(dateControls, /width: 100%;/);
  assert.match(dateControls, /max-width: 100%;/);
  assert.match(dateControls, /min-width: 0;/);
  assert.match(dateControls, /min-inline-size: 0;/);
  assert.match(dateControls, /box-sizing: border-box;/);
  assert.match(dateControls, /-webkit-min-logical-width: 0;/);
});

test("Task and Diary date fields inherit the shared form control styling", () => {
  assert.match(taskPage, /<section className="memory-message">/);
  assert.match(taskPage, /type="datetime-local"/);
  assert.match(diaryPage, /<section className="memory-message">/);
  assert.match(diaryPage, /type="date"/);

  assert.match(
    styles,
    /\.memory-message \{[\s\S]*?min-width: 0;/,
  );
  assert.match(
    styles,
    /\.memory-message > input,[\s\S]*?width: min\(100%, 760px\);[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/,
  );
});

test("ordinary form inputs retain the shared full-width border-box baseline", () => {
  const formControls = styles.match(
    /input,\nselect,\ntextarea \{\n  width: 100%;[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(formControls);
  assert.match(formControls, /width: 100%;/);
  assert.match(formControls, /max-width: 100%;/);
  assert.match(formControls, /min-width: 0;/);
});
