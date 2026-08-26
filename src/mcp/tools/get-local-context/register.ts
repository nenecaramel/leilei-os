import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const getLocalContextOutputSchema = {
  success: z.boolean(),
  data: z.object({
    timezone: z.string(),
    local_datetime: z.string(),
    local_date: z.string(),
    local_time: z.string(),
    day_of_week: z.string(),
    day_period: z.string(),
    utc_offset: z.string(),
  }),
};

function getDayPeriod(hour: number): string {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export function registerGetLocalContextTool(server: McpServer): void {
  server.registerTool(
    "get_local_context",
    {
      title: "Get local time context",
      description:
        "Read-only tool that returns the user's current local date, time, timezone, weekday, and day period.",
      inputSchema: {},
      outputSchema: getLocalContextOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const timezone = "Asia/Shanghai";

      const now = new Date();

      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        weekday: "long",
        timeZoneName: "longOffset",
      });

      const parts = formatter.formatToParts(now);

      const get = (type: string) =>
        parts.find((p) => p.type === type)?.value ?? "";

      const hour = Number(get("hour"));

      const result = {
        success: true,
        data: {
          timezone,
          local_datetime: now.toLocaleString("sv-SE", {
            timeZone: timezone,
          }),
          local_date: `${get("year")}-${get("month")}-${get("day")}`,
          local_time: `${get("hour")}:${get("minute")}`,
          day_of_week: get("weekday"),
          day_period: getDayPeriod(hour),
          utc_offset: get("timeZoneName").replace("GMT", ""),
        },
      };

      return {
        content: [
          {
            type: "text",
            text: "Local context retrieved.",
          },
        ],
        structuredContent: result,
      };
    },
  );
}
