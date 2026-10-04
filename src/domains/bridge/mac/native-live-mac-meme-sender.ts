import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type {
  NativeLiveMacOutputAttachmentDescriptor,
  NativeLiveMacOutputAttachmentSender,
} from "./native-live-mac-output-attachment-sender.js";

export type NativeLiveMemeRuntimeHandlers = {
  sendMeme(input: { memeId: string }): Promise<NativeLiveMacOutputAttachmentDescriptor>;
};

export type NativeLiveMemeSendErrorCode =
  | "MEME_GH_UNAVAILABLE"
  | "MEME_NOT_FOUND"
  | "MEME_GITHUB_FETCH_FAILED"
  | "MEME_SOURCE_INVALID"
  | "MEME_ATTACHMENT_FAILED";

export class NativeLiveMemeSendError extends Error {
  constructor(
    readonly code: NativeLiveMemeSendErrorCode,
  ) {
    super(memeErrorMessage(code));
    this.name = "NativeLiveMemeSendError";
  }
}

type GhExecutor = (
  file: string,
  args: string[],
  options: {
    maxBuffer: number;
    timeout: number;
    env: NodeJS.ProcessEnv;
  },
) => Promise<Buffer>;

export type NativeLiveMacMemeGitHubConfig = {
  githubToken: string | null;
  ghPath: string | null;
};

export function consumeNativeLiveMacMemeGitHubConfig(
  environment: NodeJS.ProcessEnv,
): NativeLiveMacMemeGitHubConfig {
  const githubToken =
    environment.LEILEI_MEME_GITHUB_TOKEN?.trim() || null;
  const ghPath =
    environment.LEILEI_MEME_GH_PATH?.trim() || null;
  delete environment.LEILEI_MEME_GITHUB_TOKEN;
  delete environment.LEILEI_MEME_GH_PATH;
  if (ghPath && !ghPath.startsWith("/")) {
    throw new Error(
      "LEILEI_MEME_GH_PATH must be an absolute path when configured.",
    );
  }
  return { githubToken, ghPath };
}

const MAX_MEME_BYTES = 20 * 1024 * 1024;
const MEME_ID_PATTERN = /^meme_[0-9]{4,32}(?![\s\S])/u;

const runGh: GhExecutor = (file, args, options) => new Promise((resolve,reject) => {
  execFile(file,args,{...options,encoding:"buffer"},(error,stdout,stderr) => {
    if (!error) {
      resolve(stdout);
      return;
    }
    const record =
      error && typeof error === "object"
        ? error as Record<string, unknown>
        : {};
    if (record.code === "ENOENT") {
      reject(new NativeLiveMemeSendError("MEME_GH_UNAVAILABLE"));
      return;
    }
    const safeStderr =
      Buffer.isBuffer(stderr)
        ? stderr.toString("utf8")
        : typeof stderr === "string"
          ? stderr
          : "";
    if (/\b404\b|not found/iu.test(safeStderr)) {
      reject(new NativeLiveMemeSendError("MEME_NOT_FOUND"));
      return;
    }
    reject(new NativeLiveMemeSendError("MEME_GITHUB_FETCH_FAILED"));
  });
});

export class NativeLiveMacMemeSender implements NativeLiveMemeRuntimeHandlers {
  constructor(
    private readonly attachments: Pick<NativeLiveMacOutputAttachmentSender,"sendBytes">,
    private readonly executeGh: GhExecutor = runGh,
    private readonly githubConfig: NativeLiveMacMemeGitHubConfig = {
      githubToken: null,
      ghPath: null,
    },
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async sendMeme(input: { memeId: string }): Promise<NativeLiveMacOutputAttachmentDescriptor> {
    if (typeof input.memeId !== "string" || !MEME_ID_PATTERN.test(input.memeId)) {
      throw new Error("Meme id must be an existing meme_<digits> id.");
    }

    let bytes: Buffer;
    try {
      // No shell, credential parsing, arbitrary repo/ref/path, clone or cache.
      const childEnvironment = {
        ...this.environment,
        ...(this.githubConfig.githubToken
          ? { GH_TOKEN: this.githubConfig.githubToken }
          : {}),
      };
      bytes = await this.executeGh(
        this.githubConfig.ghPath ?? "gh",
        [
          "api", "--hostname", "github.com",
          `repos/nenecaramel/leileios-album/contents/memes/${input.memeId}.webp?ref=main`,
          "-H", "Accept: application/vnd.github.raw+json",
        ],
        {
          maxBuffer: MAX_MEME_BYTES,
          timeout: 30_000,
          env: childEnvironment,
        },
      );
    } catch (error) {
      if (error instanceof NativeLiveMemeSendError) throw error;
      throw new NativeLiveMemeSendError("MEME_GITHUB_FETCH_FAILED");
    }

    if (!Buffer.isBuffer(bytes) || bytes.length < 20 || bytes.length > MAX_MEME_BYTES
      || bytes.toString("ascii",0,4) !== "RIFF"
      || bytes.toString("ascii",8,12) !== "WEBP"
      || bytes.readUInt32LE(4) + 8 !== bytes.length
      || !["VP8 ","VP8L","VP8X"].includes(bytes.toString("ascii",12,16))) {
      throw new NativeLiveMemeSendError("MEME_SOURCE_INVALID");
    }

    const filename = `${input.memeId}.webp`;
    let attachment: NativeLiveMacOutputAttachmentDescriptor;
    try {
      attachment = await this.attachments.sendBytes({bytes,filename});
    } catch {
      throw new NativeLiveMemeSendError("MEME_ATTACHMENT_FAILED");
    }

    if (attachment.kind !== "image" || attachment.mimeType !== "image/webp"
      || attachment.filename !== filename || attachment.sizeBytes !== bytes.length
      || attachment.sha256 !== createHash("sha256").update(bytes).digest("hex")) {
      throw new NativeLiveMemeSendError("MEME_ATTACHMENT_FAILED");
    }
    return attachment;
  }
}

function memeErrorMessage(code: NativeLiveMemeSendErrorCode): string {
  switch (code) {
    case "MEME_GH_UNAVAILABLE":
      return "GitHub CLI is unavailable in the Mac daemon environment.";
    case "MEME_NOT_FOUND":
      return "Meme was not found in the fixed GitHub library.";
    case "MEME_GITHUB_FETCH_FAILED":
      return "GitHub meme fetch failed in the Mac daemon environment.";
    case "MEME_SOURCE_INVALID":
      return "GitHub returned invalid meme image bytes.";
    case "MEME_ATTACHMENT_FAILED":
      return "LeileiOS attachment upload or completion failed.";
  }
}
