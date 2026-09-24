import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ActiveUserAuthorizationError } from "../../../domains/require-active-user.js";
import { formatCurrentTime } from "../../../domains/time/current-time.js";
import { joinMcpContentLines } from "../content-contract.js";
import { createMcpToolError } from "../error-contract.js";

const getCurrentTimeInputSchema = z.object({}).strict();

const getCurrentTimeOutputSchema = z.object({
  date: z.string(),
  time: z.string(),
  datetime: z.string(),
  timezone: z.literal("Asia/Shanghai"),
  weekday: z.string(),
}).strict();

export type GetCurrentTimeToolDependencies = {
  requireActiveUser: () => Promise<string>;
  now?: () => Date;
};

export function registerGetCurrentTimeTool(
  server: McpServer,
  dependencies: GetCurrentTimeToolDependencies,
): void {
  server.registerTool(
    "get_current_time",
    {
      title: "Get current time",
      description: "Read the current time in Asia/Shanghai.",
      inputSchema: getCurrentTimeInputSchema,
      outputSchema: getCurrentTimeOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        await dependencies.requireActiveUser();
        const now = dependencies.now ?? (() => new Date());
        const currentTime = formatCurrentTime(now());
        return {
          content: [{
            type: "text" as const,
            text: joinMcpContentLines([
              `Current time: date=${currentTime.date}; time=${currentTime.time}; datetime=${currentTime.datetime}; timezone=${currentTime.timezone}; weekday=${currentTime.weekday}.`,
            ]),
          }],
          structuredContent: currentTime,
        };
      } catch (error) {
        if (error instanceof ActiveUserAuthorizationError) {
          return createMcpToolError(
            "AUTHENTICATION_REQUIRED",
            "Authentication is required to read the current time.",
          );
        }
        return createMcpToolError(
          "INTERNAL_ERROR",
          "Current time is temporarily unavailable.",
        );
      }
    },
  );
}
