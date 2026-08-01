import type { createDatabase } from "../../database/client.js";
import { resourceLifecycleEvents } from "../../database/schema.js";

export type LifecycleResourceType = "memory" | "diary" | "task";
export type LifecycleAction = "archive" | "restore" | "permanent_delete";
export type LifecycleActorType = "user" | "assistant" | "system";
export type LifecycleChannel = "web" | "mcp" | "internal";

export type RecordLifecycleEventInput = {
  userId: string;
  resourceType: LifecycleResourceType;
  resourceId: string;
  action: LifecycleAction;
  actorType: LifecycleActorType;
  channel: LifecycleChannel;
  metadata: Record<string, unknown>;
};

export type LifecycleMutationInput = {
  id: string;
  userId: string;
  actorType: LifecycleActorType;
  channel: LifecycleChannel;
};

export const WEB_USER_LIFECYCLE_CONTEXT = {
  actorType: "user",
  channel: "web",
} as const satisfies Pick<LifecycleMutationInput, "actorType" | "channel">;

export function createLifecycleAuditEvent(
  input: Omit<RecordLifecycleEventInput, "metadata">,
): RecordLifecycleEventInput {
  return { ...input, metadata: {} };
}

type Database = ReturnType<typeof createDatabase>["db"];
export type LifecycleTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export interface LifecycleAuditPersistence {
  record(
    transaction: LifecycleTransaction,
    input: RecordLifecycleEventInput,
  ): Promise<void>;
}

export class DrizzleLifecycleAuditPersistence
  implements LifecycleAuditPersistence
{
  async record(
    transaction: LifecycleTransaction,
    input: RecordLifecycleEventInput,
  ): Promise<void> {
    await transaction.insert(resourceLifecycleEvents).values({
      userId: input.userId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: input.action,
      actorType: input.actorType,
      channel: input.channel,
      metadata: input.metadata,
    });
  }
}
