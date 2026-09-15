export type WebExportScope = "all" | "memory" | "diary" | "task" | "todo" | "shared_paper";

export type WebExportDocument = {
  schema_version: 2;
  owner_fingerprint: string;
  exported_at: string;
  data: Record<string, unknown[]>;
  audit?: {
    lifecycle: unknown[];
    tool_activity: unknown[];
  };
};
