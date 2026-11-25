import { createServer, type IncomingMessage } from "node:http";
import { mkdir, chmod, lstat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { z } from "zod";
import { mindComparisonOfferSchema, type MindComparisonOffer } from "./native-live-mac-mind-comparison.js";
import type { BreathSemanticScorer } from "../../runtime/breath/breath-semantic-recall.js";

export function defaultMindRecallSocket() {
  return join(homedir(), ".leileios", "claude-code-mind", "semantic.sock");
}
const schema = z.object({
  query: z.string().min(1).max(16000),
  candidates: z.array(z.object({stateId: z.string().uuid(), kind: z.literal("memory"), text: z.string().max(2000)}).strict()).min(1).max(256),
}).strict();

async function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Body too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Local-only transport for the daemon's existing warm scorer; no Mind storage or queue. */
export async function startMindRecallSemanticServer(
  scorer: BreathSemanticScorer,
  socketPath = defaultMindRecallSocket(),
  comparison?: {offer(input: MindComparisonOffer): boolean},
) {
  await mkdir(dirname(socketPath), {recursive: true, mode: 0o700});
  await chmod(dirname(socketPath), 0o700);
  // The caller holds the existing single-owner daemon lock. Remove only its old socket.
  try {
    const old = await lstat(socketPath);
    if (!old.isSocket() || old.uid !== process.getuid?.()) throw new Error("Unexpected semantic socket owner/type.");
    await unlink(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let busy = false;
  const server = createServer(async (request, response) => {
    if (comparison && request.method === "POST" && request.url === "/compare") {
      // Independent of the scorer's busy flag: the real recall never waits for this.
      try {
        const input = mindComparisonOfferSchema.parse(await readJson(request, 1024 * 1024));
        comparison.offer(input);
        response.writeHead(202).end();
      } catch { if (!response.destroyed) response.writeHead(400).end(); }
      return;
    }
    if (request.method !== "POST" || request.url !== "/score") { response.writeHead(404).end(); return; }
    if (busy) { response.writeHead(503).end(); return; }
    busy = true;
    try {
      const payload = await readJson(request, 4 * 1024 * 1024);
      if (response.destroyed) return;
      const input = schema.parse(payload);
      const scores = await scorer.score(input);
      if (!response.destroyed) {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({scores: Object.fromEntries(scores)}));
      }
    } catch { if (!response.destroyed) response.writeHead(503).end(); }
    finally { busy = false; }
  });
  server.requestTimeout = 2000;
  server.headersTimeout = 2000;
  server.on("connection", socket => socket.setTimeout(2500, () => socket.destroy()));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  await chmod(socketPath, 0o600);
  return async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await unlink(socketPath).catch(() => undefined);
  };
}
