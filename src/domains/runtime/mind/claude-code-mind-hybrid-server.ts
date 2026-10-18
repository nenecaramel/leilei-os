import { createServer } from "node:http";
import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { BreathSemanticCandidate } from "../breath/breath-semantic-recall.js";

// Claude Code only. Do not add endpoints to the Native Live socket service.
const requestSchema = z.object({
  query: z.string().trim().min(1).max(16_000),
  candidates: z.array(z.object({
    stateId: z.string().uuid(),
    kind: z.literal("memory"),
    text: z.string().min(1).max(2_000),
  }).strict()).min(1).max(256),
}).strict();

export async function startClaudeCodeMindHybridServer(
  scorer: {scoreCandidatesHybrid(input: {
    query: string;
    candidates: readonly BreathSemanticCandidate[];
  }): Promise<{selectedIds: string[]}>},
  socketPath: string,
): Promise<() => Promise<void>> {
  const directory = dirname(socketPath);
  await mkdir(directory, {recursive: true, mode: 0o700});
  await chmod(directory, 0o700);
  try {
    const old = await lstat(socketPath);
    if (!old.isSocket() || old.uid !== process.getuid?.())
      throw new Error("Unexpected Claude Mind socket owner or type.");
    await unlink(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let busy = false;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/score-hybrid") {
      response.writeHead(404).end();
      return;
    }
    if (busy) {
      response.writeHead(503).end();
      return;
    }
    busy = true;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) throw new Error("Oversized candidate request.");
        chunks.push(chunk);
      }
      if (response.destroyed) return;
      const input = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (new Set(input.candidates.map(c => c.stateId)).size !== input.candidates.length)
        throw new Error("Repeated candidate ID.");
      const {selectedIds} = await scorer.scoreCandidatesHybrid(input);
      const validIds = new Set(input.candidates.map(c => c.stateId));
      if (!Array.isArray(selectedIds) || selectedIds.length > 2 ||
          new Set(selectedIds).size !== selectedIds.length ||
          selectedIds.some(id => typeof id !== "string" || !validIds.has(id)))
        throw new Error("Invalid hybrid selection.");
      if (!response.destroyed) {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({selected_ids: selectedIds}));
      }
    } catch {
      if (!response.destroyed) response.writeHead(503).end();
    } finally {
      busy = false;
    }
  });
  server.requestTimeout = 2_000;
  server.headersTimeout = 2_000;
  server.on("connection", socket => socket.setTimeout(2_500, () => socket.destroy()));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600);
  return async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await unlink(socketPath).catch(() => undefined);
  };
}
