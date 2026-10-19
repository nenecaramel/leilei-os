import { boundedOutput, isReasoning, structuredToolOutput } from "./output-contract.mjs";
const RESOURCE_LINK_MAX_ITEMS = 64;
const RESOURCE_LINK_URI_MAX_CHARS = 4_096;
const RESOURCE_LINK_NAME_MAX_CHARS = 512;
const RESOURCE_LINK_DESCRIPTION_MAX_CHARS = 2_000;
const RESOURCE_LINK_MIME_MAX_CHARS = 256;
const RESOURCE_LINK_META_MAX_CHARS = 8_000;
const TOOL_RESULT_TEXT_BUDGET_CHARS = 48_000;
const TOOL_RESULT_MAX_STRING_CHARS = 24_000;
const TOOL_RESULT_MAX_ARRAY_ITEMS = 32;
const TOOL_RESULT_MAX_OBJECT_KEYS = 48;
const TOOL_RESULT_MAX_DEPTH = 6;

import {
  clippedString,
  finiteNonNegative,
  safeHttpUrl,
  safeString,
} from './normalized-event-values.mjs';

export function normalizeResourceLinks(value) {
  if (!Array.isArray(value)) return [];

  const links = [];
  for (const item of value.slice(0, RESOURCE_LINK_MAX_ITEMS)) {
    if (
      !item
      || typeof item !== "object"
      || Array.isArray(item)
    ) {
      continue;
    }

    const uri = clippedString(
      item.uri,
      RESOURCE_LINK_URI_MAX_CHARS,
    );
    if (!uri) continue;

    const type = clippedString(item.type, 64);
    if (type && type !== "resource_link") continue;

    links.push({
      type: "resource_link",
      uri,
      name: clippedString(
        item.name,
        RESOURCE_LINK_NAME_MAX_CHARS,
      ),
      title: clippedString(
        item.title,
        RESOURCE_LINK_NAME_MAX_CHARS,
      ),
      description: clippedString(
        item.description,
        RESOURCE_LINK_DESCRIPTION_MAX_CHARS,
      ),
      mime_type: clippedString(
        item.mimeType ?? item.mime_type,
        RESOURCE_LINK_MIME_MAX_CHARS,
      ),
      size: finiteNonNegative(item.size),
      annotations:
        boundedResourceLinkMetadata(item.annotations),
      metadata:
        boundedResourceLinkMetadata(
          item._meta ?? item.meta,
        ),
    });
  }
  return links;
}

function boundedResourceLinkMetadata(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    return null;
  }
  try {
    const serialized = JSON.stringify(value);
    if (
      typeof serialized !== "string"
      || serialized.length > RESOURCE_LINK_META_MAX_CHARS
    ) {
      return null;
    }
    return boundedOutput(JSON.parse(serialized)).payload;
  } catch {
    return null;
  }
}

export function normalizeProviderSearchParts(block) {
  const candidates =
    block?.type === "search_result"
      ? [block]
      : Array.isArray(block?.content)
        ? block.content
        : [];

  const parts = [];
  for (const value of candidates.slice(0, 32)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const type = safeString(value.type);
    if (type !== "web_search_result" && type !== "search_result") {
      continue;
    }

    const title = safeString(value.title);
    const url = safeString(value.url);
    const source = safeString(value.source) ?? url;
    let snippet = safeString(value.snippet);

    if (!snippet && typeof value.content === "string") {
      snippet = value.content;
    } else if (!snippet && Array.isArray(value.content)) {
      const texts = value.content
        .slice(0, 16)
        .map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? safeString(item.text)
            : null,
        )
        .filter(Boolean);
      if (texts.length > 0) {
        snippet = texts.join("\n");
      }
    }

    if (!title && !url && !source && !snippet) {
      continue;
    }

    parts.push({
      type: "search_result",
      ...(title ? { title: title.slice(0, 2_000) } : {}),
      ...(source ? { source: source.slice(0, 8_000) } : {}),
      ...(url ? { url: url.slice(0, 8_000) } : {}),
      ...(snippet ? { snippet: snippet.slice(0, 8_000) } : {}),
    });
  }
  return parts;
}

export function normalizeToolResultPayload(
  block,
  resourceLinks = [],
  providerOutput = null,
) {
  const stats = {
    truncated: false,
    omittedBinaryItems: 0,
    omittedBinaryBytes: 0,
  };
  const budget = {
    remainingTextChars: TOOL_RESULT_TEXT_BUDGET_CHARS,
    remainingNodes: 512,
  };
  const output = projectToolResultValue(
    block.content,
    stats,
    budget,
    0,
  );

  const structuredEnvelope = boundedOutput(output);
  return {
    tool_use_id: block.tool_use_id,
    output,
    structured: {
      ...structuredToolOutput(structuredEnvelope.payload),
      ...(providerOutput ? {provider_output:providerOutput} : {}),
      truncated: stats.truncated || structuredEnvelope.truncated,
      redacted: stats.reasoningRedacted === true || structuredEnvelope.redacted,
    },
    is_error: Boolean(block.is_error),
    ...(resourceLinks.length > 0
      ? { resource_links: resourceLinks }
      : {}),
    ...(stats.truncated
      ? { output_truncated: true }
      : {}),
    ...(stats.omittedBinaryItems > 0
      ? {
          output_binary_omitted: true,
          omitted_binary_items:
            stats.omittedBinaryItems,
          omitted_binary_bytes:
            stats.omittedBinaryBytes,
        }
      : {}),
  };
}

function projectToolResultValue(
  value,
  stats,
  budget,
  depth,
) {
  if (--budget.remainingNodes < 0) {
    stats.truncated = true;
    return null;
  }
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (
    typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    const dataUrl = parseBase64DataUrl(value);
    if (dataUrl) {
      stats.omittedBinaryItems += 1;
      stats.omittedBinaryBytes += dataUrl.byteLength;
      return {
        type: "binary_omitted",
        encoding: "base64",
        media_type: dataUrl.mediaType,
        byte_length: dataUrl.byteLength,
      };
    }
    return boundedToolResultString(value, stats, budget);
  }
  if (depth >= TOOL_RESULT_MAX_DEPTH) {
    stats.truncated = true;
    return "[omitted: tool result nesting limit]";
  }
  if (Array.isArray(value)) {
    if (value.length > TOOL_RESULT_MAX_ARRAY_ITEMS) {
      stats.truncated = true;
    }
    return value
      .slice(0, Math.min(TOOL_RESULT_MAX_ARRAY_ITEMS, Math.max(0, budget.remainingNodes)))
      .map((item) =>
        projectToolResultValue(
          item,
          stats,
          budget,
          depth + 1,
        )
      );
  }
  if (typeof value !== "object") {
    return String(value);
  }

  const record = value;
  if (isReasoning(record)) { stats.reasoningRedacted = true; return {type:"reasoning_redacted"}; }
  if (isBase64BinaryRecord(record)) {
    const data =
      typeof record.data === "string"
        ? record.data
        : "";
    const byteLength = estimateBase64Bytes(data);
    stats.omittedBinaryItems += 1;
    stats.omittedBinaryBytes += byteLength;
    return {
      type:
        safeString(record.type)
        ?? "binary_omitted",
      ...(safeString(
        record.media_type ?? record.mime_type ?? record.mimeType,
      )
        ? {
            media_type: clippedString(
              record.media_type ?? record.mime_type ?? record.mimeType,
              256,
            ),
          }
        : {}),
      encoding: "base64",
      omitted: true,
      byte_length: byteLength,
    };
  }

  const keys = Object.keys(record);
  if (keys.length > TOOL_RESULT_MAX_OBJECT_KEYS) {
    stats.truncated = true;
  }
  const projected = {};
  for (
    const key of keys.slice(0, TOOL_RESULT_MAX_OBJECT_KEYS)
  ) {
    if (budget.remainingNodes <= 0) { stats.truncated = true; break; }
    const item = record[key];
    if (/^(thinking|reasoning|signature|encrypted_content|chain_of_thought)$/i.test(key)) { stats.reasoningRedacted = true; projected[key] = "[redacted: reasoning]"; continue; }
    if ((["blob", "bytes", "base64"].includes(key) || (key === "data" && (record.type === "base64" || record.encoding === "base64" || record.media_type || record.mime_type || record.mimeType || ["image", "document"].includes(record.type) || (typeof item === "string" && item.length >= 512 && /^[A-Za-z0-9+/=\s]+$/.test(item))))) && typeof item === "string") {
      const byteLength = estimateBase64Bytes(item);
      stats.omittedBinaryItems += 1;
      stats.omittedBinaryBytes += byteLength;
      projected[key] = {
        encoding: "base64",
        omitted: true,
        byte_length: byteLength,
      };
      continue;
    }
    let safeKey = boundedToolResultString(key.slice(0, 128), stats, budget);
    if (Object.hasOwn(projected, safeKey)) {
      stats.truncated = true;
      const prefix = safeKey.slice(0,116);
      let suffix = Object.keys(projected).length;
      do { safeKey = prefix + ':' + suffix++; } while (Object.hasOwn(projected,safeKey));
    }
    if (safeKey.length < key.length) stats.truncated = true;
    Object.defineProperty(projected, safeKey, {
      value: projectToolResultValue(item, stats, budget, depth + 1),
      enumerable: true,
    });
  }
  return projected;
}

function boundedToolResultString(value, stats, budget) {
  const allowed = Math.max(
    0,
    Math.min(
      value.length,
      TOOL_RESULT_MAX_STRING_CHARS,
      budget.remainingTextChars,
    ),
  );
  budget.remainingTextChars -= allowed;
  if (allowed < value.length) {
    stats.truncated = true;
  }
  return value.slice(0, allowed);
}

function isBase64BinaryRecord(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || typeof value.data !== "string"
  ) {
    return false;
  }
  const encoding =
    safeString(value.type)
    ?? safeString(value.encoding);
  if (encoding === "base64") return true;

  const mediaType = safeString(
    value.media_type ?? value.mime_type ?? value.mimeType,
  );
  return Boolean(
    mediaType
    && (
      mediaType.startsWith("image/")
      || mediaType.startsWith("audio/")
      || mediaType.startsWith("video/")
      || mediaType.startsWith("application/")
    )
  );
}

function parseBase64DataUrl(value) {
  const match =
    /^data:([^;,]{1,256});base64,([A-Za-z0-9+/=\s]+)$/u
      .exec(value);
  if (!match) return null;
  return {
    mediaType: match[1],
    byteLength: estimateBase64Bytes(match[2]),
  };
}

function estimateBase64Bytes(value) {
  if (typeof value !== "string" || value.length === 0) {
    return 0;
  }
  const compact = value.replace(/\s/gu, "");
  if (compact.length === 0) return 0;
  const padding =
    compact.endsWith("==")
      ? 2
      : compact.endsWith("=")
        ? 1
        : 0;
  return Math.max(
    0,
    Math.floor((compact.length * 3) / 4) - padding,
  );
}

export function normalizedToolUseMeta(value, toolUseId) {
  if (!toolUseId || !value) return null;

  let entry = null;
  if (Array.isArray(value)) {
    entry = value.find((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      return (
        candidate.id === toolUseId
        || candidate.tool_use_id === toolUseId
        || candidate.toolUseId === toolUseId
      );
    }) ?? null;
  } else if (typeof value === "object") {
    const keyed = value[toolUseId];
    if (keyed && typeof keyed === "object" && !Array.isArray(keyed)) {
      entry = keyed;
    }
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const displayName =
    clippedString(entry.display_name, 512)
    ?? clippedString(entry.displayName, 512)
    ?? clippedString(entry.name, 512);
  const serverDisplayName =
    clippedString(entry.server_display_name, 512)
    ?? clippedString(entry.serverDisplayName, 512);
  const iconUrl = safeHttpUrl(
    entry.icon_url ?? entry.iconUrl,
    2_048,
  );

  if (!displayName && !serverDisplayName && !iconUrl) {
    return null;
  }

  return {
    ...(displayName ? { display_name: displayName } : {}),
    ...(serverDisplayName
      ? { server_display_name: serverDisplayName }
      : {}),
    ...(iconUrl ? { icon_url: iconUrl } : {}),
  };
}
