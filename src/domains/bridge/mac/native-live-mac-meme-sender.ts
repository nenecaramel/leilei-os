import { createHash } from "node:crypto";
import type {
  NativeLiveMacOutputAttachmentDescriptor,
  NativeLiveMacOutputAttachmentSender,
} from "./native-live-mac-output-attachment-sender.js";

export type NativeLiveMemeRuntimeHandlers = {
  sendMeme(input: { memeId: string }): Promise<NativeLiveMacOutputAttachmentDescriptor>;
};

export type NativeLiveMemeSendErrorCode =
  | "MEME_GITHUB_AUTH_MISSING"
  | "MEME_GITHUB_AUTH_FAILED"
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

export type NativeLiveMacMemeGitHubConfig = {
  githubToken: string | null;
};

export function consumeNativeLiveMacMemeGitHubConfig(
  environment: NodeJS.ProcessEnv,
): NativeLiveMacMemeGitHubConfig {
  const githubToken =
    environment.LEILEI_MEME_GITHUB_TOKEN?.trim() || null;
  delete environment.LEILEI_MEME_GITHUB_TOKEN;
  // Legacy variable from the gh-CLI implementation. Strip it too so an old
  // local .env cannot leak irrelevant path configuration into Claude tools.
  delete environment.LEILEI_MEME_GH_PATH;
  return { githubToken };
}

const MAX_MEME_BYTES = 20 * 1024 * 1024;
const MEME_ID_PATTERN = /^meme_[0-9]{4,32}(?![\s\S])/u;
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_REPOSITORY = "nenecaramel/leileios-album";

export class NativeLiveMacMemeSender implements NativeLiveMemeRuntimeHandlers {
  constructor(
    private readonly attachments: Pick<NativeLiveMacOutputAttachmentSender,"sendBytes">,
    private readonly githubConfig: NativeLiveMacMemeGitHubConfig = {
      githubToken: null,
    },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendMeme(input: { memeId: string }): Promise<NativeLiveMacOutputAttachmentDescriptor> {
    if (typeof input.memeId !== "string" || !MEME_ID_PATTERN.test(input.memeId)) {
      throw new Error("Meme id must be an existing meme_<digits> id.");
    }

    const bytes = await this.fetchMemeBytes(input.memeId);
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

  private async fetchMemeBytes(memeId: string): Promise<Buffer> {
    const token = this.githubConfig.githubToken;
    if (!token) {
      throw new NativeLiveMemeSendError("MEME_GITHUB_AUTH_MISSING");
    }

    const url =
      `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/memes/${memeId}.webp?ref=main`;
    let response: Response;
    try {
      response = await this.fetchImpl(url,{
        method:"GET",
        headers:{
          Accept:"application/vnd.github.raw+json",
          Authorization:`Bearer ${token}`,
          "X-GitHub-Api-Version":GITHUB_API_VERSION,
        },
        signal:AbortSignal.timeout(30_000),
      });
    } catch {
      throw new NativeLiveMemeSendError("MEME_GITHUB_FETCH_FAILED");
    }

    if (response.status === 404) {
      throw new NativeLiveMemeSendError("MEME_NOT_FOUND");
    }
    if (response.status === 401 || response.status === 403) {
      throw new NativeLiveMemeSendError("MEME_GITHUB_AUTH_FAILED");
    }
    if (!response.ok) {
      throw new NativeLiveMemeSendError("MEME_GITHUB_FETCH_FAILED");
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength)
      && declaredLength > MAX_MEME_BYTES
    ) {
      throw new NativeLiveMemeSendError("MEME_SOURCE_INVALID");
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(await response.arrayBuffer());
    } catch {
      throw new NativeLiveMemeSendError("MEME_GITHUB_FETCH_FAILED");
    }
    if (bytes.length > MAX_MEME_BYTES) {
      throw new NativeLiveMemeSendError("MEME_SOURCE_INVALID");
    }
    return bytes;
  }
}

function memeErrorMessage(code: NativeLiveMemeSendErrorCode): string {
  switch (code) {
    case "MEME_GITHUB_AUTH_MISSING":
      return "Dedicated GitHub authentication is missing from the Mac daemon.";
    case "MEME_GITHUB_AUTH_FAILED":
      return "GitHub rejected the Mac daemon meme credential.";
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
