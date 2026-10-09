export type WebExportDocument = {
  schema_version: 4;
  owner_fingerprint: string;
  exported_at: string;
  data: Record<string, unknown>;
};
