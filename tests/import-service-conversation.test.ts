import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExportConversationsBundle,
} from "../src/domains/export/export-types.js";
import {
  ImportService,
} from "../src/domains/import/import-service.js";
import {
  USER_ID,
  diary,
  todo,
  conversationBundle,
  v3PackageBytes,
  FakeImportRepository,
} from "./helpers/import-service-fixtures.js";

test("v3 conversation preview rejects a parent cycle before execute", async () => {
  const cyclic: ExportConversationsBundle = {
    ...conversationBundle,
    messages: conversationBundle.messages.map((message, index) => ({
      ...message,
      parent_message_id:
        index === 0
          ? conversationBundle.messages[1]!.id
          : conversationBundle.messages[0]!.id,
    })),
  };
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    conversations: {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    },
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes({ conversations: cyclic }),
    USER_ID,
  );

  assert.ok((preview.summary.conversations?.invalid ?? 0) > 0);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});

test("v3 conversation checkpoint restore preserves continuation handle", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    conversations: {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    },
  });
  const service = new ImportService(repository);

  const raw = v3PackageBytes({
    conversations: conversationBundle,
  });
  const preview = await service.preview(raw, USER_ID);

  assert.equal(preview.summary.conversations?.create, 6);
  assert.equal(preview.can_execute, true);

  await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.deepEqual(
    repository.state.conversations?.provider_checkpoints,
    conversationBundle.provider_checkpoints,
  );
});

test("v3 conversation checkpoint preview rejects a foreign checkpoint id", async () => {
  const checkpoint = conversationBundle.provider_checkpoints[0]!;
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    conversations: {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    },
    foreign_conversation_checkpoint_ids:
      new Set([checkpoint.id]),
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes({
      conversations: conversationBundle,
    }),
    USER_ID,
  );

  assert.equal(preview.summary.conversations?.conflict, 1);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});
