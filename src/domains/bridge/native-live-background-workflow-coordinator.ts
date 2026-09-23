export interface NativeLiveBackgroundWorkflowAdvancer {
  advanceNextForUser(input: { userId: string }): Promise<unknown>;
}

/**
 * Fans terminal background-model results back into backend-owned workflows.
 *
 * Each workflow advances independently. One broken workflow must not prevent
 * another durable workflow from consuming its already-delivered model result;
 * an unconsumed terminal job remains recoverable on the next reserve cycle.
 */
export class NativeLiveBackgroundWorkflowCoordinator {
  constructor(
    private readonly workflows:
      readonly NativeLiveBackgroundWorkflowAdvancer[],
  ) {}

  async advanceNextForUser(input: {
    userId: string;
  }): Promise<void> {
    for (const workflow of this.workflows) {
      try {
        await workflow.advanceNextForUser(input);
      } catch {
        // Terminal model results are durable. Leave the failed workflow
        // unconsumed and retry advancement on a later reserve/submit cycle.
      }
    }
  }
}
