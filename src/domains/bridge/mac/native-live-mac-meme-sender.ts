import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type {
  NativeLiveMacOutputAttachmentDescriptor,
  NativeLiveMacOutputAttachmentSender,
} from "./native-live-mac-output-attachment-sender.js";

export type NativeLiveMemeRuntimeHandlers = {
  sendMeme(input: { memeId: string }): Promise<NativeLiveMacOutputAttachmentDescriptor>;
};

type GhExecutor = (
  file: string,
  args: string[],
  options: { maxBuffer: number; timeout: number },
) => Promise<Buffer>;

const MAX_MEME_BYTES = 20 * 1024 * 1024;
const MEME_ID_PATTERN = /^meme_[0-9]{1,32}(?![\s\S])/u;

const runGh: GhExecutor = (file, args, options) => new Promise((resolve,reject) => {
  execFile(file,args,{...options,encoding:"buffer"},(error,stdout) => {
    if (error) reject(error);
    else resolve(stdout);
  });
});

export class NativeLiveMacMemeSender implements NativeLiveMemeRuntimeHandlers {
  constructor(
    private readonly attachments: Pick<NativeLiveMacOutputAttachmentSender,"sendBytes">,
    private readonly executeGh: GhExecutor = runGh,
  ) {}

  async sendMeme(input: { memeId: string }): Promise<NativeLiveMacOutputAttachmentDescriptor> {
    if (typeof input.memeId !== "string" || !MEME_ID_PATTERN.test(input.memeId)) {
      throw new Error("Meme id must be an existing meme_<digits> id.");
    }
    try {
      // No shell, credential parsing, arbitrary repo/ref/path, clone or cache.
      const bytes = await this.executeGh("gh",[
        "api", "--hostname", "github.com",
        `repos/nenecaramel/leileios-album/contents/memes/${input.memeId}.webp?ref=main`,
        "-H", "Accept: application/vnd.github.raw+json",
      ],{maxBuffer:MAX_MEME_BYTES,timeout:30_000});
      if (!Buffer.isBuffer(bytes) || bytes.length < 20 || bytes.length > MAX_MEME_BYTES
        || bytes.toString("ascii",0,4) !== "RIFF"
        || bytes.toString("ascii",8,12) !== "WEBP"
        || bytes.readUInt32LE(4) + 8 !== bytes.length
        || !["VP8 ","VP8L","VP8X"].includes(bytes.toString("ascii",12,16))) {
        throw new Error();
      }
      const filename = `${input.memeId}.webp`;
      const attachment = await this.attachments.sendBytes({bytes,filename});
      if (attachment.kind !== "image" || attachment.mimeType !== "image/webp"
        || attachment.filename !== filename || attachment.sizeBytes !== bytes.length
        || attachment.sha256 !== createHash("sha256").update(bytes).digest("hex")) {
        throw new Error();
      }
      return attachment;
    } catch {
      // gh stderr and attachment failures can contain sensitive paths/URLs.
      // Do not attach a cause or return subprocess stderr to Claude.
      throw new Error("Meme could not be sent. Check the existing meme id and GitHub availability.");
    }
  }
}
