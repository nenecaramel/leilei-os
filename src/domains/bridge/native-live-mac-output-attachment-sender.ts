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
};

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
    const mimeType = mimeTypeForFilename(filename);
    const kind =
      mimeType.startsWith("image/")
        ? "image" as const
        : "file" as const;
    const sha256 = await sha256File(filePath);

    const slot = await this.relay.createAttachmentUploadSlot({
      filename,
      mimeType,
      sizeBytes: fileStat.size,
      sha256,
      kind,
    });
    const bytes = await readFile(filePath);
    const response = await this.fetchImpl(
      slot.upload.url,
      {
        method: slot.upload.method,
        headers: slot.upload.headers,
        body: bytes,
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
      || attachment.sizeBytes !== fileStat.size
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
