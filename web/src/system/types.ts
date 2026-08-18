export type SystemConnections = {
  web_api: "online";
  public_mcp: "available";
  internal_mcp: "available" | "not_enabled";
};

export type SystemConnectionsResponse = {
  success: true;
  data: SystemConnections;
};

export type SystemDataSummary = {
  memory: {
    active: number;
    archived: number;
  };
  diary: {
    active: number;
    archived: number;
  };
  task: {
    active: number;
    archived: number;
  };
};

export type SystemDataResponse = {
  success: true;
  data: SystemDataSummary;
};

export type SystemActivityItem = {
  id: string;
  occurred_at: string;
  label: string;
  source:
    | "Web"
    | "MCP"
    | "Internal"
    | "System";
  outcome: "success" | "failed";
};

export type SystemActivityResponse = {
  success: true;
  data: {
    events: SystemActivityItem[];
  };
};
