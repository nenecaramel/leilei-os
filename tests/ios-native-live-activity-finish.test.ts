import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
const surface = "ios/LeileiOS/LeileiOS/Chat/MessageSurface/";
test("real Swift Activity preserves final duration and explicitly presents nested permission", { skip: process.platform !== "darwin" }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "leilei-activity-swift-"));
  try {
    const runtime = fs.readFileSync(surface + "NativeLiveToolActivity.swift", "utf8");
    fs.writeFileSync(path.join(temporary, "State.swift"), runtime.slice(runtime.indexOf("enum NativeLiveToolCallState:"), runtime.indexOf("struct NativeLiveToolCallCard:")));
    fs.writeFileSync(path.join(temporary, "main.swift"), fs.readFileSync("tests/fixtures/native-live-question-activity.swift", "utf8") + "\n" + fs.readFileSync("tests/fixtures/native-live-activity-finish.swift", "utf8"));
    const projections = fs.readdirSync(surface).filter((name) => name.startsWith("NativeLiveTurnActivityProjection") && name.endsWith(".swift")).map((name) => surface + name);
    const presentation = surface + "NativeLiveInteractionHistoryPresentation.swift";
    const extra = fs.existsSync(presentation) ? [presentation] : [];
    const compiled = spawnSync("xcrun", ["swiftc", "-module-cache-path", path.join(temporary, "cache"), "ios/LeileiOS/LeileiOS/Infrastructure/NativeLiveRuntimeModels.swift", "ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveModels.swift", ...projections, ...extra, path.join(temporary, "State.swift"), path.join(temporary, "main.swift"), "-o", path.join(temporary, "check")], { encoding: "utf8", timeout: 120_000 });
    assert.equal(compiled.status, 0, compiled.stderr);
    const ran = spawnSync(path.join(temporary, "check"), [], { encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /Activity finish behavior passed/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
test("only tool-bound history receives nested permission presentation and pending cards are preserved", () => {
  const source = fs.readFileSync(surface + "NativeLiveToolActivity.swift", "utf8");
  const toolRow = source.slice(source.indexOf("struct NativeLiveToolActivityRow"), source.indexOf("enum NativeLiveToolCallState"));
  assert.match(toolRow, /NativeLiveInteractionHistoryRow\([\s\S]*presentation: \.nestedPermission/);
  assert.equal((source.match(/presentation: \.nestedPermission/g) ?? []).length, 1);
  assert.match(toolRow, /interaction\.isPending,[\s\S]*NativeLivePermissionInteractionCard/);
  const card = fs.readFileSync(surface + "NativeLiveInteractions.swift", "utf8");
  assert.match(card, /Button\("Allow"\)/);
  assert.match(card, /Button\("Deny", role: \.destructive\)/);
});


test("send_meme UI display name is unified as Send Sticker", () => {
  const source = fs.readFileSync(
    surface + "NativeLiveToolPresentation.swift",
    "utf8",
  );
  assert.match(
    source,
    /"mcp__leileios_memes__send_meme": "Send Sticker"/,
  );
  assert.match(
    source,
    /"Send Meme": "Send Sticker"/,
  );
  assert.match(
    source,
    /"mcp__leileios_memes__"/,
  );
});
