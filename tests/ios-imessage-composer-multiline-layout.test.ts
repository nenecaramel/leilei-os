import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = "ios/LeileiOS/LeileiOS/Chat/";
const read = (filename: string) => readFileSync(root + filename, "utf8");

test("iMessage multiline draft is content-sized instead of filling the keyboard viewport", () => {
  const composer = read("ChatComposer.swift");
  const iMessage = composer.split("private var iMessageComposerContent: some View")[1]!
    .split("private var iMessagePlusMenu: some View")[0]!;

  // A vertical-axis TextField without fixedSize can greedily take the height
  // proposed by the keyboard's safe-area inset, even for a one-line draft.
  assert.match(iMessage, /\.lineLimit\(1\.\.\.6\)\s*\.fixedSize\(horizontal: false, vertical: true\)/);
  assert.match(composer, /@ScaledMetric\(relativeTo: \.body\) private var iMessageTextMaxHeight: CGFloat = 132/);
  assert.match(iMessage, /\.frame\(maxHeight: iMessageTextMaxHeight, alignment: \.topLeading\)/);

  // A capsule becomes an enormous oval on longer drafts; the corner radius
  // should stay constant as the composer grows upward.
  assert.match(iMessage, /\.glassEffect\(\.regular, in: RoundedRectangle\(cornerRadius: 22, style: \.continuous\)\)/);
  assert.doesNotMatch(iMessage, /\.glassEffect\(\.regular, in: Capsule\(\)\)/);
});

test("iMessage size fix leaves the original composer and shared actions intact", () => {
  const composer = read("ChatComposer.swift");
  const original = composer.split("private var sharedComposerContent: some View")[1]!
    .split("// iMessage shell:")[0]!;
  assert.match(original, /NativeLiveComposerTextInput\(/);
  assert.match(original, /controlRow/);
  assert.match(composer, /onMidTurnInput\?\(normalized\)/);
  assert.match(composer, /onInterrupt\?\(\)/);
  assert.match(composer, /onSend\?\(\)/);
});
