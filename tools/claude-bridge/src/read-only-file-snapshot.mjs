import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";

const fail = code => Object.assign(new Error(code), { code });
const stamp = stat => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;

// Bounded, stable, non-symlink read shared by native transcripts and indices.
export async function readOnlyFileSnapshot(file, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw fail("INVALID_READ_LIMIT");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw fail("INVALID_NATIVE_FILE");
    if (before.size > BigInt(maxBytes)) throw fail("NATIVE_FILE_TOO_LARGE");
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const named = await lstat(file, { bigint: true });
    if (stamp(before) !== stamp(after) || stamp(after) !== stamp(named) || length !== Number(before.size)) throw fail("NATIVE_FILE_CHANGED_DURING_READ");
    const bytes = buffer.subarray(0, length);
    return { bytes, revision: createHash("sha256").update(bytes).digest("hex") };
  } finally { await handle.close(); }
}
