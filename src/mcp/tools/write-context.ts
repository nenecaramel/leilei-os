export const MCP_WRITE_TOOL_NAMES = [
  "create_task",
  "write_diary",
  "toy_set",
  "toy_stop",
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
