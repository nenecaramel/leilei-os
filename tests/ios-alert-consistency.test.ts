import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
const root = "ios/LeileiOS/LeileiOS";
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith(".swift") ? [path.join(dir, entry.name)] : []);
}
test("App confirmations use native alerts, with no remaining bottom confirmation dialogs", () => {
  for (const file of files(root)) assert.doesNotMatch(readFileSync(file, "utf8"), /\.confirmationDialog\(/, file);
  const shared = read("Components/AppStateSurface.swift");
  assert.match(shared, /Button\(cancelTitle, role: \.cancel\)/);
  assert.match(shared, /cancelTitle: String = "Cancel"/);
  assert.match(shared, /func appFailureAlert\(/);
  assert.match(shared, /\.alert\("Failed", isPresented: isPresented\)/);
});
test("Every non-input direct alert has explicit explanatory text", () => {
  const owner = read("Pages/UniverseNodeSheet.swift");
  assert.match(owner, /\.alert\(/);
  assert.match(owner, /Text\(confirmationMessage\)/);
  assert.match(owner, /Button\(confirmationCancelTitle, role: \.cancel\)/);
  const navigation = read("Navigation/PageContainer.swift");
  assert.match(navigation, /\.alert\(\s*"Rename"/);
  assert.match(navigation, /TextField\("New name", text: \$renameTitle\)/);
  assert.match(navigation, /Text\("Enter a new name"\)/);
  assert.equal((navigation.match(/\.alert\(/g) ?? []).length, 1);
  for (const file of files(root)) {
    if (file.endsWith("AppStateSurface.swift") || file.endsWith("UniverseNodeSheet.swift") || file.endsWith("PageContainer.swift")) continue;
    assert.doesNotMatch(readFileSync(file, "utf8"), /\.alert\(/, file);
  }
});
