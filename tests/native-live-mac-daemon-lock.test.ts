import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acquireNativeLiveMacDaemonLock,
} from "../src/domains/bridge/mac/native-live-mac-daemon-lock.js";

test("Mac daemon lock rejects a second live process", () => {
  const baseDir = mkdtempSync(
    join(tmpdir(), "leileios-daemon-lock-"),
  );
  try {
    const first = acquireNativeLiveMacDaemonLock({
      baseDir,
      pid: 111,
      now: () => new Date("2026-09-26T00:00:00.000Z"),
      isPidAlive: (pid) => pid === 111,
    });

    assert.throws(
      () =>
        acquireNativeLiveMacDaemonLock({
          baseDir,
          pid: 222,
          isPidAlive: (pid) => pid === 111,
        }),
      /already running \(pid 111\)/u,
    );

    first.release();
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("Mac daemon lock recovers a stale crashed-process lock", () => {
  const baseDir = mkdtempSync(
    join(tmpdir(), "leileios-daemon-lock-"),
  );
  try {
    const stale = acquireNativeLiveMacDaemonLock({
      baseDir,
      pid: 111,
      isPidAlive: () => false,
    });

    // Simulate a crash by deliberately leaving the first lock directory.
    const replacement = acquireNativeLiveMacDaemonLock({
      baseDir,
      pid: 222,
      isPidAlive: () => false,
    });

    assert.equal(replacement.path, stale.path);
    replacement.release();
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("Mac daemon lock release is idempotent", () => {
  const baseDir = mkdtempSync(
    join(tmpdir(), "leileios-daemon-lock-"),
  );
  try {
    const lock = acquireNativeLiveMacDaemonLock({
      baseDir,
      pid: 333,
      isPidAlive: () => false,
    });
    lock.release();
    lock.release();

    const next = acquireNativeLiveMacDaemonLock({
      baseDir,
      pid: 444,
      isPidAlive: () => false,
    });
    next.release();
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});
