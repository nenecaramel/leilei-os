

export function safeHttpUrl(value, maxChars) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxChars
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function finiteNonNegative(value) {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    ? value
    : null;
}

export function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

export function isoTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis =
      Math.abs(value) < 10_000_000_000
        ? value * 1_000
        : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime())
      ? null
      : date.toISOString();
  }
  if (typeof value === "string" && value.length > 0) {
    const millis = Date.parse(value);
    return Number.isNaN(millis)
      ? null
      : new Date(millis).toISOString();
  }
  return null;
}

export function safeString(value) {
  return typeof value === "string" && value.length > 0
    ? value
    : null;
}

export function clippedString(value, maxChars) {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length <= maxChars
    ? value
    : value.slice(0, maxChars);
}
