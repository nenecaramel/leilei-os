const UNIVERSE_LOCATION_SENTINEL = "https://leilei-os.invalid";

function isSafeUniverseNodeId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 256;
}

export function createUniverseNodeReturnTo(nodeId: string): string {
  if (!isSafeUniverseNodeId(nodeId)) return "/universe";
  const params = new URLSearchParams();
  params.set("node", nodeId);
  return `/universe?${params.toString()}`;
}

export function getSafeUniverseNodeReturnTo(value: string | null): string {
  if (!value) return "/universe";
  try {
    const parsed = new URL(value, UNIVERSE_LOCATION_SENTINEL);
    const keys = [...parsed.searchParams.keys()];
    if (
      parsed.origin !== UNIVERSE_LOCATION_SENTINEL ||
      parsed.pathname !== "/universe" ||
      parsed.hash ||
      keys.length !== 1 ||
      keys[0] !== "node" ||
      parsed.searchParams.getAll("node").length !== 1
    ) return "/universe";
    const nodeId = parsed.searchParams.get("node") ?? "";
    return isSafeUniverseNodeId(nodeId) ? createUniverseNodeReturnTo(nodeId) : "/universe";
  } catch {
    return "/universe";
  }
}

export function isUniverseNodeReturnTo(value: string): boolean {
  return value !== "/universe" && getSafeUniverseNodeReturnTo(value) === value;
}

function readUniverseNodeTarget(search: string, nodeIds: readonly string[]): string | null {
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
