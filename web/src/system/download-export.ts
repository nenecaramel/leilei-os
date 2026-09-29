import type { WebExportDocument } from "./export-types";

export function downloadExportDocument(
  document: WebExportDocument,
): void {
  const json = JSON.stringify(document, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = objectUrl;
  anchor.download =
    `leileios-full-backup_${sanitizeExportTimestamp(document.exported_at)}.json`;
  try {
    window.document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}

function sanitizeExportTimestamp(value: string): string {
  const compact = value
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z")
    .replace(/[^0-9TZ]/gu, "");
  return compact || "unknown";
}
