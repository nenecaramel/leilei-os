import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = "ios/LeileiOS/LeileiOS/Chat/";
const assembler = readFileSync(root + "MessageSurface/NativeLiveConversationPresentationAssembler.swift", "utf8");
const scroll = readFileSync(root + "NativeLiveMessageSurface.swift", "utf8");
const swiftCases = readFileSync("tests/fixtures/native-live-turn-lifecycle.swift", "utf8");

test("early canonical replies reuse the prepared operation ID instead of drawing a second provisional turn", () => {
  const owner = assembler.split("func unattributedPrepareID(")[1]!.split("func isRuntimeCanonicalAnswer")[0]!;
  assert.match(owner, /message\.activity\?\.prepareId == nil/);
  assert.match(owner, /binding\.userMessageID == parent/);
  assert.match(owner, /binding\.targetUserMessageID != parent/);
  assert.match(owner, /known\.targetUserMessageID != parent/);
  assert.match(owner, /runtime\.operation == "send"/);
  assert.doesNotMatch(owner, /\.text\s*==|\.createdAt\s*==/);
  assert.match(assembler, /let prepare = message\.activity\?\.prepareId \?\? inferredPrepare/);
  assert.match(assembler, /now:now,inferredPrepareID:inferredPrepare/);
  assert.match(assembler, /let prepare = runtime\?\.prepareID \?\? message\?\.activity\?\.prepareId \?\? inferredPrepareID/);
  assert.match(assembler, /if let inferredPrepare, let known = identities\.binding\(prepareID:inferredPrepare\) \{ stable = known\.stableAssistantID \}/);
  assert.equal((assembler.match(/isRuntimeCanonicalAnswer\(\$0,prepareID:runtime\.prepareID\)/g) ?? []).length, 2);
});

test("actual Swift turn lifecycle fixture asserts stable row count, ID and canonical text before activity attribution", () => {
  for (const scenario of [
    "unattributed canonical cannot double the pending answer",
    "canonical text does not regress to the shorter partial",
    "clearing pending cannot hide/recreate the same answer",
    "runtime teardown cannot remount an unattributed canonical assistant",
    "unattributed canonical cannot reset its turn timestamp when runtime stops",
    "fresh Send recovery cannot create second row without prepare attribution",
    "older Retry failed refresh never reintroduces downstream old branch",
  ]) {
    assert.ok(swiftCases.includes(scenario), scenario);
  }
  assert.match(swiftCases, /oldRetryRuntime\.operation = "retry"/);
});

test("scroll follow observes only positive growth while the prior viewport was at its bottom", () => {
  assert.match(scroll, /metrics\.height > old\.height && old\.nearBottom && scrollState\.shouldFollowContent && preservedAnchor == nil/);
  assert.doesNotMatch(scroll, /old\.height != metrics\.height && scrollState\.shouldFollowContent/);
});
