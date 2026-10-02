import { Router } from "express";
import {
  createDiaryApiRouter,
  type DiaryApiDependencies,
} from "./diary-router.js";
import {
  createToyUserRouter,
  type ToyApiDependencies,
} from "./toy-router.js";
import {
  createGlobalSearchApiRouter,
  type GlobalSearchApiDependencies,
} from "./global-search-router.js";
import {
  createSystemApiRouter,
  type SystemApiDependencies,
} from "./system-router.js";
import {
  createTodoApiRouter,
  type TodoApiDependencies,
} from "./todo-router.js";
import {
  createExportApiRouter,
  type ExportApiDependencies,
} from "./export-router.js";
import {
  createImportApiRouter,
  type ImportApiDependencies,
} from "./import-router.js";
import {
  createUniverseApiRouter,
  type UniverseApiDependencies,
} from "./universe-router.js";
import {
  createNativeLiveApiRouter,
  type NativeLiveApiDependencies,
} from "./native-live-router.js";
import {
  createMindApiRouter,
  type MindApiDependencies,
} from "./mind-router.js";
import {
  createProjectWorkspaceApiRouter,
  type ProjectWorkspaceApiDependencies,
} from "./project-workspace-router.js";
import {
  createAlbumApiRouter,
  type AlbumApiDependencies,
} from "./album-router.js";

export type WebApiRouterDependencies = {
  diary: DiaryApiDependencies;
  toy: ToyApiDependencies;
  system: SystemApiDependencies;
  globalSearch?: GlobalSearchApiDependencies;
  todo?: TodoApiDependencies;
  export?: ExportApiDependencies;
  import?: ImportApiDependencies;
  universe?: UniverseApiDependencies;
  mind?: MindApiDependencies;
  album?: AlbumApiDependencies;
  projects?: ProjectWorkspaceApiDependencies;
  nativeLive?: NativeLiveApiDependencies;
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
    "/diary",
    createDiaryApiRouter(dependencies.diary),
  );

  router.use("/toy", createToyUserRouter(dependencies.toy));
  router.use("/system", createSystemApiRouter(dependencies.system));
  if (dependencies.todo) router.use("/todo", createTodoApiRouter(dependencies.todo));
  if (dependencies.globalSearch) router.use("/search", createGlobalSearchApiRouter(dependencies.globalSearch));
  if (dependencies.export) router.use("/system/export", createExportApiRouter(dependencies.export));
  if (dependencies.import) router.use("/system/import", createImportApiRouter(dependencies.import));
  if (dependencies.universe) router.use("/universe", createUniverseApiRouter(dependencies.universe));
  if (dependencies.mind) router.use("/mind", createMindApiRouter(dependencies.mind));
  if (dependencies.album) router.use("/album", createAlbumApiRouter(dependencies.album));
  if (dependencies.projects) router.use("/", createProjectWorkspaceApiRouter(dependencies.projects));
  if (dependencies.nativeLive) router.use("/native-live", createNativeLiveApiRouter(dependencies.nativeLive));

  return router;
}
