export function readUniverseNodeTarget(search: string, nodeIds: readonly string[]): string | null {
  const nodeId = new URLSearchParams(search).get("node");
  return nodeId && nodeIds.includes(nodeId) ? nodeId : null;
}

export function consumeUniverseNodeTarget(
  search: string,
  nodeIds: readonly string[],
): { nodeId: string; remainingSearch: string } | null {
  const nodeId = readUniverseNodeTarget(search, nodeIds);
  if (!nodeId) return null;
  const params = new URLSearchParams(search);
  params.delete("node");
  const encoded = params.toString();
  return { nodeId, remainingSearch: encoded ? `?${encoded}` : "" };
}
