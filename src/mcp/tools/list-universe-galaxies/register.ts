import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { UniverseService } from "../../../domains/universe/universe-service.js";
import { mcpToolErrorDetailsSchema } from "../error-contract.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";
import { safeUniverseReadError } from "../universe/shared.js";

const galaxySchema = z.object({
  id: z.string().min(1).max(256).describe("Galaxy ID to use in create_universe_node or update_universe_node memberships."),
  title: z.string(),
  description: z.string(),
  color: z.string(),
  order: z.number().int(),
}).strict();

const outputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    galaxies: z.array(galaxySchema),
    metadata: z.object({ count: z.number().int().nonnegative() }).strict(),
    universe_version: z.number().int().nonnegative(),
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export type ListUniverseGalaxiesToolDependencies = {
  universeService: Pick<UniverseService, "loadUniverse">;
  getAuthenticatedUserId: () => string;
};

export function registerListUniverseGalaxiesTool(
  server: McpServer,
  dependencies: ListUniverseGalaxiesToolDependencies,
): void {
  server.registerTool(
    "list_universe_galaxies",
    {
      title: "List Universe galaxies",
      description: "List existing Universe galaxies and their IDs for node membership.",
      inputSchema: z.object({}).strict(),
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const { snapshot, version } = await dependencies.universeService.loadUniverse(userId);
        const galaxies = [...snapshot.galaxies]
          .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
          .map((galaxy) => ({
            id: galaxy.id,
            title: galaxy.title,
            description: galaxy.description,
            color: galaxy.color,
            order: galaxy.order,
          }));

        return {
          content: [{
            type: "text" as const,
            text: joinMcpContentLines([
              `Found ${galaxies.length} Universe galaxies.`,
              ...galaxies.map((galaxy) =>
                `${quoteMcpText(galaxy.title)} [id=${galaxy.id}; order=${galaxy.order}] — ${quoteMcpText(galaxy.description)}`
              ),
              ...(galaxies.length === 0 ? ["empty"] : []),
            ]),
          }],
          structuredContent: {
            success: true as const,
            data: {
              galaxies,
              metadata: { count: galaxies.length },
              universe_version: version,
            },
          },
        };
      } catch (error) {
        return safeUniverseReadError(error, "Universe is unavailable.");
      }
    },
  );
}
