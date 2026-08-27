import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiaryService } from "../../domains/diary/diary-service.js";
import type { GlobalSearchService } from "../../domains/global-search/global-search-service.js";
import type { MemoryService } from "../../domains/memory/memory-service.js";
import type { ActiveUserRepository } from "../../domains/require-active-user.js";
import type { TaskService } from "../../domains/task/task-service.js";
import type { TodoService } from "../../domains/todo/todo-service.js";
import type { ToyCommandService } from "../../domains/toy/toy-command-service.js";
import type { UniverseService } from "../../domains/universe/universe-service.js";
import {
  createActiveUserAuthorizer,
  createMcpServer,
  type McpServerDependencies,
} from "./create-server.js";
import { registerProductionNotionExplicitWriteTools } from "./register-notion-explicit-writes.js";

export type McpSessionServerFactory = (
  authenticatedUserId: string,
) => McpServer;

export function createProductionMcpSessionServerFactory(input: {
  activeUserRepository: ActiveUserRepository;
  memoryService: MemoryService;
  diaryService: DiaryService;
  taskService: TaskService;
  toyCommandService: ToyCommandService;
  globalSearchService: GlobalSearchService;
  todoService: TodoService;
  universeService: UniverseService;
}): McpSessionServerFactory {
  return (userId) => {
    const activeUserAuthorization = createActiveUserAuthorizer(
      input.activeUserRepository,
      userId,
    );
    const getAuthenticatedUserId = () => userId;
    const dependencies: McpServerDependencies = {
      activeUserAuthorization,
      memoryReads: {
        memoryService: input.memoryService,
        getAuthenticatedUserId,
      },
      writeMemory: {
        memoryService: input.memoryService,
        getAuthenticatedUserId,
      },
      updateMemory: {
        memoryService: input.memoryService,
        getAuthenticatedUserId,
      },
      diaryTools: {
        diaryService: input.diaryService,
        getAuthenticatedUserId,
      },
      updateDiary: {
        diaryService: input.diaryService,
        getAuthenticatedUserId,
      },
      taskTools: {
        taskService: input.taskService,
        getAuthenticatedUserId,
      },
      updateTask: {
        taskService: input.taskService,
        getAuthenticatedUserId,
      },
      transitionTask: {
        taskService: input.taskService,
        getAuthenticatedUserId,
      },
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
        globalSearchService: input.globalSearchService,
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
    const server = createMcpServer(dependencies, userId);
    registerProductionNotionExplicitWriteTools(
      server,
      userId,
      activeUserAuthorization,
    );
    return server;
  };
}
