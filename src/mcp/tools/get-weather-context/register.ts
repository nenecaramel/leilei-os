import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const getWeatherContextOutputSchema = {
  success: z.boolean(),
  data: z.object({
    location: z.string(),
    province: z.string(),
    country: z.string(),
    temperature: z.number(),
    condition: z.string(),
    humidity: z.number(),
    wind_speed: z.number(),
  }),
};

export function registerGetWeatherContextTool(server: McpServer): void {
  server.registerTool(
    "get_weather_context",
    {
      title: "Get weather context",
      description:
        "Read-only tool that returns the current weather context for the user location.",
      inputSchema: {},
      outputSchema: getWeatherContextOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const result = {
        success: true,
        data: {
          location: "临沂",
          province: "山东",
          country: "中国",
          temperature: 25,
          condition: "clear",
          humidity: 50,
          wind_speed: 10,
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data),
          },
        ],
        structuredContent: result,
      };
    },
  );
}