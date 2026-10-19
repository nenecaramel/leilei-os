import type { MindProductService } from "../../domains/runtime/mind/mind-product-service.js";
import type { WriteMemoryDependencies } from "../tools/write-memory/register.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiaryService } from "../../domains/diary/diary-service.js";
import type { DiaryCommentService } from "../../domains/diary/diary-comment-service.js";
import type { GlobalSearchService } from "../../domains/global-search/global-search-service.js";
import type { ActiveUserRepository } from "../../domains/require-active-user.js";
import type { TodoService } from "../../domains/todo/todo-service.js";
import type { ToyCommandService } from "../../domains/toy/toy-command-service.js";
import type { UniverseService } from "../../domains/universe/universe-service.js";
import type { McpSessionNamespace } from "./session-registry.js";
import type { HealthService } from "../../domains/health-v2/health-service.js";
import {
  createActiveUserAuthorizer,
  createMcpServer,
  type McpServerDependencies,
} from "./create-server.js";
import { registerProductionNotionExplicitWriteTools } from "./register-notion-explicit-writes.js";
import { registerProductionNotionTypedWriteTools } from "./register-notion-typed-writes.js";
import { registerRenderNoteCardTool } from "../tools/render-thinking-block/register.js";
import { registerNoteCardResource } from "../tools/render-thinking-block/resource.js";
import { registerGetHealthTool } from "../tools/get-health/register.js";
import { registerGetCurrentTimeTool } from "../tools/get-current-time/register.js";
import {
  registerUpdateConcernTool,
  type UpdateConcernToolDependencies,
} from "../tools/update-concern/register.js";
import {
  DEFAULT_INTERNAL_MCP_TOOL_PROFILES,
  DEFAULT_PUBLIC_MCP_TOOL_PROFILES,
  mcpToolSurfaceEnabled,
  resolveMcpToolExposure,
  type McpToolProfileName,
} from "./tool-profiles.js";

export type McpSessionServerFactory = (
  authenticatedUserId: string,
  namespace?: McpSessionNamespace,
) => McpServer;

export function createProductionMcpSessionServerFactory(input: {
  activeUserRepository: ActiveUserRepository;
  mindService?: MindProductService;
  memoryRepository?: WriteMemoryDependencies["repository"];
  memorySubjectId?: string;
  diaryService: DiaryService;
  diaryCommentService?: DiaryCommentService;
  toyCommandService: ToyCommandService;
  globalSearchService: GlobalSearchService;
  todoService: TodoService;
  universeService: UniverseService;
  healthService: HealthService;
  // Native Live only: concerns bind to the active Native Live conversation.
  concernService?: UpdateConcernToolDependencies["concernService"];
  publicToolProfiles?: readonly McpToolProfileName[];
  internalToolProfiles?: readonly McpToolProfileName[];
}): McpSessionServerFactory {
  return (userId, namespace = "public") => {
    const activeUserAuthorization = createActiveUserAuthorizer(
      input.activeUserRepository,
      userId,
    );
    const getAuthenticatedUserId = () => userId;
    const toolExposure = resolveMcpToolExposure(
      namespace === "public"
        ? (input.publicToolProfiles ?? DEFAULT_PUBLIC_MCP_TOOL_PROFILES)
        : (input.internalToolProfiles ?? DEFAULT_INTERNAL_MCP_TOOL_PROFILES),
    );
    const dependencies: McpServerDependencies = {
      activeUserAuthorization,
      ...(input.mindService ? {memoryTools: {mindService: input.mindService, requireActiveUser: activeUserAuthorization}} : {}),
      ...(input.memoryRepository ? {writeMemory: {
        repository: input.memoryRepository, subjectId: input.memorySubjectId ?? "G",
        requireActiveUser: activeUserAuthorization,
      }} : {}),
      diaryTools: {
        diaryService: input.diaryService,
        getAuthenticatedUserId,
      },
      updateDiary: {
        diaryService: input.diaryService,
        getAuthenticatedUserId,
      },
      ...(input.diaryCommentService
        ? {
            diaryComments: {
              diaryCommentService: input.diaryCommentService,
              getAuthenticatedUserId,
            },
          }
        : {}),
      toyCommand: {
        toyCommandService: input.toyCommandService,
        getAuthenticatedUserId,
      },
      globalSearch: {
        globalSearchService: input.globalSearchService,
        getAuthenticatedUserId,
      },
      todoTools: {
        todoService: input.todoService,
        getAuthenticatedUserId,
      },
      universeTools: {
        universeService: input.universeService,
        getAuthenticatedUserId,
      },
      universeWriteTools: {
        nodeService: input.universeService,
        relationService: input.universeService,
        getAuthenticatedUserId,
      },
      universeProvenanceTools: {
        relationService: input.universeService,
        sourceService: input.universeService,
        getAuthenticatedUserId,
      },
    };
    const server = createMcpServer(
      dependencies,
      userId,
      toolExposure,
    );
    if (mcpToolSurfaceEnabled(toolExposure, "notion")) {
      registerProductionNotionTypedWriteTools(
        server,
        userId,
        activeUserAuthorization,
      );
    }
    if (mcpToolSurfaceEnabled(toolExposure, "notion_advanced")) {
      registerProductionNotionExplicitWriteTools(
        server,
        userId,
        activeUserAuthorization,
      );
    }
    if (mcpToolSurfaceEnabled(toolExposure, "device")) {
      registerGetHealthTool(server, {
        healthService: input.healthService,
        getAuthenticatedUserId,
      });
      registerGetCurrentTimeTool(server, {
        requireActiveUser: activeUserAuthorization,
      });
    }
    if (mcpToolSurfaceEnabled(toolExposure, "ui")) {
      registerNoteCardResource(server);
      registerRenderNoteCardTool(server);
    }
    if (namespace === "internal" && input.concernService) {
      registerUpdateConcernTool(server, {
        concernService: input.concernService,
        requireActiveUser: activeUserAuthorization,
      });
    }
    return server;
  };
}
