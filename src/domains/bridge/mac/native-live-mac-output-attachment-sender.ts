import {
  execFile,
} from "node:child_process";
import {
  createHash,
} from "node:crypto";
import {
  createReadStream,
} from "node:fs";
import {
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  promisify,
} from "node:util";

export type NativeLiveMacOutputAttachmentDescriptor = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  kind: "image" | "file";
  durationSeconds?: number;
};

export type NativeLiveAudioDurationProbe = (
  filePath: string,
) => Promise<number | null | undefined>;

export interface NativeLiveMacOutputAttachmentRelay {
  createAttachmentUploadSlot(input: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    kind: "image" | "file";
  }): Promise<{
    attachment: NativeLiveMacOutputAttachmentDescriptor;
    upload: {
      url: string;
      method: "PUT";
      headers: Record<string, string>;
    };
  }>;
  completeAttachmentUpload(input: {
    attachmentId: string;
  }): Promise<NativeLiveMacOutputAttachmentDescriptor>;
}

export class NativeLiveMacOutputAttachmentSender {
  constructor(
    private readonly relay: NativeLiveMacOutputAttachmentRelay,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly maxFileBytes = 20 * 1024 * 1024,
    private readonly durationProbe:
      NativeLiveAudioDurationProbe = probeAudioDurationWithAfinfo,
  ) {}

  async sendFile(input: {
    path: string;
    displayName?: string | null;
    workspaceRoot: string;
  }): Promise<NativeLiveMacOutputAttachmentDescriptor> {
    const requestedPath = input.path.trim();
    if (!requestedPath) {
      throw new Error("send_file requires a nonblank file path.");
    }

    const workspaceRoot = await realpath(input.workspaceRoot);
    const candidatePath = isAbsolute(requestedPath)
      ? requestedPath
      : resolve(workspaceRoot, requestedPath);
    const filePath = await realpath(candidatePath);
    const workspaceRelativePath = relative(
      workspaceRoot,
      filePath,
    );
    if (
      workspaceRelativePath === ".."
      || workspaceRelativePath.startsWith(".." + sep)
      || isAbsolute(workspaceRelativePath)
    ) {
      throw new Error(
        "send_file may only send files inside the active workspace.",
      );
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error("send_file path must point to a regular file.");
    }
    if (
      !Number.isSafeInteger(fileStat.size)
      || fileStat.size <= 0
      || fileStat.size > this.maxFileBytes
    ) {
      throw new Error(
        "send_file file size is outside the allowed attachment limit.",
      );
    }

    const filename = normalizeDisplayName(
      input.displayName,
      filePath,
    );
    const mimeType = mimeTypeForFilename(filePath);
    const kind =
      mimeType.startsWith("image/")
        ? "image" as const
        : "file" as const;
    const durationSeconds =
      mimeType.startsWith("audio/")
        ? normalizeDurationSeconds(
            await this.durationProbe(filePath).catch(() => null),
          )
        : undefined;
    const sha256 = await sha256File(filePath);

    const attachment = await this.uploadBytes({
      filename, mimeType, sizeBytes: fileStat.size, sha256, kind,
      bytes: await readFile(filePath),
    });
    return durationSeconds === undefined
      ? attachment
      : { ...attachment, durationSeconds };
  }

  // Internal runtime entrypoint; does not add a Claude-visible arbitrary bytes tool.
  async sendBytes(input: {
    bytes: Uint8Array;
    filename: string;
  }): Promise<NativeLiveMacOutputAttachmentDescriptor> {
    if (!Number.isSafeInteger(input.bytes.byteLength)
      || input.bytes.byteLength <= 0
      || input.bytes.byteLength > this.maxFileBytes) {
      throw new Error("Output bytes exceed the allowed attachment limit.");
    }
    const filename = normalizeDisplayName(input.filename, input.filename);
    const mimeType = mimeTypeForFilename(filename);
    const bytes = Buffer.from(input.bytes);
    return this.uploadBytes({
      bytes, filename, mimeType, sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      kind: mimeType.startsWith("image/") ? "image" : "file",
    });
  }

  private async uploadBytes(input: {
    bytes: Buffer;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    kind: "image" | "file";
  }): Promise<NativeLiveMacOutputAttachmentDescriptor> {
    const { bytes, filename, mimeType, sizeBytes, sha256, kind } = input;
    const slot = await this.relay.createAttachmentUploadSlot({
      filename,
      mimeType,
      sizeBytes,
      sha256,
      kind,
    });
    const response = await this.fetchImpl(
      slot.upload.url,
      {
        method: slot.upload.method,
        headers: slot.upload.headers,
        body: new Uint8Array(bytes),
      },
    );
    if (!response.ok) {
      throw Object.assign(
        new Error(
          "send_file upload failed with HTTP "
          + response.status,
        ),
        { httpStatus: response.status },
      );
    }

    const attachment =
      await this.relay.completeAttachmentUpload({
        attachmentId: slot.attachment.attachmentId,
      });
    if (
      attachment.attachmentId
        !== slot.attachment.attachmentId
      || attachment.sizeBytes !== sizeBytes
      || attachment.sha256 !== sha256
    ) {
      throw new Error(
        "send_file completion metadata did not match the uploaded file.",
      );
    }
    return attachment;
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function normalizeDisplayName(
  value: string | null | undefined,
  filePath: string,
): string {
  const raw =
    typeof value === "string" && value.trim()
      ? value.trim()
      : basename(filePath);
  const normalized = basename(raw)
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim();
  if (
    normalized.length === 0
    || normalized.length > 255
  ) {
    throw new Error(
      "send_file display_name must contain 1-255 characters.",
    );
  }
  return normalized;
}

function mimeTypeForFilename(filename: string): string {
  switch (extname(filename).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".wav":
      return "audio/wav";
    case ".aac":
      return "audio/aac";
    case ".flac":
      return "audio/flac";
    case ".ogg":
      return "audio/ogg";
    case ".opus":
      return "audio/opus";
    case ".pdf":
      return "application/pdf";
    case ".txt":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".csv":
      return "text/csv";
    case ".json":
      return "application/json";
    case ".html":
    case ".htm":
      return "text/html";
    case ".xml":
      return "application/xml";
    case ".yaml":
    case ".yml":
      return "application/yaml";
    case ".zip":
      return "application/zip";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    default:
      return "application/octet-stream";
  }
}

const execFileAsync = promisify(execFile);

async function probeAudioDurationWithAfinfo(
  filePath: string,
): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/afinfo",
      [filePath],
      { timeout: 2_000, maxBuffer: 256 * 1024, encoding: "utf8" },
    );
    const match = /^\\s*estimated duration:\\s*([0-9]+(?:\\.[0-9]+)?)\\s*sec\\b/imu.exec(stdout);
    return normalizeDurationSeconds(match ? Number(match[1]) : null) ?? null;
  } catch {
    return null;
  }
}

function normalizeDurationSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
