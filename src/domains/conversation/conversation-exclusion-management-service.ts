import type {
  ConversationExclusionListItem,
  ConversationExclusionManagementRepository,
} from "./conversation-exclusion-management-repository.js";
import type {
  ConversationExclusionScope,
  ConversationProvider,
} from "../../database/schema.js";
import type { ConversationImportService } from "./conversation-import-service.js";

export class ConversationExclusionManagementError extends Error {
  constructor(
    public readonly code:
      | "CONVERSATION_EXCLUSION_INVALID_REQUEST"
      | "CONVERSATION_EXCLUSION_NOT_FOUND"
      | "CONVERSATION_EXCLUSION_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "ConversationExclusionManagementError";
  }
}

function uuid(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw new ConversationExclusionManagementError(
      "CONVERSATION_EXCLUSION_INVALID_REQUEST",
      `${label} is invalid.`,
    );
  }
  return value;
}

function provider(value: unknown): ConversationProvider | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "chatgpt" || value === "claude") return value;
  throw new ConversationExclusionManagementError(
    "CONVERSATION_EXCLUSION_INVALID_REQUEST",
    "Conversation exclusion provider is invalid.",
  );
}

function scope(value: unknown): ConversationExclusionScope | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "conversation" || value === "branch") return value;
  throw new ConversationExclusionManagementError(
    "CONVERSATION_EXCLUSION_INVALID_REQUEST",
    "Conversation exclusion scope is invalid.",
  );
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConversationExclusionManagementError(
      "CONVERSATION_EXCLUSION_INVALID_REQUEST",
      "Conversation exclusion pagination is invalid.",
    );
  }
  return parsed;
}

export class ConversationExclusionManagementService {
  constructor(
    private readonly repository: ConversationExclusionManagementRepository,
    private readonly importService?: ConversationImportService,
  ) {}

  async list(input: {
    userId: string;
    provider?: unknown;
    scope?: unknown;
    limit?: unknown;
    offset?: unknown;
  }): Promise<{ items: ConversationExclusionListItem[]; total: number }> {
    await this.requireActive(input.userId);
    return this.repository.listExclusions({
      userId: input.userId,
      provider: provider(input.provider),
      scope: scope(input.scope),
      limit: boundedInt(input.limit, 50, 1, 100),
      offset: boundedInt(input.offset, 0, 0, 100_000),
    });
  }

  async remove(input: {
    userId: string;
    exclusionId: unknown;
  }): Promise<{
    removed: true;
    exclusion: ConversationExclusionListItem;
    canonicalRestored: false;
    eligibleOnNextImport: true;
  }> {
    await this.requireActive(input.userId);
    const exclusion = await this.repository.deleteExclusion({
      userId: input.userId,
      exclusionId: uuid(input.exclusionId, "exclusionId"),
    });
    if (!exclusion) {
      throw new ConversationExclusionManagementError(
        "CONVERSATION_EXCLUSION_NOT_FOUND",
        "Conversation exclusion was not found.",
      );
    }
    return {
      removed: true,
      exclusion,
      canonicalRestored: false,
      eligibleOnNextImport: true,
    };
  }

  async restore(input: {
    userId: string;
    exclusionId: unknown;
    sourceId: unknown;
  }): Promise<{ restored: true; sourceId: string }> {
    await this.requireActive(input.userId);
    if (!this.importService || !this.repository.getExclusion) {
      throw new ConversationExclusionManagementError("CONVERSATION_EXCLUSION_UNAVAILABLE", "Conversation restore is unavailable.");
    }
    const exclusionId = uuid(input.exclusionId, "exclusionId");
    const sourceId = uuid(input.sourceId, "sourceId");
    const exclusion = await this.repository.getExclusion({ userId: input.userId, exclusionId });
    if (!exclusion) throw new ConversationExclusionManagementError("CONVERSATION_EXCLUSION_NOT_FOUND", "Conversation exclusion was not found.");
    const preview = await this.importService.previewStoredSource(sourceId, input.userId, {
      ignoreExclusion: {
        provider: exclusion.provider,
        scope: exclusion.scope,
        sourceConversationId: exclusion.sourceConversationId,
        sourceNodeId: exclusion.sourceNodeId,
      },
      requireExclusion: {
        provider: exclusion.provider,
        scope: exclusion.scope,
        sourceConversationId: exclusion.sourceConversationId,
        sourceNodeId: exclusion.sourceNodeId,
      },
    });
    await this.importService.execute(preview.import_run_id, preview.preview_fingerprint, input.userId, {
      ignoreExclusion: {
        provider: exclusion.provider,
        scope: exclusion.scope,
        sourceConversationId: exclusion.sourceConversationId,
        sourceNodeId: exclusion.sourceNodeId,
      },
      requireExclusion: {
        provider: exclusion.provider,
        scope: exclusion.scope,
        sourceConversationId: exclusion.sourceConversationId,
        sourceNodeId: exclusion.sourceNodeId,
      },
      exclusionIdToRemove: exclusionId,
    });
    return { restored: true, sourceId };
  }

  async restoreCandidates(input: {
    userId: string;
    exclusionId: unknown;
  }): Promise<{ items: Awaited<ReturnType<ConversationImportService["findRestoreCandidates"]>>; total: number }> {
    await this.requireActive(input.userId);
    if (!this.importService || !this.repository.getExclusion) {
      throw new ConversationExclusionManagementError("CONVERSATION_EXCLUSION_UNAVAILABLE", "Conversation restore is unavailable.");
    }
    const exclusion = await this.repository.getExclusion({
      userId: input.userId,
      exclusionId: uuid(input.exclusionId, "exclusionId"),
    });
    if (!exclusion) {
      throw new ConversationExclusionManagementError("CONVERSATION_EXCLUSION_NOT_FOUND", "Conversation exclusion was not found.");
    }
    const items = await this.importService.findRestoreCandidates({
      userId: input.userId,
      exclusion: {
        provider: exclusion.provider,
        scope: exclusion.scope,
        sourceConversationId: exclusion.sourceConversationId,
        sourceNodeId: exclusion.sourceNodeId,
      },
    });
    return { items, total: items.length };
  }


  async restoreEvidence(input: {
    userId: string;
    exclusionId: unknown;
    sourceId: unknown;
    limit?: unknown;
    offset?: unknown;
  }): Promise<NonNullable<Awaited<ReturnType<ConversationImportService["inspectRestoreEvidence"]>>>> {
    await this.requireActive(input.userId);
    if (!this.importService || !this.repository.getExclusion) {
      throw new ConversationExclusionManagementError(
        "CONVERSATION_EXCLUSION_UNAVAILABLE",
        "Conversation recovery inspection is unavailable.",
      );
    }
    const exclusionId = uuid(input.exclusionId, "exclusionId");
    const sourceId = uuid(input.sourceId, "sourceId");
    const exclusion = await this.repository.getExclusion({ userId: input.userId, exclusionId });
    if (!exclusion) {
      throw new ConversationExclusionManagementError(
        "CONVERSATION_EXCLUSION_NOT_FOUND",
        "Conversation exclusion was not found.",
      );
    }
    const evidence = await this.importService.inspectRestoreEvidence({
      userId: input.userId,
      sourceId,
      exclusion: {
        provider: exclusion.provider,
        scope: exclusion.scope,
        sourceConversationId: exclusion.sourceConversationId,
        sourceNodeId: exclusion.sourceNodeId,
      },
      limit: boundedInt(input.limit, 40, 1, 100),
      offset: boundedInt(input.offset, 0, 0, 100_000),
    });
    if (!evidence) {
      throw new ConversationExclusionManagementError(
        "CONVERSATION_EXCLUSION_INVALID_REQUEST",
        "The retained source does not contain the selected exclusion target.",
      );
    }
    return evidence;
  }

  private async requireActive(userId: string): Promise<void> {
    if (await this.repository.findUserStatus(userId) !== "active") {
      throw new ConversationExclusionManagementError(
        "CONVERSATION_EXCLUSION_UNAVAILABLE",
        "Conversation exclusion management is unavailable.",
      );
    }
  }
}
