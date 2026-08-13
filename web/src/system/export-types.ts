export type WebExportScope = "all" | "memory" | "diary" | "task" | "todo";

export type WebExportDocument = {
  schema_version: 1;
  exported_at: string;
  data: Record<string, unknown[]>;
  audit?: {
    lifecycle: unknown[];
    tool_activity: unknown[];
  };
};
