import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveRelayContractError,
  parseNativeLiveRelayRequest,
} from "../src/domains/bridge/native-live-relay-contract.js";

const requestId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const headId = "33333333-3333-4333-8333-333333333333";
const userMessageId = "44444444-4444-4444-8444-444444444444";

test("native live send requires explicit Claude target and optimistic head identity", () => {
  assert.deepEqual(
    parseNativeLiveRelayRequest({
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversationId,
      expected_head_message_id: headId,
      text: "  hello\r\nworld  ",
    }),
    {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversationId,
      expected_head_message_id: headId,
      text: "hello\nworld",
    },
  );

  assert.deepEqual(
    parseNativeLiveRelayRequest({
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversationId,
      expected_head_message_id: null,
      text: "first",
    }),
    {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversationId,
      expected_head_message_id: null,
      text: "first",
    },
  );
});

test("send and edit accept bounded attachment ids including attachment-only send", () => {
  const attachmentId = "55555555-5555-4555-8555-555555555555";
  assert.deepEqual(
    parseNativeLiveRelayRequest({
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversationId,
      expected_head_message_id: headId,
      text: "",
      attachment_ids: [attachmentId],
    }),
    {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversationId,
      expected_head_message_id: headId,
      text: "",
      attachment_ids: [attachmentId],
    },
  );

  assert.deepEqual(
    parseNativeLiveRelayRequest({
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "edit",
      conversation_id: conversationId,
      target_user_message_id: userMessageId,
      text: "",
      attachment_ids: [],
    }).attachment_ids,
    [],
  );

  assert.throws(
    () => parseNativeLiveRelayRequest({
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversationId,
      expected_head_message_id: headId,
      text: "",
    }),
    /between 1 and 4000/u,
  );
});

test("retry carries only the historical user branch point", () => {
  assert.deepEqual(
    parseNativeLiveRelayRequest({
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "retry",
      conversation_id: conversationId,
      target_user_message_id: userMessageId,
    }),
    {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "retry",
      conversation_id: conversationId,
      target_user_message_id: userMessageId,
    },
  );
});

test("edit carries historical user branch point plus replacement text", () => {
  assert.deepEqual(
    parseNativeLiveRelayRequest({
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "edit",
      conversation_id: conversationId,
      target_user_message_id: userMessageId,
      text: " edited ",
    }),
    {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "edit",
      conversation_id: conversationId,
      target_user_message_id: userMessageId,
      text: "edited",
    },
  );
});

test("operation shapes are strict so send, retry, and edit cannot blur together", () => {
  assert.throws(
    () =>
      parseNativeLiveRelayRequest({
        dispatch_target: "claude_code",
        request_id: requestId,
        operation: "retry",
        conversation_id: conversationId,
        target_user_message_id: userMessageId,
        text: "should not be accepted",
      }),
    /Unexpected native live relay field: text/,
  );

  assert.throws(
    () =>
      parseNativeLiveRelayRequest({
        dispatch_target: "claude_code",
        request_id: requestId,
        operation: "send",
        conversation_id: conversationId,
        expected_head_message_id: headId,
      }),
    /Missing native live relay field: text/,
  );
});

test("native live requests reject unsupported targets and malformed identifiers", () => {
  assert.throws(
    () =>
      parseNativeLiveRelayRequest({
        dispatch_target: "unsupported_host",
        request_id: requestId,
        operation: "send",
        conversation_id: conversationId,
        expected_head_message_id: null,
        text: "hello",
      }),
    /must target Claude Code/,
  );

  assert.throws(
    () =>
      parseNativeLiveRelayRequest({
        dispatch_target: "claude_code",
        request_id: "not-a-uuid",
        operation: "retry",
        conversation_id: conversationId,
        target_user_message_id: userMessageId,
      }),
    /request_id must be a UUID/,
  );
});


test("native live turns accept validated optional execution selection", () => {
  assert.deepEqual(
    parseNativeLiveRelayRequest({
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversationId,
      expected_head_message_id: headId,
      text: "hello",
      execution: {
        model: "claude-opus-5-5",
        thinking: "adaptive",
        effort: "medium",
      },
    }),
    {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversationId,
      expected_head_message_id: headId,
      text: "hello",
      execution: {
        model: "claude-opus-5-5",
        thinking: "adaptive",
        effort: "medium",
      },
    },
  );

  assert.deepEqual(
    parseNativeLiveRelayRequest({
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversationId,
      expected_head_message_id: headId,
      text: "opus 5",
      execution: {
        model: "claude-opus-5",
        thinking: "adaptive",
        effort: "max",
      },
    }).execution,
    {
      model: "claude-opus-5",
      thinking: "adaptive",
      effort: "max",
    },
  );

  assert.throws(
    () =>
      parseNativeLiveRelayRequest({
        dispatch_target: "claude_code",
        request_id: requestId,
        operation: "send",
        conversation_id: conversationId,
        expected_head_message_id: headId,
        text: "opus 5 disabled max",
        execution: {
          model: "claude-opus-5",
          thinking: "disabled",
          effort: "max",
        },
      }),
    /only supported up to effort=high/i,
  );

  assert.throws(
    () =>
      parseNativeLiveRelayRequest({
        dispatch_target: "claude_code",
        request_id: requestId,
        operation: "retry",
        conversation_id: conversationId,
        target_user_message_id: userMessageId,
        execution: {
          model: "claude-opus-4-6",
          effort: "xhigh",
        },
      }),
    /effort is not supported/i,
  );
});
