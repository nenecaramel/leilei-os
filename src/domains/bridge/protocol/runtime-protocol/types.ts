import type { NativeLiveNormalizedEvent } from "../../../conversation/native-live-conversation-orchestrator.js";
import type { NativeLiveExecutionSelection } from "../../turn/native-live-execution-selection.js";

export const NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION = 3 as const;

export const NATIVE_LIVE_RUNTIME_ATTACHMENT_PROTOCOL_VERSION = 2 as const;

export const NATIVE_LIVE_RUNTIME_LEGACY_PROTOCOL_VERSION = 1 as const;

export type NativeLiveRuntimeMode = "new" | "fork";

export type NativeLiveRuntimeAttachment = {
  attachment_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  kind: "image" | "file";
};

export type NativeLiveRuntimeOutputAttachmentMetadata = {
  attachment_id: string;
  duration_seconds: number;
};

export type NativeLiveRuntimeCommand = {
  protocol_version: 1 | 2 | 3;
  dispatch_target: "claude_code";
  prepare_id: string;
  request_id: string;
  operation: "send" | "retry" | "edit" | "wake";
  conversation_id: string;
  canonical_user_message_id: string | null;
  runtime_mode: NativeLiveRuntimeMode;
  parent_provider_session_id: string | null;
  workspace_id: string | null;
  expected_workspace_root: string | null;
  execution_selection?: NativeLiveExecutionSelection | null;
  attachments?: NativeLiveRuntimeAttachment[];
  prompt: string;
};

export type NativeLiveRuntimeFailureCode =
  | "CLAUDE_PROCESS_FAILED"
  | "MALFORMED_STREAM"
  | "ABORTED"
  | "INTERRUPTED"
  | "NO_PROVIDER_SESSION"
  | "PROVIDER_SESSION_CONFLICT"
  | "WORKSPACE_UNAVAILABLE"
  | "WORKSPACE_ROOT_MISMATCH"
  | "ATTACHMENT_UNAVAILABLE"
  | "RUNTIME_UNAVAILABLE";

export type NativeLiveRuntimeContextUsageCategory = {
  name: string | null;
  tokens: number | null;
  kind: string | null;
  is_deferred: boolean | null;
};

export type NativeLiveRuntimeContextUsage = {
  model: string | null;
  total_tokens: number | null;
  max_tokens: number | null;
  raw_max_tokens: number | null;
  percentage: number | null;
  categories: NativeLiveRuntimeContextUsageCategory[];
};

export type NativeLiveRuntimeExecutionCapability = {
  value: string | null;
  display_name: string | null;
  description: string | null;
  supports_effort: boolean | null;
  supported_effort_levels: string[];
  supports_adaptive_thinking: boolean | null;
  supports_fast_mode: boolean | null;
  supports_auto_mode: boolean | null;
};

export type NativeLiveRuntimeExecutionReadback = {
  requested: {
    model: string | null;
    thinking: string | null;
    effort: string | null;
  } | null;
  applied: {
    model: string | null;
    effort: string | null;
  };
  capability: NativeLiveRuntimeExecutionCapability | null;
};

export type NativeLiveRuntimeExecutionMetadata = {
  readback: NativeLiveRuntimeExecutionReadback;
  readback_error: "READBACK_UNAVAILABLE" | null;
};

export type NativeLiveRuntimeEnvironmentMcpServer = {
  name: string | null;
  status: string | null;
  source: string | null;
};

export type NativeLiveRuntimeEnvironmentPlugin = {
  name: string | null;
  path: string | null;
};

export type NativeLiveRuntimeEnvironmentPluginError = {
  plugin: string | null;
  type: string | null;
  message: string | null;
  path: string | null;
};

export type NativeLiveRuntimeEnvironmentFastMode = {
  state: string | null;
  disabled_reason: string | null;
};

export type NativeLiveRuntimeEnvironment = {
  model: string | null;
  cwd: string | null;
  tools: string[];
  mcp_servers: NativeLiveRuntimeEnvironmentMcpServer[];
  permission_mode: string | null;
  slash_commands: string[];
  terminal_slash_commands: string[];
  api_key_source: string | null;
  output_style: string | null;
  agents: string[];
  betas: string[];
  claude_code_version: string | null;
  sdk_version: string | null;
  skills: string[];
  plugins: NativeLiveRuntimeEnvironmentPlugin[];
  plugin_errors: NativeLiveRuntimeEnvironmentPluginError[];
  effort: string | null;
  capabilities: string[];
  fast_mode: NativeLiveRuntimeEnvironmentFastMode | null;
};

export type NativeLiveRuntimeResultPermissionDenial = {
  tool_name: string | null;
  tool_use_id: string | null;
  tool_input: Record<string, unknown> | null;
};

export type NativeLiveRuntimeResultLatency = {
  ttft_ms: number | null;
  ttft_stream_ms: number | null;
  time_to_request_ms: number | null;
  time_to_request_from_spawn_ms: number | null;
  time_origin_ms: number | null;
  warm_spare_claimed: boolean | null;
  first_content_frame_ms: number | null;
  first_stream_post_ms: number | null;
  first_stream_post_ack_ms: number | null;
  first_stream_post_wall_ms: number | null;
  first_text_post_ms: number | null;
  first_text_post_wall_ms: number | null;
  first_stream_post_queue_wait_ms: number | null;
  first_stream_post_queued_behind: number | null;
};

export type NativeLiveRuntimeResultTelemetry = {
  subtype: string | null;
  is_error: boolean | null;
  duration_ms: number | null;
  duration_api_ms: number | null;
  num_turns: number | null;
  queued_turn_count: number | null;
  stop_reason: string | null;
  terminal_reason: string | null;
  api_error_status: number | null;
  startup_failure_reason: string | null;
  fast_mode_state: string | null;
  fast_mode_disabled_reason: string | null;
  total_cost_usd: number | null;
  origin: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
  modelUsage: Record<string, unknown> | null;
  permission_denials: NativeLiveRuntimeResultPermissionDenial[];
  errors: string[];
  structured_output_present: boolean;
  structured_output?: Record<string, unknown> | null;
  deferred_tool_use_present: boolean;
  latency: NativeLiveRuntimeResultLatency;
};

export type NativeLiveRuntimeOutputResource = {
  source: "tool_result" | "task_notification";
  tool_use_id: string | null;
  task_id: string | null;
  uri: string;
  name: string | null;
  title: string | null;
  description: string | null;
  mime_type: string | null;
  size: number | null;
  annotations: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

export type NativeLiveRuntimeVcsChange = {
  mutation_kind: string;
  cwd: string;
  branch: string | null;
};

export type NativeLiveRuntimeSessionStoreHealth = {
  provider: "claude_agent_sdk";
  configured: boolean;
  mode: "new" | "resume" | "fork";
  session_id: string | null;
  parent_session_id: string | null;
  project_key: string;
  cwd: string;
  parent_local_available: boolean | null;
  parent_status_before: "complete" | "incomplete" | null;
  backfill_status:
    | "not_needed"
    | "complete"
    | "failed"
    | "unavailable";
  backfill_failure_reason: string | null;
  mirror_status: "ok" | "error" | "not_observed";
  mirror_failure_reason: string | null;
  status_after: "complete" | "incomplete" | null;
  status_failure_reason: string | null;
};

export type NativeLiveRuntimeMetadata = {
  context_usage: NativeLiveRuntimeContextUsage | null;
  execution?: NativeLiveRuntimeExecutionMetadata | null;
  environment?: NativeLiveRuntimeEnvironment | null;
  result?: NativeLiveRuntimeResultTelemetry | null;
  output_resources?: NativeLiveRuntimeOutputResource[];
  vcs_changes?: NativeLiveRuntimeVcsChange[];
  session_store?: NativeLiveRuntimeSessionStoreHealth | null;
};

export type NativeLiveRuntimeExecutionResult =
  | {
      protocol_version: 1 | 2 | 3;
      prepare_id: string;
      request_id: string;
      conversation_id: string;
      status: "success";
      provider_session_id: string;
      workspace_id: string | null;
      effective_workspace_root: string | null;
      normalized_events: NativeLiveNormalizedEvent[];
      output_attachment_ids?: string[];
      output_attachment_metadata?: NativeLiveRuntimeOutputAttachmentMetadata[];
      runtime_metadata?: NativeLiveRuntimeMetadata | null;
    }
  | {
      protocol_version: 1 | 2 | 3;
      prepare_id: string;
      request_id: string;
      conversation_id: string;
      status: "failure";
      error_code: NativeLiveRuntimeFailureCode;
      runtime_metadata?: NativeLiveRuntimeMetadata | null;
    };
