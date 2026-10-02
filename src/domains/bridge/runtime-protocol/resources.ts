import type { NativeLiveRuntimeOutputResource } from "./types.js";
import {
  NativeLiveRuntimeProtocolError,
  requireRecord,
  requireExactKeys,
  boundedNullableString,
  requireBoundedNonblank,
  parseBoundedJsonRecord,
  nullableFiniteNumber,
} from "./parsing.js";

export function parseNativeLiveRuntimeOutputResources(
  value: unknown,
): NativeLiveRuntimeOutputResource[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new NativeLiveRuntimeProtocolError(
      "output_resources must contain at most 128 items.",
    );
  }

  return value.map((item, index) => {
    const body = requireRecord(item);
    requireExactKeys(body, [
      "source",
      "tool_use_id",
      "task_id",
      "uri",
      "name",
      "title",
      "description",
      "mime_type",
      "size",
      "annotations",
      "metadata",
    ]);

    if (
      body.source !== "tool_result"
      && body.source !== "task_notification"
    ) {
      throw new NativeLiveRuntimeProtocolError(
        `output_resources[${index}].source is invalid.`,
      );
    }

    return {
      source: body.source,
      tool_use_id: boundedNullableString(
        body.tool_use_id,
        `output_resources[${index}].tool_use_id`,
        256,
      ),
      task_id: boundedNullableString(
        body.task_id,
        `output_resources[${index}].task_id`,
        256,
      ),
      uri: requireBoundedNonblank(
        body.uri,
        `output_resources[${index}].uri`,
        4_096,
      ),
      name: boundedNullableString(
        body.name,
        `output_resources[${index}].name`,
        512,
      ),
      title: boundedNullableString(
        body.title,
        `output_resources[${index}].title`,
        512,
      ),
      description: boundedNullableString(
        body.description,
        `output_resources[${index}].description`,
        2_000,
      ),
      mime_type: boundedNullableString(
        body.mime_type,
        `output_resources[${index}].mime_type`,
        256,
      ),
      size: nullableNonNegativeFiniteNumber(
        body.size,
        `output_resources[${index}].size`,
      ),
      annotations: parseBoundedJsonRecord(
        body.annotations,
        `output_resources[${index}].annotations`,
        8_000,
      ),
      metadata: parseBoundedJsonRecord(
        body.metadata,
        `output_resources[${index}].metadata`,
        8_000,
      ),
    };
  });
}

function nullableNonNegativeFiniteNumber(
  value: unknown,
  field: string,
): number | null {
  const parsed = nullableFiniteNumber(value, field);
  if (parsed !== null && parsed < 0) {
    throw new NativeLiveRuntimeProtocolError(
      `${field} must be non-negative or null.`,
    );
  }
  return parsed;
}
