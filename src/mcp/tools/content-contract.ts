const DEFAULT_TEXT_LIMIT = 240;

export function compactMcpText(value: string, limit = DEFAULT_TEXT_LIMIT): string {
  const normalized = value.normalize("NFC").replace(/\s+/g, " ").trim();
  const codePoints = Array.from(normalized);
  return codePoints.length <= limit
    ? normalized
    : `${codePoints.slice(0, Math.max(0, limit - 1)).join("")}…`;
}

export function quoteMcpText(value: string, limit = DEFAULT_TEXT_LIMIT): string {
  return JSON.stringify(compactMcpText(value, limit));
}

export function formatMcpDetailPointer(
  tool: string,
  args: Record<string, string>,
): string {
  return `${tool}(${Object.entries(args).map(([key, value]) => `${key}=${value}`).join(", ")})`;
}

export function joinMcpContentLines(lines: readonly string[]): string {
  return lines.filter((line) => line.trim().length > 0).join("\n");
}
