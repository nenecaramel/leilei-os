import type { WebApiClient } from "../api/useWebApiClient";

export type WebImportModule =
  | "diary"
  | "diary_comments"
  | "todo"
  | "workspaces"
  | "mind"
  | "conversations"
  | "universe";

export type WebImportModuleSummary = {
  create: number;
  duplicate: number;
  conflict: number;
  invalid: number;
};

type WebImportMetadata = {
  schema_version: 2 | 3 | 4;
  exported_at: string;
  raw_bytes: number;
  included_modules: WebImportModule[];
  audit_included: boolean;
  package_sha256: string;
  preview_fingerprint: string;
  summary: Partial<Record<WebImportModule, WebImportModuleSummary>>;
};

export type WebImportPreview = WebImportMetadata & {
  can_execute: boolean;
};

export type WebImportExecution = WebImportMetadata;

export async function previewImport(
  api: WebApiClient,
  bytes: Uint8Array,
): Promise<WebImportPreview> {
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const response = await api.request<{ data: WebImportPreview }>(
    "/system/import/preview",
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    },
  );
  return response.data;
}

export async function executeImport(
  api: WebApiClient,
  bytes: Uint8Array,
  fingerprint: string,
): Promise<WebImportExecution> {
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const response = await api.request<{ data: WebImportExecution }>(
    `/system/import/execute?expected_preview_fingerprint=${encodeURIComponent(fingerprint)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    },
  );
  return response.data;
}
