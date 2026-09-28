export type WebExportScope = "all" | "diary" | "todo";

export type WebExportDocument = {
  schema_version: 3;
  owner_fingerprint: string;
  exported_at: string;
  data: Record<string, unknown>;
  audit?: {
    lifecycle: unknown[];
    tool_activity: unknown[];
  };
};
