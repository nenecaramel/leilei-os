import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { downloadUniverseJson } from "../web/src/pages/universe/universe-export.js";
import type { UniverseSnapshot } from "../web/src/pages/universe/universe-types.js";

const snapshot: UniverseSnapshot = {
  schemaVersion: 2,
  meta: { name: "远程宇宙", createdAt: "2026-08-01", updatedAt: "2026-08-02" },
  galaxies: [],
  nodes: [],
  relations: [],
  revisions: [],
};

test("JSON export downloads the loaded canonical snapshot without IndexedDB", async () => {
  const exportSource = readFileSync(new URL("../web/src/pages/universe/universe-export.ts", import.meta.url), "utf8");
  assert.doesNotMatch(exportSource, /indexedDB|localStorage|sessionStorage/);
  let clicked = false;
  let revoked = "";
  let downloaded: { href?: string; download?: string } | undefined;
  const documentRef = {
    createElement() {
      downloaded = {
        href: "",
        download: "",
      };
      return {
        set href(value: string) { downloaded!.href = value; },
        set download(value: string) { downloaded!.download = value; },
        click() { clicked = true; },
      };
    },
  };
  const blobs: Blob[] = [];
  const urlRef = {
    createObjectURL(blob: Blob) { blobs.push(blob); return "blob:universe"; },
    revokeObjectURL(value: string) { revoked = value; },
  };
  const result = downloadUniverseJson(snapshot, {
    document: documentRef,
    Blob,
    URL: urlRef,
    now: () => new Date("2026-08-15T12:00:00.000Z"),
  });
  assert.equal(clicked, true);
  assert.equal(downloaded?.href, "blob:universe");
  assert.equal(downloaded?.download, "蕾蕾宇宙备份-2026-08-15.json");
  assert.equal(revoked, "blob:universe");
  assert.deepEqual(result.meta, { ...snapshot.meta, exportedAt: "2026-08-15T12:00:00.000Z" });
  assert.deepEqual(JSON.parse(await blobs[0]!.text()), result);
});
