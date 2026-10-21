import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import { nativeLiveRuntimeEvents, nativeLiveTurnPreparations } from "../../../database/schema.js";
import { taskSource } from "./native-live-task-control-repository.js";
import { NativeLiveRuntimeControlError } from "./native-live-runtime-control.js";

type Database = ReturnType<typeof createDatabase>["db"];
export type NativeLiveTaskStateTask = { task_id: string; run_id?: string; task_type: string; description: string; ambient: boolean };
export type NativeLiveTaskStateInput = {
  userId: string; prepareId: string; listenerInstanceId: string; providerSessionId: string;
  generationId: string; snapshotSequence: number; tasks: NativeLiveTaskStateTask[];
};
export type NativeLiveTaskStateOutcome = { outcome: "created" | "idempotent" | "stale" };
const invalid = () => new NativeLiveRuntimeControlError("CONTROL_INVALID", "Task state requires a bounded active membership snapshot.");
const conflict = () => new NativeLiveRuntimeControlError("CONTROL_CONFLICT", "Task state generation or sequence conflicts with its committed source.");
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value;
/** Shared HTTP/repository validation; snapshots never carry tool output or history. */
export function normalizeNativeLiveTaskStateTasks(value: unknown): NativeLiveTaskStateTask[] {
  if (!Array.isArray(value) || value.length > 64) throw invalid();
  const seen = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
    const task = raw as Record<string, unknown>;
    if (Object.keys(task).some(key => !["task_id", "run_id", "task_type", "description", "ambient"].includes(key))
      || !text(task.task_id, 512) || seen.has(task.task_id) || !text(task.task_type, 128)
      || typeof task.description !== "string" || task.description.length > 2000 || typeof task.ambient !== "boolean"
      || (task.run_id !== undefined && !text(task.run_id, 512))) throw invalid();
    seen.add(task.task_id);
    return { task_id: task.task_id, ...(task.run_id === undefined ? {} : { run_id: task.run_id as string }), task_type: task.task_type, description: task.description, ambient: task.ambient };
  });
}

export async function publishNativeLiveTaskState(db: Database, input: NativeLiveTaskStateInput): Promise<NativeLiveTaskStateOutcome> {
  if (![input.userId, input.prepareId, input.listenerInstanceId, input.generationId].every(uuid)
    || !text(input.providerSessionId, 1024) || !Number.isSafeInteger(input.snapshotSequence) || input.snapshotSequence < 1) throw invalid();
  const tasks = normalizeNativeLiveTaskStateTasks(input.tasks);
  const fingerprint = createHash("sha256").update(JSON.stringify(tasks)).digest("hex");
  return db.transaction(async tx => {
    // taskSource owns the preparation -> conversation -> lease lock order and
    // verifies the surviving branch and exclusive native writer admission.
    const source = await taskSource(tx, input);
    if (!source || source.providerSessionId !== input.providerSessionId) throw new NativeLiveRuntimeControlError("TURN_NOT_ACTIVE", "Task state source no longer owns this session.");
    const [preparation] = await tx.select().from(nativeLiveTurnPreparations).where(and(eq(nativeLiveTurnPreparations.id, input.prepareId), eq(nativeLiveTurnPreparations.userId, input.userId)));
    if (!preparation || preparation.status !== "finalized_success" || preparation.dispatchStatus !== "completed") throw new NativeLiveRuntimeControlError("TURN_NOT_ACTIVE", "Task state requires a committed foreground source.");
    const metadata = preparation.runtimeMetadata ?? {};
    const previous = metadata.native_live_task_state as Record<string, unknown> | undefined;
    if (previous !== undefined) {
      if (!previous || typeof previous !== "object" || Array.isArray(previous)
        || previous.listenerInstanceId !== input.listenerInstanceId || previous.generationId !== input.generationId
        || !Number.isSafeInteger(previous.snapshotSequence) || (previous.snapshotSequence as number) < 1 || typeof previous.fingerprint !== "string") throw conflict();
      if (input.snapshotSequence < (previous.snapshotSequence as number)) return { outcome: "stale" };
      if (input.snapshotSequence === previous.snapshotSequence) {
        if (previous.fingerprint !== fingerprint) throw conflict();
        return { outcome: "idempotent" };
      }
    }
    // The same preparation lock used by foreground event appends serializes
    // sequence allocation, including retries and concurrent newer snapshots.
    const [maximum] = await tx.select({ sequence: sql<number>`coalesce(max(${nativeLiveRuntimeEvents.sequence}), 0)` }).from(nativeLiveRuntimeEvents)
      .where(and(eq(nativeLiveRuntimeEvents.userId, input.userId), eq(nativeLiveRuntimeEvents.prepareId, input.prepareId)));
    const sequence = Number(maximum?.sequence ?? 0) + 1;
    if (!Number.isSafeInteger(sequence) || sequence > 2_147_483_647) throw conflict();
    await tx.insert(nativeLiveRuntimeEvents).values({ userId: input.userId, prepareId: input.prepareId, sequence, eventType: "task", providerSessionId: input.providerSessionId,
      payload: { phase: "active_set", replace: true, tasks } });
    await tx.update(nativeLiveTurnPreparations).set({ runtimeMetadata: { ...metadata, native_live_task_state: {
      listenerInstanceId: input.listenerInstanceId, generationId: input.generationId, snapshotSequence: input.snapshotSequence, fingerprint,
    } } }).where(eq(nativeLiveTurnPreparations.id, input.prepareId));
    return { outcome: "created" };
  });
}
