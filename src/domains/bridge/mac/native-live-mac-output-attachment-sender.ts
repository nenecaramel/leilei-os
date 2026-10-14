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

  async sendInlineImage(input: {
    data: string;
    mimeType: string;
    signal?: AbortSignal;
  }): Promise<NativeLiveMacOutputAttachmentDescriptor> {
    input.signal?.throwIfAborted();
    const extensions: Record<string, string> = {
      "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
    };
    const extension = extensions[input.mimeType];
    if (!extension || !input.data || input.data.length > Math.ceil(this.maxFileBytes / 3) * 4
      || input.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) {
      throw new Error("Invalid tool image.");
    }
    const bytes = Buffer.from(input.data, "base64");
    const validHeader = input.mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : input.mimeType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : input.mimeType === "image/gif" ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
      : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (!validHeader || bytes.length === 0 || bytes.length > this.maxFileBytes || bytes.toString("base64") !== input.data) {
      throw new Error("Invalid tool image.");
    }
    return this.uploadBytes({ bytes, filename: `tool-image.${extension}`, mimeType: input.mimeType,
      sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), kind: "image", signal: input.signal });
  }

  async sendFile(input: {
    path: string;
    displayName?: string | null;
    workingDirectory: string;
  }): Promise<NativeLiveMacOutputAttachmentDescriptor> {
    const requestedPath = input.path.trim();
    if (!requestedPath) {
      throw new Error("send_file requires a nonblank file path.");
    }

    const workingDirectory = await realpath(input.workingDirectory);
    const candidatePath = isAbsolute(requestedPath)
      ? requestedPath
      : resolve(workingDirectory, requestedPath);
    const filePath = await realpath(candidatePath);
    const directoryRelativePath = relative(
      workingDirectory,
      filePath,
    );
    if (
      directoryRelativePath === ".."
      || directoryRelativePath.startsWith(".." + sep)
      || isAbsolute(directoryRelativePath)
    ) {
      throw new Error(
        "send_file may only send files inside the active working directory.",
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

  private async uploadBytes(input: {
    signal?: AbortSignal;
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
    input.signal?.throwIfAborted();
    const response = await this.fetchImpl(
      slot.upload.url,
      {
        method: slot.upload.method,
        headers: slot.upload.headers,
        body: new Uint8Array(bytes),
        ...(input.signal ? { signal: input.signal } : {}),
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
    input.signal?.throwIfAborted();

    const attachment =
      await this.relay.completeAttachmentUpload({
        attachmentId: slot.attachment.attachmentId,
      });
    input.signal?.throwIfAborted();
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

async function probeAudioDurationWithAfinfo(
  filePath: string,
): Promise<number | null> {
  try {
    const stdout = await new Promise<string>(
      (resolveOutput, rejectOutput) => {
        execFile(
          "/usr/bin/afinfo",
          [filePath],
          {
            timeout: 2_000,
            maxBuffer: 256 * 1024,
            encoding: "utf8",
          },
          (error, output) => {
            if (error) {
              rejectOutput(error);
              return;
            }
            resolveOutput(output);
          },
        );
      },
    );
    const match =
      /^\s*estimated duration:\s*([0-9]+(?:\.[0-9]+)?)\s*sec\b/imu
        .exec(stdout);
    return normalizeDurationSeconds(
      match ? Number(match[1]) : null,
    ) ?? null;
  } catch {
    return null;
  }
}

function normalizeDurationSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
