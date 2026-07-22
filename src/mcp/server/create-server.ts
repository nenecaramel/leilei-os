import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerHelloTool } from "../tools/hello/register.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "leilei-os",
    version: "0.1.0",
  });

  registerHelloTool(server);
  return server;
}
