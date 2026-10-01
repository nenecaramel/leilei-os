import { createHash } from "node:crypto";

export function nativeLiveMindFollowUpStateId(
  prepareId: string,
  index: number,
): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("Mind follow-up state index must be a nonnegative integer.");
  }

  const digest = createHash("sha256")
    .update("leileios:mind-follow-up:v1:" + prepareId + ":" + index, "utf8")
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
