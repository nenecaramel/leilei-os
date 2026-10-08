export const MCP_WRITE_TOOL_NAMES = [
  "write_memory",
  "update_memory",
  "write_diary",
  "toy_set",
  "toy_stop",
  "write_todo_paper",
  "append_todo_entry",
  "append_todo_entries",
  "update_todo_entry",
  "delete_todo_entry",
  "update_diary",
  "add_diary_comment",
  "update_diary_comment",
  "delete_diary_comment",
  "create_universe_node",
  "update_universe_node",
  "create_universe_relation",
  "update_universe_relation",
  "delete_universe_relation",
  "add_universe_diary_source",
  "delete_universe_diary_source",
] as const;

export type McpWriteToolName = (typeof MCP_WRITE_TOOL_NAMES)[number];

export type McpWriteContext = {
  userId: string;
  toolName: McpWriteToolName;
  actorType: "user";
  channel: "mcp";
  source: "mcp";
};

export async function invokeMcpWrite<TSuccess, TError>(input: {
  toolName: McpWriteToolName;
  getAuthenticatedUserId: () => string;
  operation: (context: McpWriteContext) => Promise<TSuccess>;
  mapError: (error: unknown) => TError | Promise<TError>;
}): Promise<TSuccess | TError> {
  try {
    const context: McpWriteContext = {
      userId: input.getAuthenticatedUserId(),
      toolName: input.toolName,
      actorType: "user",
      channel: "mcp",
      source: "mcp",
    };

    return await input.operation(context);
  } catch (error) {
    return await input.mapError(error);
  }
}
