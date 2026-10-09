import type {
  SystemDataSummary,
  SystemRepository,
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
  SystemRepository,
} from "./system-repository.js";
export type {
  ClaudeAccountUsageSnapshot,
} from "../runtime/shared/claude-account-usage.js";

export type SystemConnections = {
  web_api: "online";
  public_mcp: "available";
  internal_mcp: "available" | "not_enabled";
};

export type SystemServiceErrorCode = "USER_NOT_FOUND" | "USER_DISABLED";

export class SystemServiceError extends Error {
  constructor(public readonly code: SystemServiceErrorCode) {
    super("System data is unavailable for the authenticated user.");
    this.name = "SystemServiceError";
  }
}

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
