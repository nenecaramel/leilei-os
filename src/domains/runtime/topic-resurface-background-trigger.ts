import type {
  TopicResurfaceThoughtMaterializationResult,
  TopicResurfaceThoughtMaterializationService,
} from "./topic-resurface-thought-materialization.js";

export type TopicResurfaceBackgroundScheduleInput = {
  userId: string;
  subjectId: string;
};

export type TopicResurfaceBackgroundObserverEvent =
  | {
      name: "topic_resurface_background_run";
      userId: string;
      subjectId: string;
      result: TopicResurfaceThoughtMaterializationResult;
    }
  | {
      name: "topic_resurface_background_error";
      userId: string;
      subjectId: string;
      errorName: string;
    };

type TopicResurfaceRunner =
  Pick<TopicResurfaceThoughtMaterializationService, "runOnce">;

/**
 * Non-blocking orchestration boundary for Topic resurfacing.
 *
 * This class intentionally does not define cadence. Callers may schedule runs
 * from a future heartbeat/wake policy, but transport polling intervals are not
 * interpreted as mental timing. Work is globally serialized because all model
 * stages share the local Claude Code subscription runtime, and repeated pending
 * requests for the same user+subject are coalesced.
 */
export class TopicResurfaceBackgroundTrigger {
  private readonly pending = new Map<
    string,
    TopicResurfaceBackgroundScheduleInput
  >();
  private worker: Promise<void> | null = null;

  constructor(
    private readonly runner: TopicResurfaceRunner,
    private readonly candidateLimit: number,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly observe?: (
      event: TopicResurfaceBackgroundObserverEvent,
    ) => void,
  ) {
    if (!Number.isInteger(candidateLimit) || candidateLimit < 1) {
      throw new Error(
        "Topic resurface background candidateLimit must be a positive integer.",
      );
    }
  }

  schedule(input: TopicResurfaceBackgroundScheduleInput): void {
    if (!input.userId.trim() || !input.subjectId.trim()) {
      throw new Error(
        "Topic resurface background identity must not be blank.",
      );
    }
    this.pending.set(keyOf(input), {
      userId: input.userId.trim(),
      subjectId: input.subjectId.trim(),
    });
    this.ensureWorker();
  }

  async drain(): Promise<void> {
    for (;;) {
      const active = this.worker;
      if (!active) {
        if (this.pending.size === 0) return;
        this.ensureWorker();
        continue;
      }
      await active;
    }
  }

  private ensureWorker(): void {
    if (this.worker) return;
    this.worker = Promise.resolve()
      .then(() => this.runLoop())
      .finally(() => {
        this.worker = null;
        if (this.pending.size > 0) this.ensureWorker();
      });
  }

  private async runLoop(): Promise<void> {
    while (this.pending.size > 0) {
      const first = this.pending.entries().next().value as
        | [string, TopicResurfaceBackgroundScheduleInput]
        | undefined;
      if (!first) return;

      const [key, input] = first;
      this.pending.delete(key);

      try {
        const result = await this.runner.runOnce({
          userId: input.userId,
          subjectId: input.subjectId,
          now: normalizeIso(this.now()),
          candidateLimit: this.candidateLimit,
        });
        this.emit({
          name: "topic_resurface_background_run",
          ...input,
          result,
        });
      } catch (error) {
        this.emit({
          name: "topic_resurface_background_error",
          ...input,
          errorName: error instanceof Error
            ? error.name
            : "UnknownError",
        });
      }
    }
  }

  private emit(event: TopicResurfaceBackgroundObserverEvent): void {
    try {
      this.observe?.(event);
    } catch {
      // Background observability must not turn an internal run into failure.
    }
  }
}

function keyOf(input: TopicResurfaceBackgroundScheduleInput): string {
  return `${input.userId}:\u0000:${input.subjectId}`;
}

function normalizeIso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      "Topic resurface background now() must return an ISO timestamp.",
    );
  }
  return new Date(parsed).toISOString();
}
