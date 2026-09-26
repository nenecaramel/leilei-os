import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getWeather } from "../../../domains/weather/weather-service.js";

const getWeatherContextOutputSchema = {
  success: z.boolean(),
  data: z.object({
    location: z.string(),
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
        "Read current weather context for the user location.",
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
        const weather = await getWeather(
          35.1046,
          118.3564,
          "山东临沂",
        );
      
        const result = {
          success: true,
          data: weather,
        };
      
        return {
          content: [
            {
              type: "text",
              text: `Weather at ${weather.location}: ${weather.temperature}°C, ${weather.condition}, humidity ${weather.humidity}%, wind ${weather.wind_speed} km/h.`,
            },
          ],
          structuredContent: result,
        };
      },
  );
}
