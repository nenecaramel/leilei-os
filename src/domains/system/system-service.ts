import type {
  SystemDataSummary,
  SystemLifecycleActivityRecord,
  SystemRepository,
  SystemToolActivityRecord,
} from "./system-repository.js";
import {
  ActiveUserAuthorizationError,
  requireActiveUser,
} from "../require-active-user.js";
import type {
  ClaudeAccountUsageReader,
  ClaudeAccountUsageSnapshot,
} from "../runtime/shared/claude-account-usage.js";

export type {
  SystemDataSummary,
  SystemLifecycleActivityRecord,
  SystemRepository,
  SystemToolActivityRecord,
} from "./system-repository.js";
export type {
  ClaudeAccountUsageSnapshot,
} from "../runtime/shared/claude-account-usage.js";

export type SystemConnections = {
  web_api: "online";
  public_mcp: "available";
  internal_mcp: "available" | "not_enabled";
};

export type SystemActivityItem = {
  id: string;
  occurred_at: string;
  label: string;
  source: "Web" | "MCP" | "Internal" | "System";
  outcome: "success" | "failed";
};

export type SystemServiceErrorCode = "USER_NOT_FOUND" | "USER_DISABLED";

export class SystemServiceError extends Error {
  constructor(public readonly code: SystemServiceErrorCode) {
    super("System data is unavailable for the authenticated user.");
    this.name = "SystemServiceError";
  }
}

const ACTIVITY_CANDIDATE_LIMIT = 100;
const FINAL_ACTIVITY_LIMIT = 50;

export class SystemService {
  constructor(
    private readonly repository: SystemRepository,
    private readonly options: {
      internalMcpEnabled?: boolean;
      claudeUsageReader?: ClaudeAccountUsageReader;
    } = {},
  ) {}

  async readConnections(userId: string): Promise<SystemConnections> {
    await this.requireActiveUser(userId);
    return {
      web_api: "online",
      public_mcp: "available",
      internal_mcp: this.options.internalMcpEnabled
        ? "available"
        : "not_enabled",
    };
  }

  async readDataSummary(userId: string): Promise<SystemDataSummary> {
    await this.requireActiveUser(userId);
    return this.repository.readDataSummary(userId);
  }

  async readClaudeUsage(
    userId: string,
  ): Promise<ClaudeAccountUsageSnapshot | null> {
    await this.requireActiveUser(userId);
    return this.options.claudeUsageReader?.readLatest(userId) ?? null;
  }

  async readActivity(userId: string): Promise<SystemActivityItem[]> {
    await this.requireActiveUser(userId);
    const [lifecycle, tools] = await Promise.all([
      this.repository.listLifecycleActivity(userId, ACTIVITY_CANDIDATE_LIMIT),
      this.repository.listToolActivity(userId, ACTIVITY_CANDIDATE_LIMIT),
    ]);

    return [...lifecycle.flatMap(normalizeLifecycle), ...tools.flatMap(normalizeTool)]
      .sort((left, right) => {
        const time = right.occurred_at.localeCompare(left.occurred_at);
        return time || right.id.localeCompare(left.id);
      })
      .slice(0, FINAL_ACTIVITY_LIMIT);
  }

  private async requireActiveUser(userId: string): Promise<void> {
    try {
      await requireActiveUser(this.repository, userId);
    } catch (error) {
      if (error instanceof ActiveUserAuthorizationError) {
        throw new SystemServiceError(error.code);
      }
      throw error;
    }
  }
}

const RESOURCE_LABELS: Record<string, string> = {
  diary: "Diary",
};

const ACTION_LABELS: Record<string, string> = {
  archive: "archived",
  restore: "restored",
  permanent_delete: "permanently deleted",
};

const TOOL_LABELS: Record<string, string> = {
  write_diary: "Diary created",
  toy_set: "Toy updated",
  toy_stop: "Toy stopped",
};

function normalizeLifecycle(
  event: SystemLifecycleActivityRecord,
): SystemActivityItem[] {
  const resource = RESOURCE_LABELS[event.resourceType];
  const action = ACTION_LABELS[event.action];
  const source = normalizeSource(event.actorType, event.channel);
  if (!resource || !action || !source) return [];

  return [{
    id: event.id,
    occurred_at: event.createdAt.toISOString(),
    label: `${resource} ${action}`,
    source,
    outcome: "success",
  }];
}

function normalizeTool(
  event: SystemToolActivityRecord,
): SystemActivityItem[] {
  if (event.source !== "mcp" && event.source !== "internal") return [];
  const baseLabel = TOOL_LABELS[event.toolName];
  if (!baseLabel) return [];
  return [{
    id: event.id,
    occurred_at: event.createdAt.toISOString(),
    label: event.status === "success"
      ? baseLabel
      : `${TOOL_FAILURE_PREFIXES[event.toolName] ?? baseLabel} failed`,
    source: event.source === "mcp" ? "MCP" : "Internal",
    outcome: event.status === "success" ? "success" : "failed",
  }];
}

const TOOL_FAILURE_PREFIXES: Record<string, string> = {
  write_diary: "Diary creation",
  toy_set: "Toy update",
  toy_stop: "Toy stop",
};

function normalizeSource(
  actorType: string,
  channel: string,
): SystemActivityItem["source"] | null {
  if (actorType === "system") return "System";
  if (channel === "web") return "Web";
  if (channel === "mcp") return "MCP";
  if (channel === "internal") return "Internal";
  return null;
}
