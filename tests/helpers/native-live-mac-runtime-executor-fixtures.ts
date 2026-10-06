

export const prepareId = "11111111-1111-4111-8111-111111111111";

export const requestId = "22222222-2222-4222-8222-222222222222";

export const conversationId = "33333333-3333-4333-8333-333333333333";

export const userMessageId = "44444444-4444-4444-8444-444444444444";

export const resultTelemetry = {
  subtype: "success",
  is_error: false,
  duration_ms: 2500,
  duration_api_ms: 1800,
  num_turns: 2,
  queued_turn_count: 0,
  stop_reason: "end_turn",
  terminal_reason: "completed",
  api_error_status: null,
  startup_failure_reason: null,
  fast_mode_state: "off",
  fast_mode_disabled_reason: null,
  total_cost_usd: 0.25,
  origin: { kind: "user" },
  usage: {
    input_tokens: 11,
    output_tokens: 9,
    output_tokens_details: {
      thinking_tokens: 6,
    },
  },
  modelUsage: {
    "claude-opus-5-5": {
      inputTokens: 11,
      outputTokens: 9,
      thinkingTokens: 6,
      costUSD: 0.25,
    },
  },
  permission_denials: [],
  errors: [],
  structured_output_present: false,
  deferred_tool_use_present: false,
  latency: {
    ttft_ms: 300,
    ttft_stream_ms: 320,
    time_to_request_ms: 100,
    time_to_request_from_spawn_ms: 120,
    time_origin_ms: 123456,
    warm_spare_claimed: false,
    first_content_frame_ms: 290,
    first_stream_post_ms: 310,
    first_stream_post_ack_ms: 315,
    first_stream_post_wall_ms: 318,
    first_text_post_ms: 330,
    first_text_post_wall_ms: 335,
    first_stream_post_queue_wait_ms: 7,
    first_stream_post_queued_behind: 1,
  },
};

export function command(
  input: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    protocol_version: 4,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "new",
    parent_provider_session_id: null,
    expected_working_directory: null,
    prompt: "hello",
    ...input,
  };
}
