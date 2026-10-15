/** A local drain receipt is not a server ownership release. The existing
 * native-file/process preflight and transactional release still run afterward. */
export async function drainNativeLiveMacSession(input: {
  session: { readonly tasks: ReadonlyMap<string, unknown>; stopTask(id: string): Promise<void>; completion: Promise<void> };
  fence(): void; close(): Promise<void>; settle(): Promise<void>; timeoutMs?: number;
}): Promise<{ ready: boolean; tasks: Array<{ id: string; status: "stopped" | "completed" | "unknown" }>; writer: "closed" | "unknown" }> {
  const timeout = input.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) throw new Error("Invalid drain deadline.");
  input.fence(); // Synchronous: no new work enters while stop/close await.
  const ids = [...input.session.tasks.keys()], stopped = new Set<string>();
  const deadline = Date.now() + timeout;
  const bounded = async <T>(work: Promise<T>, end = deadline): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Drain deadline expired.")), Math.max(0, end - Date.now())); })]); }
    finally { clearTimeout(timer); }
  };
  let writer: "closed" | "unknown" = "unknown", settled = false;
  try {
    // Leave half the budget to close the writer even when task stop hangs.
    const stopDeadline = Date.now() + Math.floor(timeout / 2);
    await bounded(Promise.allSettled(ids.map(async id => { await input.session.stopTask(id); stopped.add(id); })), stopDeadline).catch(() => {});
    // Only SDK task membership can prove a stop; a successful RPC cannot.
    while (ids.some(id => input.session.tasks.has(id)) && Date.now() < stopDeadline) {
      await new Promise(resolve => setTimeout(resolve, Math.min(10, Math.max(1, stopDeadline - Date.now()))));
    }
    await bounded(input.close());
    await bounded(input.session.completion);
    writer = "closed";
    await bounded(input.settle()); settled = true;
  } catch { /* Fail closed with a metadata-only receipt; never guess. */ }
  const allIds = [...new Set([...ids, ...input.session.tasks.keys()])];
  const tasks = allIds.map(id => ({ id, status: input.session.tasks.has(id) ? "unknown" as const : stopped.has(id) ? "stopped" as const : "completed" as const }));
  return { ready: writer === "closed" && settled && input.session.tasks.size === 0 && tasks.every(task => task.status !== "unknown"), tasks, writer };
}
