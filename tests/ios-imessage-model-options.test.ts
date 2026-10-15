import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("iMessage model settings opens a headerless second layer from the plus menu", () => {
  const source = readFileSync("ios/LeileiOS/LeileiOS/Chat/ChatComposer.swift", "utf8");
  const iMessage = source.slice(source.indexOf("private var iMessagePlusMenu"),source.indexOf("private var controlRow"));
  assert.match(iMessage, /Button\s*\{\s*isIMessageModelSettingsPresented = true\s*\} label:\s*\{\s*Label\("Model Settings", systemImage:/);
  assert.doesNotMatch(iMessage, /Menu\s*\{\s*Section\("Model"\)/);
  assert.match(iMessage, /\.popover\(\s*isPresented: \$isIMessageModelSettingsPresented/);
  assert.match(iMessage, /\.presentationCompactAdaptation\(\.popover\)/);
  const secondary = iMessage.slice(iMessage.indexOf("private var iMessageModelSettingsPanel"));
  assert.doesNotMatch(secondary, /Text\("Model Settings"\)|Label\("Model Settings"\)/);
  assert.match(secondary, /\.accessibilityIdentifier\("imessage-model-options"\)/);
  for (const expr of ["thinkingSelection.wrappedValue = option","$effort.wrappedValue = option","modelSelection.wrappedValue = option"]) {
    assert.ok(secondary.includes(expr),expr);
  }
  assert.match(secondary,/isIMessageModelSettingsPresented = false/g);
  assert.match(source,/case \.original:\s*sharedComposerContent/);
});
