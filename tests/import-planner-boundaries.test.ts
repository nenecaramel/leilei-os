import assert from "node:assert/strict";
import test from "node:test";
import { buildImportPlan } from "../src/domains/import/import-planner.js";
import { hashCanonical } from "../src/domains/import/import-canonical.js";
import { parseImportPackage } from "../src/domains/import/import-schema.js";
import type { ImportCurrentState } from "../src/domains/import/import-planner.js";
import {
  USER_ID,
  diary,
  diaryComment,
  todo,
  mindState,
  conversationBundle,
  universeBundle,
  watermarkOnlyContinuity,
  v4PackageBytes,
} from "./helpers/import-service-fixtures.js";

const data = {
  diary: [diary],
  diary_comments: [diaryComment],
  todo: [todo],
  mind: [mindState],
  conversations: conversationBundle,
  universe: universeBundle,
  mind_continuity: watermarkOnlyContinuity,
};
const parsed = parseImportPackage(v4PackageBytes(data));
const empty: ImportCurrentState = { diary: [], todo: [] };
const duplicate: ImportCurrentState = { ...data };
const cases = [
  { name: "mixed-create", current: empty },
  { name: "mixed-duplicate", current: duplicate },
  {
    name: "mixed-conflict",
    current: {
      ...duplicate,
      diary: [{ ...diary, content: "Changed" }],
      mind: [{ ...mindState, updated_at: "2026-08-15T00:00:00.000Z" }],
      conversations: {
        ...conversationBundle,
        messages: conversationBundle.messages.map((message) => ({
          ...message,
          updated_at: "2026-08-15T00:00:00.000Z",
        })),
      },
    },
  },
  { name: "foreign-diary", current: { ...empty, foreign_diary_ids: new Set([diary.id]) } },
  { name: "foreign-memory", current: { ...empty, foreign_mind_ids: new Set([mindState.id]) } },
  {
    name: "foreign-conversation",
    current: {
      ...empty,
      foreign_conversation_ids: new Set(conversationBundle.conversations.map((record) => record.id)),
    },
  },
  {
    name: "foreign-message",
    current: {
      ...empty,
      foreign_conversation_message_ids: new Set(conversationBundle.messages.map((record) => record.id)),
    },
  },
  {
    name: "foreign-block",
    current: {
      ...empty,
      foreign_conversation_content_block_ids: new Set(conversationBundle.content_blocks.map((record) => record.id)),
    },
  },
  {
    name: "foreign-attachment",
    current: {
      ...empty,
      foreign_conversation_attachment_ids: new Set(conversationBundle.attachments.map((record) => record.id)),
    },
  },
  {
    name: "foreign-checkpoint",
    current: {
      ...empty,
      foreign_conversation_checkpoint_ids: new Set(conversationBundle.provider_checkpoints.map((record) => record.id)),
    },
  },
  {
    name: "native-live-conversation",
    current: {
      ...empty,
      native_live_conversation_ids: new Set(conversationBundle.conversations.map((record) => record.id)),
    },
  },
  {
    name: "partial-current-conversation",
    current: {
      ...empty,
      conversations: {
        ...conversationBundle,
        messages: conversationBundle.messages.slice(0, 1),
        content_blocks: [],
        attachments: [],
        provider_checkpoints: [],
      },
    },
  },
] satisfies { name: string; current: ImportCurrentState }[];

// Captured from main 861da7be before extraction, including records, order,
// classifications, summary, current hashes, preview fingerprint and can_execute.
const expectedHashes: Record<string, string> = {
  "mixed-create": "c8f67cd688567a2757a9159f781e20788048104bc02d5d9171742a009b819d03",
  "mixed-duplicate": "062ededbbee9321dd314f4ac9126ee49f89dd6f57f72b52afd8252503f834d51",
  "mixed-conflict": "c1224af6fd9d8916d762fa92df3917539a01c05c4f2c00627533c2f6003e4e91",
  "foreign-diary": "b6ff044f5bf2650b56059cde29f64cb726619e877db890bbe04d37f7b73c9216",
  "foreign-memory": "d5d30b685734cecdab7d1adec79db0c7a799101b4b4fe46866a1b7b483598ae8",
  "foreign-conversation": "21055493aa1958be1a4f91ca24affebcece34d3b3f3731167b0489fef36f062d",
  "foreign-message": "b85f0f683c0a5d66246cbd803821521c80078422499e6aa74f4ca5c9f10f82c8",
  "foreign-block": "314a60daa3eacf67898d2329e173312eaa6b712b39b636a8df60d7ae1afe288c",
  "foreign-attachment": "c286a4aedfbf009f10ab3a143c5e208f88a80f13bfb0db6ce74a352a841fbf64",
  "foreign-checkpoint": "522547b04d2e274b7e2a4588905237f1d8f2bb26b647bc12e233d8b9a12d4027",
  "native-live-conversation": "c8f67cd688567a2757a9159f781e20788048104bc02d5d9171742a009b819d03",
  "partial-current-conversation": "6891a5c654329234ea990cd5870addfec3e73432ad9736a49e38abb7f15af0b8",
};
for (const row of cases) {
  test(`mixed import planning preserves ${row.name}`, () => {
    const input = structuredClone(parsed);
    const current = structuredClone(row.current);
    const plan = buildImportPlan(input, USER_ID, current);
    assert.equal(hashCanonical(plan), expectedHashes[row.name]);
    assert.deepEqual(input, parsed, "planning must not mutate the package");
    assert.deepEqual(current, row.current, "planning must not mutate current state");
  });
}
