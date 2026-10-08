import type {
  WebImportModule,
  WebImportModuleSummary,
} from "../../system/import-types";

const EMPTY_COUNTS: WebImportModuleSummary = {
  create: 0,
  duplicate: 0,
  conflict: 0,
  invalid: 0,
};

export function moduleCounts(
  summary: Partial<Record<WebImportModule, WebImportModuleSummary>>,
  module: WebImportModule,
): WebImportModuleSummary {
  return summary[module] ?? EMPTY_COUNTS;
}

export function countImport(
  summary: Partial<Record<WebImportModule, WebImportModuleSummary>>,
  key: keyof WebImportModuleSummary,
): number {
  return Object.values(summary).reduce(
    (total, counts) => total + (counts?.[key] ?? 0),
    0,
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatExportedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function fileSummary(filename: string, size: number): string {
  return `${filename} · ${formatBytes(size)}`;
}

export function formatModuleCounts(counts: WebImportModuleSummary): string {
  const parts: string[] = [];
  if (counts.create > 0) parts.push(`${counts.create} new`);
  if (counts.duplicate > 0) parts.push(`${counts.duplicate} already here`);
  if (counts.conflict > 0) parts.push(`${counts.conflict} conflict`);
  if (counts.invalid > 0) parts.push(`${counts.invalid} invalid`);
  return parts.length > 0 ? parts.join(" · ") : "No records";
}

