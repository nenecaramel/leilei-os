import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const surface = "ios/LeileiOS/LeileiOS/Chat/MessageSurface/";

test("ElevenLabs stays in the assistant result surface, not tool history or backend", () => {
  const row = readFileSync(surface + "NativeLiveAssistantTurnRow.swift", "utf8");
  const spotify = readFileSync(surface + "NativeLiveSpotifyPresentation.swift", "utf8");
  const audio = readFileSync(surface + "NativeLiveAudioAttachmentBubble.swift", "utf8");
  const source = readFileSync(surface + "NativeLiveElevenLabsResultSurface.swift", "utf8");
  const parse = readFileSync(surface + "NativeLiveElevenLabsPresentation.swift", "utf8");
  assert.match(row, /activityArea\s+NativeLiveVisibleThinkingSurface\(items: turn\.visibleThinking\)\s+spotifyResultArea\s+elevenLabsResultArea\s+NativeLiveMessagePresentationView/);
  assert.match(row, /NativeLiveElevenLabsResultProjector\.project\(tools: turn\.activityProjection\.tools\)/);
  assert.match(source, /TimelineView\(\.periodic\(from: \.now, by: 30\)\)/);
  assert.match(source, /NativeLiveVoiceBubbleGeometry\.audioWidth/);
  assert.match(source, /NativeLiveAudioPlaybackState/);
  assert.match(source, /NativeLiveMediaTransport\.session\.data\(for: request\)/);
  assert.match(source, /playback\.deactivate\(\)/);
  assert.match(parse, /creative_get_flow_run_status/);
  assert.match(parse, /generation\["duration_secs"\]/);
  assert.match(parse, /matchingMedia\?\["url"\]/);
  assert.doesNotMatch(source + parse, /send_file|createAttachmentUploadSlot|writeFile|uploadBytes/);
  assert.doesNotMatch(spotify + audio, /NativeLiveElevenLabs/);
});

test("real Swift parses completed tool result, deduplicates polling and rejects expired/untrusted links", {
  skip: spawnSync(process.platform === "darwin" ? "xcrun" : "swiftc",
    process.platform === "darwin" ? ["swiftc", "--version"] : ["--version"],
    { encoding: "utf8", timeout: 10000 }).status !== 0,
}, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ios-elevenlabs-result-"));
  try {
    const files = [
      surface + "NativeLiveElevenLabsPresentation.swift",
      "tests/fixtures/ios-elevenlabs-result.swift"
    ];
    const command = process.platform === "darwin" ? "xcrun" : "swiftc";
    const args = process.platform === "darwin"
      ? ["swiftc", "-parse-as-library", ...files, "-o", path.join(dir, "check")]
      : ["-parse-as-library", ...files, "-o", path.join(dir, "check")];
    const compiled = spawnSync(command, args, { encoding: "utf8", timeout: 120000 });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const executed = spawnSync(path.join(dir, "check"), [], { encoding: "utf8", timeout: 30000 });
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    assert.match(executed.stdout, /ElevenLabs projection PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
