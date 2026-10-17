import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = "ios/LeileiOS/LeileiOS/Chat/";
const read = (filename: string) => readFileSync(root + filename, "utf8");

test("iMessage composer explicitly measures draft height, including an empty one-line draft", () => {
  const composer = read("ChatComposer.swift");
  const iMessage = composer.split("private var iMessageComposerContent: some View")[1]!
    .split("private var iMessageInputHeight: CGFloat")[0]!;
  const sizing = composer.split("private var iMessageInputHeight: CGFloat")[1]!
    .split("private var iMessagePlusMenu: some View")[0]!;

  // Regression: a flexible maxHeight combined with fixedSize still gave an
  // empty TextField ~160pt, as seen in the 21:43 device screenshot.
  assert.match(iMessage, /\.lineLimit\(1\.\.\.6\)/);
  assert.match(iMessage, /\.frame\(height: iMessageInputHeight, alignment: \.topLeading\)/);
  assert.match(iMessage, /\.onGeometryChange\(for: CGFloat\.self\)/);
  assert.doesNotMatch(iMessage, /\.fixedSize\(horizontal: false, vertical: true\)/);
  assert.doesNotMatch(iMessage, /\.frame\(maxHeight:/);

  assert.match(sizing, /text\.isEmpty \? " " : text \+ "\\u\{200B\}"/);
  assert.match(sizing, /content\.boundingRect\(/);
  assert.match(sizing, /iMessageInputWidth - 2/);
  assert.match(sizing, /let minimum = ceil\(font\.lineHeight\)/);
  assert.match(sizing, /let maximum = min\(iMessageTextMaxHeight, ceil\(font\.lineHeight \* 6\)\)/);
  assert.match(sizing, /return min\(max\(ceil\(measured\.height\), minimum\), maximum\)/);
  assert.match(iMessage, /\.glassEffect\(\.regular, in: RoundedRectangle\(cornerRadius: 22, style: \.continuous\)\)/);
});

test("iMessage sizing regression fix leaves original appearance and action ownership intact", () => {
  const composer = read("ChatComposer.swift");
  const original = composer.split("private var sharedComposerContent: some View")[1]!
    .split("// iMessage shell:")[0]!;
  assert.match(original, /NativeLiveComposerTextInput\(/);
  assert.match(original, /controlRow/);
  assert.match(composer, /onMidTurnInput\?\(normalized\)/);
  assert.match(composer, /onInterrupt\?\(\)/);
  assert.match(composer, /onSend\?\(\)/);
});
