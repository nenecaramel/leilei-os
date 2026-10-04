export const MEME_SYSTEM_HINT = "A small curated meme library is available in nenecaramel/leileios-album. You may inspect it with the existing `gh` CLI. When a reaction image genuinely fits, choose an existing meme ID and use send_meme. Use memes sparingly and naturally; do not force one into every reply and do not invent IDs.";

const SAFE_MEME_ERRORS = new Map([
  ["MEME_GH_UNAVAILABLE", "GitHub CLI is unavailable in the Mac daemon environment."],
  ["MEME_NOT_FOUND", "The meme was not found in the fixed GitHub library."],
  ["MEME_GITHUB_FETCH_FAILED", "GitHub fetch failed in the Mac daemon environment."],
  ["MEME_SOURCE_INVALID", "GitHub returned invalid meme image bytes."],
  ["MEME_ATTACHMENT_FAILED", "LeileiOS attachment upload or completion failed."],
]);

export async function createMemeMcpServer(handlers, sdk = null) {
  sdk ??= await import("@anthropic-ai/claude-agent-sdk");
  const { z } = await import("zod");
  return sdk.createSdkMcpServer({
    name: "leileios-local-memes",
    version: "1.0.0",
    tools: [sdk.tool(
      "send_meme",
      "Send one meme from the fixed LeileiOS meme repository. Use an exact existing meme ID discovered from album.json or meme metadata; do not invent IDs. The image is delivered through the existing LeileiOS attachment pipeline.",
      { meme_id: z.string().regex(/^meme_[0-9]{4,32}(?![\s\S])/u) },
      async ({ meme_id }) => {
        try {
          const attachment = await handlers.sendMeme({ memeId: meme_id });
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                attachment_id: attachment.attachmentId,
                filename: attachment.filename,
                kind: "image",
              }),
            }],
          };
        } catch (cause) {
          const code =
            cause && typeof cause === "object"
            && typeof cause.code === "string"
              ? cause.code
              : "MEME_UNKNOWN";
          const safeCode =
            SAFE_MEME_ERRORS.has(code)
              ? code
              : "MEME_UNKNOWN";
          const message =
            SAFE_MEME_ERRORS.get(safeCode)
            ?? "Meme send failed for an unknown internal reason.";
          return {
            isError: true,
            content: [{
              type: "text",
              text: `send_meme failed [${safeCode}]: ${message}`,
            }],
          };
        }
      },
    )],
  });
}
