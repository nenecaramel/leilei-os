export const RETENTION_BATCH_SIZE = 500;
export const RETENTION_MAX_BATCHES_PER_RUN = 20;
export const DATA_IMPORT_RETENTION_DAYS = 90;
export const NATIVE_LIVE_BACKGROUND_MODEL_RETENTION_DAYS = 7;

export type RetentionPolicy =
  | "mcp_write_idempotency"
  | "data_import_runs"
  | "native_live_background_model_jobs"
  | "native_live_chat_attachments"
  | "runtime_operational_records";

export type RetentionRunResult = {
  deletedRows: number;
  batches: number;
  capped: boolean;
};

export async function runBoundedRetention(
  deleteBatch: (limit: number) => Promise<number>,
): Promise<RetentionRunResult> {
  let deletedRows = 0;
  let batches = 0;

  while (batches < RETENTION_MAX_BATCHES_PER_RUN) {
    const deleted = await deleteBatch(RETENTION_BATCH_SIZE);
    deletedRows += deleted;
    batches += 1;
    if (deleted < RETENTION_BATCH_SIZE) {
      return { deletedRows, batches, capped: false };
    }
  }

  return { deletedRows, batches, capped: true };
}
