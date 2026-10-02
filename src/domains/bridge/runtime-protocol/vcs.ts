import type { NativeLiveRuntimeVcsChange } from "./types.js";
import {
  NativeLiveRuntimeProtocolError,
  requireRecord,
  requireExactKeys,
  requireBoundedNonblank,
  boundedNullableString,
} from "./parsing.js";

export function parseNativeLiveRuntimeVcsChanges(
  value: unknown,
): NativeLiveRuntimeVcsChange[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new NativeLiveRuntimeProtocolError(
      "vcs_changes must contain at most 64 items.",
    );
  }

  return value.map((item, index) => {
    const body = requireRecord(item);
    requireExactKeys(body, [
      "mutation_kind",
      "cwd",
      "branch",
    ]);

    return {
      mutation_kind: requireBoundedNonblank(
        body.mutation_kind,
        `vcs_changes[${index}].mutation_kind`,
        128,
      ),
      cwd: requireBoundedNonblank(
        body.cwd,
        `vcs_changes[${index}].cwd`,
        4_096,
      ),
      branch: boundedNullableString(
        body.branch,
        `vcs_changes[${index}].branch`,
        512,
      ),
    };
  });
}
