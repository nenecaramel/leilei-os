import assert from "node:assert/strict";
import test from "node:test";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupOrphanedLocalCheckpointForks,
  prepareLocalCheckpointFork,
} from "../src/local-checkpoint-fork.mjs";

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("orphan cleanup removes a crashed local fork transcript from a durable receipt", async (t) => {
  const root = await mkdtemp(
    join(tmpdir(), "leileios-fork-receipt-"),
  );
  t.after(() =>
    rm(root, { recursive: true, force: true })
  );

  const configDirectory = join(root, "claude");
  const receiptDirectory = join(root, "receipts");
  const projectDirectory = join(
    configDirectory,
    "projects",
    "sdk-private-project-directory",
  );
  await mkdir(projectDirectory, { recursive: true });

  const parentSessionId = "provider-parent";
  await writeFile(
    join(projectDirectory, parentSessionId + ".jsonl"),
    "{\"type\":\"user\"}\n",
    "utf8",
  );

  const environment = {
    CLAUDE_CONFIG_DIR: configDirectory,
    LEILEIOS_LOCAL_CHECKPOINT_FORK_RECEIPT_DIR:
      receiptDirectory,
  };
  const prefix = [
    {
      type: "user",
      uuid: "11111111-1111-4111-8111-111111111111",
      parentUuid: null,
      sessionId: parentSessionId,
      message: { role: "user", content: "hello" },
    },
  ];

  const fork = await prepareLocalCheckpointFork({
    sessionId: parentSessionId,
    checkpointId: prefix[0].uuid,
    prefix,
    cwd: "/workspace/with.dot_and_underscore",
    environment,
  });

  const transcriptPath = join(
    projectDirectory,
    fork.sessionId + ".jsonl",
  );
  assert.equal(await pathExists(transcriptPath), true);
  assert.deepEqual(
    await readdir(receiptDirectory),
    [fork.sessionId + ".json"],
  );

  // Simulate daemon death by intentionally skipping fork.cleanup().
  const result =
    await cleanupOrphanedLocalCheckpointForks({
      environment,
    });

  assert.deepEqual(result, {
    cleaned: 1,
    temporaryReceiptsRemoved: 0,
    failures: [],
  });
  assert.equal(await pathExists(transcriptPath), false);
  assert.deepEqual(await readdir(receiptDirectory), []);
  assert.equal(
    await pathExists(
      join(projectDirectory, parentSessionId + ".jsonl"),
    ),
    true,
  );
});

test("orphan cleanup refuses a receipt that escapes the Claude projects directory", async (t) => {
  const root = await mkdtemp(
    join(tmpdir(), "leileios-fork-receipt-guard-"),
  );
  t.after(() =>
    rm(root, { recursive: true, force: true })
  );

  const configDirectory = join(root, "claude");
  const receiptDirectory = join(root, "receipts");
  const projectsDirectory = join(
    configDirectory,
    "projects",
  );
  const outsideDirectory = join(root, "outside");
  await mkdir(projectsDirectory, { recursive: true });
  await mkdir(receiptDirectory, { recursive: true });
  await mkdir(outsideDirectory, { recursive: true });

  const sessionId =
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const outsideTranscript = join(
    outsideDirectory,
    sessionId + ".jsonl",
  );
  await writeFile(outsideTranscript, "do not delete\n", "utf8");
  await writeFile(
    join(receiptDirectory, sessionId + ".json"),
    JSON.stringify({
      version: 1,
      session_id: sessionId,
      project_directory: "../outside",
      created_at: new Date().toISOString(),
    }),
    "utf8",
  );

  const result =
    await cleanupOrphanedLocalCheckpointForks({
      environment: {
        CLAUDE_CONFIG_DIR: configDirectory,
        LEILEIOS_LOCAL_CHECKPOINT_FORK_RECEIPT_DIR:
          receiptDirectory,
      },
    });

  assert.equal(result.cleaned, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(await pathExists(outsideTranscript), true);
  assert.equal(
    await pathExists(
      join(receiptDirectory, sessionId + ".json"),
    ),
    true,
  );
});


test("orphan cleanup refuses a project-directory symlink even when the receipt name is valid", async (t) => {
  const root = await mkdtemp(
    join(tmpdir(), "leileios-fork-symlink-guard-"),
  );
  t.after(() =>
    rm(root, { recursive: true, force: true })
  );

  const configDirectory = join(root, "claude");
  const receiptDirectory = join(root, "receipts");
  const projectsDirectory = join(
    configDirectory,
    "projects",
  );
  const outsideDirectory = join(root, "outside");
  await mkdir(projectsDirectory, { recursive: true });
  await mkdir(receiptDirectory, { recursive: true });
  await mkdir(outsideDirectory, { recursive: true });

  const projectName = "project-link";
  await symlink(
    outsideDirectory,
    join(projectsDirectory, projectName),
  );

  const sessionId =
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const outsideTranscript = join(
    outsideDirectory,
    sessionId + ".jsonl",
  );
  await writeFile(outsideTranscript, "do not delete\n", "utf8");
  await writeFile(
    join(receiptDirectory, sessionId + ".json"),
    JSON.stringify({
      version: 1,
      session_id: sessionId,
      project_directory: projectName,
      created_at: new Date().toISOString(),
    }),
    "utf8",
  );

  const result =
    await cleanupOrphanedLocalCheckpointForks({
      environment: {
        CLAUDE_CONFIG_DIR: configDirectory,
        LEILEIOS_LOCAL_CHECKPOINT_FORK_RECEIPT_DIR:
          receiptDirectory,
      },
    });

  assert.equal(result.cleaned, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(await pathExists(outsideTranscript), true);
  assert.equal(
    await pathExists(
      join(receiptDirectory, sessionId + ".json"),
    ),
    true,
  );
});

test("local fork lookup fails closed when the same parent session exists in multiple project directories", async (t) => {
  const root = await mkdtemp(
    join(tmpdir(), "leileios-fork-duplicate-parent-"),
  );
  t.after(() =>
    rm(root, { recursive: true, force: true })
  );

  const configDirectory = join(root, "claude");
  const receiptDirectory = join(root, "receipts");
  const first = join(
    configDirectory,
    "projects",
    "project-a",
  );
  const second = join(
    configDirectory,
    "projects",
    "project-b",
  );
  await mkdir(first, { recursive: true });
  await mkdir(second, { recursive: true });

  const sessionId = "provider-parent";
  for (const directory of [first, second]) {
    await writeFile(
      join(directory, sessionId + ".jsonl"),
      "{\"type\":\"user\"}\n",
      "utf8",
    );
  }

  await assert.rejects(
    () =>
      prepareLocalCheckpointFork({
        sessionId,
        checkpointId:
          "11111111-1111-4111-8111-111111111111",
        prefix: [{
          type: "user",
          uuid:
            "11111111-1111-4111-8111-111111111111",
          parentUuid: null,
        }],
        cwd: "/workspace/current",
        environment: {
          CLAUDE_CONFIG_DIR: configDirectory,
          LEILEIOS_LOCAL_CHECKPOINT_FORK_RECEIPT_DIR:
            receiptDirectory,
        },
      }),
    (error) =>
      error.runtimeCode === "NO_PROVIDER_SESSION"
      && error.localTranscriptMatches === 2,
  );
  assert.equal(await pathExists(receiptDirectory), false);
});
