import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = "ios/LeileiOS/LeileiOS/App/";
const boundaries = [
  ["AuthCoordination", "restoreAuthState", "reauthorize", "refreshConnectivity"],
  ["ConversationCoordination", "refreshNativeLiveConversations", "refreshNativeLiveCurrentPath", "loadOlderNativeLiveMessages"],
  ["NativeLiveTurnController", "sendNativeLiveMessage", "retryNativeLiveMessage", "editNativeLiveMessage", "waitForNativeLiveTurn"],
  ["NativeLiveRuntimeStore", "refreshNativeLiveRuntimeSurface", "resolveNativeLiveRuntimeInteraction", "interruptNativeLiveTurn"],
  ["NativeLiveAttachmentCoordination", "uploadNativeLiveAttachment", "nativeLiveAttachmentBytes"],
  ["MessageProjectionCoordination", "refreshMindWrites", "refreshAlbumSaves"],
] as const;

for (const [file, ...methods] of boundaries) {
  test(`iOS ${file} is a separate client coordination boundary`, () => {
    const path = `${root}${file}.swift`;
    assert.ok(fs.existsSync(path), `missing ${path}`);
    const source = fs.readFileSync(path, "utf8");
    assert.match(source, /extension AppModel/);
    for (const method of methods) {
      assert.match(source, new RegExp(`func ${method}\\b`));
      assert.doesNotMatch(fs.readFileSync(`${root}AppModel.swift`, "utf8"), new RegExp(`func ${method}\\b`));
    }
    // One observable state owner; extraction must not introduce a second authority.
    assert.doesNotMatch(source, /@Published|class \w+: ObservableObject|UserDefaults\.standard\.set\([^)]*forKey: "/);
  });
}

test("AppModel remains the existing observable composition and state owner", () => {
  const source = fs.readFileSync(`${root}AppModel.swift`, "utf8");
  assert.match(source, /@MainActor\s+final class AppModel: ObservableObject/);
  assert.match(source, /@Published[^\n]*nativeLiveCurrentPath/);
  assert.match(source, /let authSession: AuthSessionController/);
  assert.match(source, /let api: LeileiAPIClient/);
  assert.match(source, /self\.api = LeileiAPIClient\(/);
  assert.match(source, /"activeNativeLiveConversationID"/);
});
