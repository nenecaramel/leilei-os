import { createHash } from "node:crypto";

const OWNER_FINGERPRINT_NAMESPACE = "leileios-owner-v1\0";

export function createOwnerFingerprint(userId: string): string {
  return createHash("sha256")
    .update(`${OWNER_FINGERPRINT_NAMESPACE}${userId}`, "utf8")
    .digest("hex");
}
