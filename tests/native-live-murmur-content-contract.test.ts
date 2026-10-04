import assert from "node:assert/strict";
import test from "node:test";
import {
  readableContentData,
  storedContentKind,
  storedContentPayload,
} from "../src/domains/conversation/native-live-content-contract.js";

test("murmur round-trips through unknown storage without becoming canonical text", () => {
  assert.equal(storedContentKind("murmur"), "unknown");
  assert.deepEqual(
    storedContentPayload("murmur", null),
    {
      schema_version: 1,
      identity: "murmur",
    },
  );
  assert.deepEqual(
    readableContentData(
      "unknown",
      "murmur",
      "private aside",
      {
        schema_version: 1,
        identity: "murmur",
      },
    ),
    {
      kind: "murmur",
      text: "private aside",
      payload: {
        schema_version: 1,
        identity: "murmur",
      },
    },
  );
});
