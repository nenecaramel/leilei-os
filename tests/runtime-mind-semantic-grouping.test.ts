import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MindSemanticGroupingService,
  type MindSemanticGroupingPort,
  type MindSemanticThreadGroup,
} from "../src/domains/runtime/mind-semantic-grouping.js";

class Port implements MindSemanticGroupingPort {
  matches: { queryStateId: string; candidateStateId: string; score: number }[] = [];
  staged: unknown[] = [];

  async listCompletedMatches() {
    return this.matches;
  }

  async stage(input: unknown) {
    this.staged.push(input);
    return true;
  }
}

const group = (
  threadKey: string,
  anchorStateId: string,
  anchorText: string,
  createdAt: string,
  newThread: boolean,
): MindSemanticThreadGroup => ({
  threadKey,
  anchorStateId,
  anchorText,
  createdAt,
  newThread,
});

test("completed high-confidence semantic score merges the newer thread into the older canonical thread", async () => {
  const port = new Port();
  port.matches = [{
    queryStateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    candidateStateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    score: 0.93,
  }];
  const service = new MindSemanticGroupingService(port, {
    threshold: 0.88,
    candidateLimit: 32,
  });
  const result = await service.reconcile({
    userId: "u1",
    subjectId: "G",
    kind: "drive",
    groups: [
      group("older", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "finish runtime cleanup", "2026-09-26T10:00:00.000Z", false),
      group("newer", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "complete backend cleanup", "2026-09-27T00:00:00.000Z", true),
    ],
  });

  assert.equal(result.canonicalThreadKeyByThread.get("older"), "older");
  assert.equal(result.canonicalThreadKeyByThread.get("newer"), "older");
});

test("new semantic thread stages an E5 comparison snapshot but remains exact until a score is durable", async () => {
  const port = new Port();
  const service = new MindSemanticGroupingService(port, {
    threshold: 0.88,
    candidateLimit: 32,
  });
  const result = await service.reconcile({
    userId: "u1",
    subjectId: "G",
    kind: "drive",
    groups: [
      group("older", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "finish runtime cleanup", "2026-09-26T10:00:00.000Z", false),
      group("newer", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "complete backend cleanup", "2026-09-27T00:00:00.000Z", true),
    ],
  });

  assert.equal(result.canonicalThreadKeyByThread.get("newer"), "newer");
  assert.equal(result.staged, 1);
  assert.equal(port.staged.length, 1);
  assert.deepEqual(port.staged[0], {
    userId: "u1",
    subjectId: "G",
    kind: "drive",
    queryStateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    query: "complete backend cleanup",
    candidates: [{
      stateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "drive",
      text: "finish runtime cleanup",
    }],
  });
});


test("an existing unmerged thread can stage a semantic comparison on a later maintenance opportunity", async () => {
  const port = new Port();
  const service = new MindSemanticGroupingService(port, {
    threshold: 0.88,
    candidateLimit: 32,
  });

  const result = await service.reconcile({
    userId: "u1",
    subjectId: "G",
    kind: "drive",
    groups: [
      group("older", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "finish runtime cleanup", "2026-09-26T10:00:00.000Z", false),
      group("existing", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "complete backend cleanup", "2026-09-27T00:00:00.000Z", false),
    ],
  });

  assert.equal(result.staged, 1);
  assert.equal(port.staged.length, 1);
});


test("process runtime exposes grouping repository to the internal relay only when configured", () => {
  const source = readFileSync(
    new URL("../src/app/process-runtime.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /\.\.\.\(mindSemanticGroupingRepository[\s\S]*mindSemanticGrouping:[\s\S]*mindSemanticGroupingRepository/,
  );
});
