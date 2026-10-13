export interface LocalCheckpointForkEnvironment {
  [key: string]: string | undefined;
}

export function prepareLocalCheckpointFork(input: {
  sessionId: string;
  checkpointId: string;
  prefix: ReadonlyArray<Record<string, unknown>>;
  cwd: string;
  environment?: LocalCheckpointForkEnvironment;
}): Promise<{ sessionId: string; cleanup(): Promise<void> }>;

export function cleanupOrphanedLocalCheckpointForks(input?: {
  environment?: LocalCheckpointForkEnvironment;
}): Promise<{
  cleaned: number;
  temporaryReceiptsRemoved: number;
  failures: Array<{ receipt: string; error: string }>;
}>;
