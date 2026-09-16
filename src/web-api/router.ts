import { Router } from "express";
import {
  createMemoryApiRouter,
  type MemoryApiDependencies,
} from "./memory-router.js";
import {
  createDiaryApiRouter,
  type DiaryApiDependencies,
} from "./diary-router.js";
import {
  createTaskApiRouter,
  type TaskApiDependencies,
} from "./task-router.js";
import {
  createToyUserRouter,
  type ToyApiDependencies,
} from "./toy-router.js";
import { createGlobalSearchApiRouter, type GlobalSearchApiDependencies } from "./global-search-router.js";
import { createSystemApiRouter, type SystemApiDependencies } from "./system-router.js";
import { createTodoApiRouter, type TodoApiDependencies } from "./todo-router.js";
import { createExportApiRouter, type ExportApiDependencies } from "./export-router.js";
import { createImportApiRouter, type ImportApiDependencies } from "./import-router.js";
import { createUniverseApiRouter, type UniverseApiDependencies } from "./universe-router.js";
import { createBridgeApiRouter, type BridgeApiDependencies } from "./bridge-router.js";
import { createSentinelApiRouter, type SentinelApiDependencies } from "./sentinel-router.js";
import { createSharedPaperApiRouter, type SharedPaperApiDependencies } from "./shared-paper-router.js";
import { createConversationImportApiRouter, type ConversationImportApiDependencies } from "./conversation-import-router.js";
import { createConversationArchiveReadApiRouter, type ConversationArchiveReadApiDependencies } from "./conversation-archive-read-router.js";
import { createConversationPruningApiRouter, type ConversationPruningApiDependencies } from "./conversation-pruning-router.js";

export type WebApiRouterDependencies = {
  memory: MemoryApiDependencies;
  diary: DiaryApiDependencies;
  task: TaskApiDependencies;
  toy: ToyApiDependencies;
  system: SystemApiDependencies;
  globalSearch?: GlobalSearchApiDependencies;
  todo?: TodoApiDependencies;
  export?: ExportApiDependencies;
  import?: ImportApiDependencies;
  universe?: UniverseApiDependencies;
  bridge?: BridgeApiDependencies;
  sentinel?: SentinelApiDependencies;
  sharedPaper?: SharedPaperApiDependencies;
  conversationImport?: ConversationImportApiDependencies;
  conversationRead?: ConversationArchiveReadApiDependencies;
  conversationPruning?: ConversationPruningApiDependencies;
};

export function createWebApiRouter(
  dependencies: WebApiRouterDependencies,
): Router {
  const router = Router();

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "private, no-store");
    next();
  });

  router.get("/session", (request, response) => {
    if (!request.webUserId) {
      response.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Web API authentication is required.",
        },
      });
      return;
    }

    response.json({
      success: true,
      data: {
        authenticated: true,
      },
    });
  });

  router.use(
    "/memory",
    createMemoryApiRouter(dependencies.memory),
  );

  router.use(
    "/diary",
    createDiaryApiRouter(dependencies.diary),
  );

  router.use(
    "/task",
    createTaskApiRouter(dependencies.task),
  );

  router.use("/toy", createToyUserRouter(dependencies.toy));
  router.use("/system", createSystemApiRouter(dependencies.system));
  if (dependencies.todo) router.use("/todo", createTodoApiRouter(dependencies.todo));
  if (dependencies.globalSearch) router.use("/search", createGlobalSearchApiRouter(dependencies.globalSearch));
  if (dependencies.export) router.use("/system/export", createExportApiRouter(dependencies.export));
  if (dependencies.import) router.use("/system/import", createImportApiRouter(dependencies.import));
  if (dependencies.universe) router.use("/universe", createUniverseApiRouter(dependencies.universe));
  if (dependencies.bridge) router.use("/bridge", createBridgeApiRouter(dependencies.bridge));
  if (dependencies.sentinel) router.use("/sentinel", createSentinelApiRouter(dependencies.sentinel));
  if (dependencies.sharedPaper) router.use("/shared-papers", createSharedPaperApiRouter(dependencies.sharedPaper));
  if (dependencies.conversationRead) router.use("/conversations", createConversationArchiveReadApiRouter(dependencies.conversationRead));
  if (dependencies.conversationPruning) router.use("/conversations", createConversationPruningApiRouter(dependencies.conversationPruning));
  if (dependencies.conversationImport) router.use("/conversations", createConversationImportApiRouter(dependencies.conversationImport));

  return router;
}
