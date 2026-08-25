export const MAX_COMPACT_TEXT_CODE_POINTS = 240;

const ELLIPSIS = "…";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryPattern(query: string): RegExp | null {
  const tokens = query.normalize("NFC").trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return null;
  return new RegExp(tokens.map(escapeRegExp).join("\\s+"), "iu");
}

export function createLeadingPreview(value: string): string {
  const codePoints = Array.from(value.normalize("NFC"));
  if (codePoints.length <= MAX_COMPACT_TEXT_CODE_POINTS) return codePoints.join("");
  return `${codePoints.slice(0, MAX_COMPACT_TEXT_CODE_POINTS - 1).join("")}${ELLIPSIS}`;
}

export function createBodyMatchSnippet(content: string, query: string): string | null {
  const normalizedContent = content.normalize("NFC");
  const pattern = queryPattern(query);
  if (!pattern) return null;
  const match = pattern.exec(normalizedContent);
  if (!match) return null;

  const before = Array.from(normalizedContent.slice(0, match.index));
  const matched = Array.from(match[0]);
  const after = Array.from(normalizedContent.slice(match.index + match[0].length));
  if (before.length + matched.length + after.length <= MAX_COMPACT_TEXT_CODE_POINTS) {
    return normalizedContent;
  }

  if (matched.length >= MAX_COMPACT_TEXT_CODE_POINTS) {
    return `${matched.slice(0, MAX_COMPACT_TEXT_CODE_POINTS - 1).join("")}${ELLIPSIS}`;
  }

  const trimBefore = before.length > 0;
  const trimAfter = after.length > 0;
  let remaining = MAX_COMPACT_TEXT_CODE_POINTS - matched.length - (trimBefore ? 1 : 0) - (trimAfter ? 1 : 0);
  let beforeCount = Math.min(before.length, Math.floor(remaining / 2));
  let afterCount = Math.min(after.length, remaining - beforeCount);
  remaining -= beforeCount + afterCount;
  if (remaining > 0) {
    const beforeExtra = Math.min(before.length - beforeCount, remaining);
    beforeCount += beforeExtra;
    remaining -= beforeExtra;
    afterCount += Math.min(after.length - afterCount, remaining);
  }

  const prefix = beforeCount > 0 ? before.slice(-beforeCount).join("") : "";
  const suffix = afterCount > 0 ? after.slice(0, afterCount).join("") : "";
  return `${trimBefore ? ELLIPSIS : ""}${prefix}${matched.join("")}${suffix}${trimAfter ? ELLIPSIS : ""}`;
}
