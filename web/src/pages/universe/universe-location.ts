export function readUniverseNodeTarget(search: string, nodeIds: readonly string[]): string | null {
  const nodeId = new URLSearchParams(search).get("node");
  return nodeId && nodeIds.includes(nodeId) ? nodeId : null;
}
