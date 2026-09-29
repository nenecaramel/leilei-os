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
  diary: {
    active: number;
    archived: number;
  };
  diary_comments: {
    count: number;
  };
  todo: {
    active: number;
    count: number;
  };
  workspaces: {
    count: number;
  };
  conversations: {
    active: number;
    archived: number;
  };
  mind: {
    count: number;
  };
  universe: {
    nodes: number;
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
