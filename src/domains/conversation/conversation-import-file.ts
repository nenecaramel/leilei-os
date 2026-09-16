import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { once } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { createGzip, createInflateRaw } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

export const MAX_CONVERSATION_UPLOAD_BYTES = 256 * 1024 * 1024;
export const MAX_CONVERSATION_JSON_BYTES = 512 * 1024 * 1024;
export const MAX_CONVERSATION_ELEMENT_CHARS = 128 * 1024 * 1024;
export const MAX_CONVERSATION_STORED_BLOB_BYTES = 128 * 1024 * 1024;

export class ConversationImportFileError extends Error {
  constructor(
    public readonly code:
      | "CONVERSATION_IMPORT_TOO_LARGE"
      | "CONVERSATION_IMPORT_INVALID_FILE"
      | "CONVERSATION_IMPORT_ZIP_UNSUPPORTED"
      | "CONVERSATION_IMPORT_NO_CONVERSATIONS_JSON",
  ) {
    super(code);
    this.name = "ConversationImportFileError";
  }
}

export type ConversationUploadContainer = "json" | "zip";

export type StagedConversationUpload = {
  directory: string;
  uploadPath: string;
  originalFilename: string;
  rawSha256: string;
  rawBytes: number;
  container: ConversationUploadContainer;
  jsonPaths: string[];
  cleanup(): Promise<void>;
};

function safeFilename(value: string): string {
  const name = basename(value.trim());
  if (!name || name.length > 255) {
    throw new ConversationImportFileError("CONVERSATION_IMPORT_INVALID_FILE");
  }
  return name;
}

async function writeUpload(
  input: AsyncIterable<Uint8Array>,
  path: string,
): Promise<{ rawSha256: string; rawBytes: number }> {
  const output = createWriteStream(path, { flags: "wx" });
  const hash = createHash("sha256");
  let rawBytes = 0;
  try {
    for await (const rawChunk of input) {
      const chunk = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(rawChunk);
      rawBytes += chunk.length;
      if (rawBytes > MAX_CONVERSATION_UPLOAD_BYTES) {
        throw new ConversationImportFileError("CONVERSATION_IMPORT_TOO_LARGE");
      }
      hash.update(chunk);
      if (!output.write(chunk)) await once(output, "drain");
    }
    if (rawBytes === 0) {
      throw new ConversationImportFileError("CONVERSATION_IMPORT_INVALID_FILE");
    }
    output.end();
    await once(output, "finish");
    return { rawSha256: hash.digest("hex"), rawBytes };
  } catch (error) {
    output.destroy();
    throw error;
  }
}

async function readPrefix(path: string, length = 64): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function detectContainer(prefix: Buffer): ConversationUploadContainer {
  if (
    prefix.length >= 4
    && prefix[0] === 0x50
    && prefix[1] === 0x4b
    && (prefix[2] === 0x03 || prefix[2] === 0x05 || prefix[2] === 0x07)
    && (prefix[3] === 0x04 || prefix[3] === 0x06 || prefix[3] === 0x08)
  ) {
    return "zip";
  }
  const text = prefix.toString("utf8").replace(/^\uFEFF/u, "").trimStart();
  if (text.startsWith("[")) return "json";
  throw new ConversationImportFileError("CONVERSATION_IMPORT_INVALID_FILE");
}

type ZipEntry = {
  filename: string;
  compressionMethod: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

function findEocd(buffer: Buffer): number {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

async function listZipEntries(path: string): Promise<ZipEntry[]> {
  const info = await stat(path);
  const tailLength = Math.min(info.size, 65_557);
  const handle = await open(path, "r");
  try {
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, info.size - tailLength);
    const eocdOffset = findEocd(tail);
    if (eocdOffset < 0) {
      throw new ConversationImportFileError("CONVERSATION_IMPORT_ZIP_UNSUPPORTED");
    }

    const disk = tail.readUInt16LE(eocdOffset + 4);
    const centralDisk = tail.readUInt16LE(eocdOffset + 6);
    const diskEntries = tail.readUInt16LE(eocdOffset + 8);
    const totalEntries = tail.readUInt16LE(eocdOffset + 10);
    const centralSize = tail.readUInt32LE(eocdOffset + 12);
    const centralOffset = tail.readUInt32LE(eocdOffset + 16);
    if (
      disk !== 0
      || centralDisk !== 0
      || diskEntries !== totalEntries
      || totalEntries === 0xffff
      || centralSize === 0xffffffff
      || centralOffset === 0xffffffff
      || centralSize > 64 * 1024 * 1024
      || centralOffset + centralSize > info.size
    ) {
      throw new ConversationImportFileError("CONVERSATION_IMPORT_ZIP_UNSUPPORTED");
    }

    const central = Buffer.alloc(centralSize);
    await handle.read(central, 0, centralSize, centralOffset);
    const entries: ZipEntry[] = [];
    let offset = 0;
    for (let index = 0; index < totalEntries; index += 1) {
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50) {
        throw new ConversationImportFileError("CONVERSATION_IMPORT_ZIP_UNSUPPORTED");
      }
      const flags = central.readUInt16LE(offset + 8);
      const compressionMethod = central.readUInt16LE(offset + 10);
      const compressedSize = central.readUInt32LE(offset + 20);
      const uncompressedSize = central.readUInt32LE(offset + 24);
      const filenameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const commentLength = central.readUInt16LE(offset + 32);
      const localHeaderOffset = central.readUInt32LE(offset + 42);
      const end = offset + 46 + filenameLength + extraLength + commentLength;
      if (end > central.length) {
        throw new ConversationImportFileError("CONVERSATION_IMPORT_ZIP_UNSUPPORTED");
      }
      const filename = central
        .subarray(offset + 46, offset + 46 + filenameLength)
        .toString("utf8");
      entries.push({
        filename,
        compressionMethod,
        flags,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
      offset = end;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

function isConversationJsonEntry(filename: string): boolean {
  const leaf = filename.replace(/\\/gu, "/").split("/").at(-1) ?? "";
  return /^conversations(?:-\d+)?\.json$/iu.test(leaf);
}

async function extractZipEntry(
  zipPath: string,
  entry: ZipEntry,
  outputPath: string,
): Promise<number> {
  if ((entry.flags & 0x1) !== 0 || (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)) {
    throw new ConversationImportFileError("CONVERSATION_IMPORT_ZIP_UNSUPPORTED");
  }
  if (entry.uncompressedSize > MAX_CONVERSATION_JSON_BYTES) {
    throw new ConversationImportFileError("CONVERSATION_IMPORT_TOO_LARGE");
  }

  const handle = await open(zipPath, "r");
  let dataStart: number;
  try {
    const local = Buffer.alloc(30);
    const { bytesRead } = await handle.read(local, 0, local.length, entry.localHeaderOffset);
    if (bytesRead !== 30 || local.readUInt32LE(0) !== 0x04034b50) {
      throw new ConversationImportFileError("CONVERSATION_IMPORT_ZIP_UNSUPPORTED");
    }
    const filenameLength = local.readUInt16LE(26);
    const extraLength = local.readUInt16LE(28);
    dataStart = entry.localHeaderOffset + 30 + filenameLength + extraLength;
  } finally {
    await handle.close();
  }

  if (entry.compressedSize === 0) {
    await readFile(zipPath);
  }

  let written = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length;
      if (written > MAX_CONVERSATION_JSON_BYTES) {
        callback(new ConversationImportFileError("CONVERSATION_IMPORT_TOO_LARGE"));
        return;
      }
      callback(null, chunk);
    },
  });
  const input = createReadStream(zipPath, {
    start: dataStart,
    end: dataStart + Math.max(0, entry.compressedSize - 1),
  });
  const output = createWriteStream(outputPath, { flags: "wx" });
  if (entry.compressionMethod === 8) {
    await pipeline(input, createInflateRaw(), counter, output);
  } else {
    await pipeline(input, counter, output);
  }
  if (written !== entry.uncompressedSize) {
    throw new ConversationImportFileError("CONVERSATION_IMPORT_ZIP_UNSUPPORTED");
  }
  return written;
}

async function prepareJsonPaths(
  uploadPath: string,
  directory: string,
  container: ConversationUploadContainer,
): Promise<string[]> {
  if (container === "json") return [uploadPath];

  const entries = (await listZipEntries(uploadPath))
    .filter((entry) => isConversationJsonEntry(entry.filename))
    .sort((left, right) => left.filename.localeCompare(right.filename));
  if (entries.length === 0) {
    throw new ConversationImportFileError("CONVERSATION_IMPORT_NO_CONVERSATIONS_JSON");
  }

  let totalBytes = 0;
  const paths: string[] = [];
  for (const [index, entry] of entries.entries()) {
    totalBytes += entry.uncompressedSize;
    if (totalBytes > MAX_CONVERSATION_JSON_BYTES) {
      throw new ConversationImportFileError("CONVERSATION_IMPORT_TOO_LARGE");
    }
    const path = join(directory, `conversations-${index}.json`);
    await extractZipEntry(uploadPath, entry, path);
    paths.push(path);
  }
  return paths;
}

export async function stageConversationUpload(
  input: AsyncIterable<Uint8Array>,
  originalFilename: string,
): Promise<StagedConversationUpload> {
  const filename = safeFilename(originalFilename);
  const directory = await mkdtemp(join(tmpdir(), "leilei-conversation-"));
  const uploadPath = join(directory, `upload-${randomUUID()}.bin`);
  try {
    const { rawSha256, rawBytes } = await writeUpload(input, uploadPath);
    const container = detectContainer(await readPrefix(uploadPath));
    const jsonPaths = await prepareJsonPaths(uploadPath, directory, container);
    return {
      directory,
      uploadPath,
      originalFilename: filename,
      rawSha256,
      rawBytes,
      container,
      jsonPaths,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function *readTopLevelConversationObjects(
  path: string,
): AsyncGenerator<Record<string, unknown>> {
  const decoder = new StringDecoder("utf8");
  let arrayStarted = false;
  let arrayEnded = false;
  let collecting = false;
  let expectingDelimiter = false;
  let depth = 0;
  let inString = false;
  let escaping = false;
  let current = "";

  const processText = async function *(
    text: string,
  ): AsyncGenerator<Record<string, unknown>> {
    for (const character of text) {
      if (arrayEnded) {
        if (!/\s/u.test(character)) {
          throw new ConversationImportFileError("CONVERSATION_IMPORT_INVALID_FILE");
        }
        continue;
      }
      if (!arrayStarted) {
        if (/\s/u.test(character) || character === "\uFEFF") continue;
        if (character !== "[") {
          throw new ConversationImportFileError("CONVERSATION_IMPORT_INVALID_FILE");
        }
        arrayStarted = true;
        continue;
      }
      if (!collecting) {
        if (/\s/u.test(character)) continue;
        if (expectingDelimiter) {
          if (character === ",") {
            expectingDelimiter = false;
            continue;
          }
          if (character === "]") {
            arrayEnded = true;
            continue;
          }
          throw new ConversationImportFileError("CONVERSATION_IMPORT_INVALID_FILE");
        }
        if (character === "]") {
          arrayEnded = true;
          continue;
        }
        if (character !== "{") {
          throw new ConversationImportFileError("CONVERSATION_IMPORT_INVALID_FILE");
        }
        collecting = true;
        depth = 1;
        inString = false;
        escaping = false;
        current = "{";
        continue;
      }

      current += character;
      if (current.length > MAX_CONVERSATION_ELEMENT_CHARS) {
        throw new ConversationImportFileError("CONVERSATION_IMPORT_TOO_LARGE");
      }

      if (inString) {
        if (escaping) {
          escaping = false;
        } else if (character === "\\") {
          escaping = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === "{" || character === "[") {
        depth += 1;
      } else if (character === "}" || character === "]") {
        depth -= 1;
        if (depth < 0) {
          throw new ConversationImportFileError("CONVERSATION_IMPORT_INVALID_FILE");
        }
        if (depth === 0) {
          let value: unknown;
          try {
            value = JSON.parse(current);
          } catch {
            throw new ConversationImportFileError("CONVERSATION_IMPORT_INVALID_FILE");
          }
          if (value === null || typeof value !== "object" || Array.isArray(value)) {
            throw new ConversationImportFileError("CONVERSATION_IMPORT_INVALID_FILE");
          }
          yield value as Record<string, unknown>;
          current = "";
          collecting = false;
          expectingDelimiter = true;
        }
      }
    }
  };

  for await (const chunk of createReadStream(path)) {
    yield *processText(decoder.write(chunk));
  }
  yield *processText(decoder.end());

  if (!arrayStarted || !arrayEnded || collecting) {
    throw new ConversationImportFileError("CONVERSATION_IMPORT_INVALID_FILE");
  }
}

async function collectStream(
  input: AsyncIterable<Buffer | Uint8Array>,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of input) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    total += chunk.length;
    if (total > MAX_CONVERSATION_STORED_BLOB_BYTES) {
      throw new ConversationImportFileError("CONVERSATION_IMPORT_TOO_LARGE");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export async function encodeRawConversationSource(
  upload: StagedConversationUpload,
): Promise<{ encoding: "raw" | "gzip"; data: Buffer }> {
  if (upload.container === "zip") {
    return {
      encoding: "raw",
      data: await collectStream(createReadStream(upload.uploadPath)),
    };
  }
  const gzip = createGzip({ level: 6 });
  createReadStream(upload.uploadPath).pipe(gzip);
  return {
    encoding: "gzip",
    data: await collectStream(gzip),
  };
}
