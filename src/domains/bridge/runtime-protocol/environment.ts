import type {
  NativeLiveRuntimeEnvironment,
  NativeLiveRuntimeEnvironmentMcpServer,
  NativeLiveRuntimeEnvironmentPlugin,
  NativeLiveRuntimeEnvironmentPluginError,
  NativeLiveRuntimeEnvironmentFastMode,
} from "./types.js";
import {
  requireRecord,
  requireExactKeys,
  boundedNullableString,
  boundedStringList,
  NativeLiveRuntimeProtocolError,
} from "./parsing.js";

export function parseNativeLiveRuntimeEnvironment(
  value: unknown,
): NativeLiveRuntimeEnvironment {
  const body = requireRecord(value);
  requireExactKeys(body, [
    "model",
    "cwd",
    "tools",
    "mcp_servers",
    "permission_mode",
    "slash_commands",
    "terminal_slash_commands",
    "api_key_source",
    "output_style",
    "agents",
    "betas",
    "claude_code_version",
    "sdk_version",
    "skills",
    "plugins",
    "plugin_errors",
    "effort",
    "capabilities",
    "fast_mode",
  ]);

  return {
    model: boundedNullableString(body.model, "environment.model", 512),
    cwd: boundedNullableString(body.cwd, "environment.cwd", 2_048),
    tools: boundedStringList(body.tools, "environment.tools", 256, 512),
    mcp_servers: parseNamedStatusList(
      body.mcp_servers,
      "environment.mcp_servers",
      64,
    ),
    permission_mode: boundedNullableString(
      body.permission_mode,
      "environment.permission_mode",
      128,
    ),
    slash_commands: boundedStringList(
      body.slash_commands,
      "environment.slash_commands",
      256,
      512,
    ),
    terminal_slash_commands: boundedStringList(
      body.terminal_slash_commands,
      "environment.terminal_slash_commands",
      256,
      512,
    ),
    api_key_source: boundedNullableString(
      body.api_key_source,
      "environment.api_key_source",
      128,
    ),
    output_style: boundedNullableString(
      body.output_style,
      "environment.output_style",
      128,
    ),
    agents: boundedStringList(
      body.agents,
      "environment.agents",
      128,
      512,
    ),
    betas: boundedStringList(
      body.betas,
      "environment.betas",
      64,
      256,
    ),
    claude_code_version: boundedNullableString(
      body.claude_code_version,
      "environment.claude_code_version",
      128,
    ),
    sdk_version: boundedNullableString(
      body.sdk_version,
      "environment.sdk_version",
      128,
    ),
    skills: boundedStringList(
      body.skills,
      "environment.skills",
      128,
      512,
    ),
    plugins: parsePluginList(body.plugins),
    plugin_errors: parsePluginErrorList(body.plugin_errors),
    effort: boundedNullableString(
      body.effort,
      "environment.effort",
      64,
    ),
    capabilities: boundedStringList(
      body.capabilities,
      "environment.capabilities",
      128,
      256,
    ),
    fast_mode:
      body.fast_mode === null
        ? null
        : parseFastMode(body.fast_mode),
  };
}

function parseNamedStatusList(
  value: unknown,
  field: string,
  maxItems: number,
): NativeLiveRuntimeEnvironmentMcpServer[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new NativeLiveRuntimeProtocolError(
      `${field} must contain at most ${maxItems} items.`,
    );
  }
  return value.map((item, index) => {
    const body = requireRecord(item);
    requireExactKeys(body, ["name", "status", "source"]);
    return {
      name: boundedNullableString(
        body.name,
        `${field}[${index}].name`,
        256,
      ),
      status: boundedNullableString(
        body.status,
        `${field}[${index}].status`,
        256,
      ),
      source: boundedNullableString(
        body.source,
        `${field}[${index}].source`,
        512,
      ),
    };
  });
}

function parsePluginList(
  value: unknown,
): NativeLiveRuntimeEnvironmentPlugin[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new NativeLiveRuntimeProtocolError(
      "environment.plugins must contain at most 128 items.",
    );
  }
  return value.map((item, index) => {
    const body = requireRecord(item);
    requireExactKeys(body, ["name", "path"]);
    return {
      name: boundedNullableString(
        body.name,
        `environment.plugins[${index}].name`,
        512,
      ),
      path: boundedNullableString(
        body.path,
        `environment.plugins[${index}].path`,
        2_048,
      ),
    };
  });
}

function parsePluginErrorList(
  value: unknown,
): NativeLiveRuntimeEnvironmentPluginError[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new NativeLiveRuntimeProtocolError(
      "environment.plugin_errors must contain at most 64 items.",
    );
  }
  return value.map((item, index) => {
    const body = requireRecord(item);
    requireExactKeys(body, ["plugin", "type", "message", "path"]);
    return {
      plugin: boundedNullableString(
        body.plugin,
        `environment.plugin_errors[${index}].plugin`,
        512,
      ),
      type: boundedNullableString(
        body.type,
        `environment.plugin_errors[${index}].type`,
        256,
      ),
      message: boundedNullableString(
        body.message,
        `environment.plugin_errors[${index}].message`,
        2_000,
      ),
      path: boundedNullableString(
        body.path,
        `environment.plugin_errors[${index}].path`,
        2_048,
      ),
    };
  });
}

function parseFastMode(
  value: unknown,
): NativeLiveRuntimeEnvironmentFastMode {
  const body = requireRecord(value);
  requireExactKeys(body, ["state", "disabled_reason"]);
  return {
    state: boundedNullableString(
      body.state,
      "environment.fast_mode.state",
      128,
    ),
    disabled_reason: boundedNullableString(
      body.disabled_reason,
      "environment.fast_mode.disabled_reason",
      512,
    ),
  };
}
