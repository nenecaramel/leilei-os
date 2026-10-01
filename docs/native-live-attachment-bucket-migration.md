# Native Live attachment Bucket cutover

This change prepares code only. It does not provision a Bucket, change production variables, deploy, migrate production bytes, or remove the `content` column.

## Storage selection

With the existing `NATIVE_LIVE_ATTACHMENT_*` Bucket configuration, uploads and new-upload completion use the existing S3 primary store. Metadata stays in Postgres, and new rows have `content = NULL`.

Downloads use the inline transfer store while a row still has `content`; otherwise they use the Bucket. No Bucket HEAD is needed to select a download store. An already-issued signed inline GET remains usable after migration clears its row's content: the inline transfer endpoint reads the Bucket copy and checks size and SHA-256. Inline PUT does not fall back to Bucket.

Retention serializes with migration on the same object key. It rechecks expiration after acquiring the lock, deletes the primary object (including any copy from an incomplete migration), deletes inline bytes where present, then removes metadata. Object-deletion failure preserves metadata for retry.

## Explicit migration API

There is no startup migration. After deployment/configuration has been separately authorized, an operator can call:

```ts
import { createDatabase } from "../src/database/client.js";
import { env, getNativeLiveAttachmentStorageConfig } from "../src/config/env.js";
import { S3PresignedAttachmentObjectStore } from "../src/domains/bridge/native-live-attachment-storage.js";
import {
  DrizzleNativeLiveInlineAttachmentMigrationRepository,
  migrateNativeLiveAttachmentInlineContentBatch,
  migrateNativeLiveAttachmentInlineContentUntilIdle,
} from "../src/domains/bridge/native-live-attachment-migration.js";

const config = getNativeLiveAttachmentStorageConfig(env);
if (!config) throw new Error("Bucket configuration is required");
const resource = createDatabase(env.DATABASE_URL);
try {
  const repository = new DrizzleNativeLiveInlineAttachmentMigrationRepository(resource.db);
  const store = new S3PresignedAttachmentObjectStore(config);
  const result = await migrateNativeLiveAttachmentInlineContentBatch(repository, store, 8);
  console.log(result); // Counts only: no credentials, URLs, filenames, or bytes.
  // Alternatively, bounded repeated batches:
  // await migrateNativeLiveAttachmentInlineContentUntilIdle(repository, store,
  //   { batchSize: 8, maxBatches: 128 });
} finally {
  await resource.close();
}
```

`batch(repository, objectStore, limit = 8, fetchImpl = fetch)` returns:

```ts
{ examined, migrated, skipped, failed, bytesMigrated }
```

`examined` is the scanned-row count. Only stable `ready`/`bound` rows with inline content are selected (maximum 100 per batch). Size, key, MIME, and checksum are validated before upload. Existing matching objects are reused; mismatching objects are never overwritten. A new upload uses the same object key, content type, and SHA metadata, and must pass HEAD verification. The conditional clear checks ID, object key, metadata, original content, and stable status, and counts only a returned row. Missing/already-cleared rows are skipped; failures preserve inline content and processing continues.

The Drizzle repository and retention share a transaction-scoped advisory lock, preventing stale migration candidates from recreating objects after retention. Custom repositories must provide equivalent `withLockedRecord` serialization if used concurrently with retention.

`untilIdle` also returns `batches`, stops when a batch makes no progress, and is bounded by `maxBatches`. Persistent failures at the front of the ordered scan can block later batches: inspect failures before retrying, or raise the batch size within the 100-row cap. A stopped run is not proof that all inline content has migrated. Uploading rows remain inline until they reach a stable state; run the explicit migration again later.

## Local verification

```sh
pnpm exec tsx --test tests/native-live-attachment-storage.test.ts tests/native-live-attachment-retention.test.ts tests/native-live-attachment-migration.test.ts
pnpm test:production-runtime-gate
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

The optional real-Postgres regression uses `RUN_NATIVE_LIVE_ATTACHMENT_DATABASE_TEST=1` and a separately provisioned `DATABASE_URL`. It refuses non-loopback hosts and database names without a test/regression/scratch marker, creates a unique test schema, and removes it after verification. Never supply a production URL to this test.
