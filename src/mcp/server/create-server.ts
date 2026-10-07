import { registerWriteMemoryTool, type WriteMemoryDependencies } from "../tools/write-memory/register.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { env } from "../../config/env.js";
import { NotionReadClient } from "../../domains/notion/notion-read-client.js";
import { NotionIntegration } from "../../domains/notion/notion-read-integration.js";
import {
  registerCreateDiaryTool,
  WriteDiaryAuthenticationError,
  type WriteDiaryToolDependencies,
} from "../tools/write-diary/register.js";
import {
  registerUpdateDiaryTool,
  UpdateDiaryAuthenticationError,
  type UpdateDiaryToolDependencies,
} from "../tools/update-diary/register.js";
import {
  DiaryReadAuthenticationError,
  registerSearchDiaryTool,
  type SearchDiaryToolDependencies,
} from "../tools/search-diary/register.js";
import {
  registerGetDiaryTool,
  type GetDiaryToolDependencies,
} from "../tools/get-diary/register.js";
import {
  DiaryCommentAuthenticationError,
  registerDiaryCommentTools,
  type DiaryCommentToolDependencies,
} from "../tools/diary-comment/register.js";
import {
  registerToyCommandTools,
  ToyCommandAuthenticationError,
  type ToyCommandToolDependencies,
} from "../tools/toy-command/register.js";
import { GlobalSearchAuthenticationError, registerGlobalSearchTool, type GlobalSearchToolDependencies } from "../tools/global-search/register.js";
import {
  registerSearchNotionTool,
  SearchNotionAuthenticationError,
  type SearchNotionToolDependencies,
} from "../tools/search-notion/register.js";
import {
  registerReadNotionPageTool,
  type ReadNotionPageToolDependencies,
} from "../tools/read-notion-page/register.js";
import {
  NotionAdvancedAuthenticationError,
  registerGetNotionConnectionTool,
  type GetNotionConnectionToolDependencies,
} from "../tools/get-notion-connection/register.js";
import {
  registerReadNotionDatabaseTool,
  type ReadNotionDatabaseToolDependencies,
} from "../tools/read-notion-database/register.js";
import {
  registerReadNotionDataSourceTool,
  type ReadNotionDataSourceToolDependencies,
} from "../tools/read-notion-data-source/register.js";
import {
  registerQueryNotionDataSourceTool,
  type QueryNotionDataSourceToolDependencies,
} from "../tools/query-notion-data-source/register.js";
import { UniverseServiceError } from "../../domains/universe/universe-service.js";
import {
  registerReadTodoDayTool,
  TodoReadAuthenticationError,
  type ReadTodoDayToolDependencies,
} from "../tools/read-todo-day/register.js";
import {
  registerListTodoDatesTool,
  type ListTodoDatesToolDependencies,
} from "../tools/list-todo-dates/register.js";
import {
  registerReplaceTodoPaperTool,
  WriteTodoPaperAuthenticationError,
  type WriteTodoPaperToolDependencies,
} from "../tools/write-todo-paper/register.js";
import {
  registerTodoEntryWriteTools,
  TodoEntryWriteAuthenticationError,
  type TodoEntryWriteToolDependencies,
} from "../tools/todo-entry/register.js";
import { registerSearchTodoTool, type SearchTodoToolDependencies } from "../tools/search-todo/register.js";
import { registerGetUniverseNodeTool, type GetUniverseNodeToolDependencies } from "../tools/get-universe-node/register.js";
import { registerListUniverseNodesTool, type ListUniverseNodesToolDependencies } from "../tools/list-universe-nodes/register.js";
import { registerListUniverseGalaxiesTool } from "../tools/list-universe-galaxies/register.js";
import { registerGetUniverseRelationsTool, type GetUniverseRelationsToolDependencies } from "../tools/get-universe-relations/register.js";
import { registerCreateUniverseNodeTool, type CreateUniverseNodeToolDependencies } from "../tools/create-universe-node/register.js";
import { registerUpdateUniverseNodeTool, type UpdateUniverseNodeToolDependencies } from "../tools/update-universe-node/register.js";
import { registerCreateUniverseRelationTool, type CreateUniverseRelationToolDependencies } from "../tools/create-universe-relation/register.js";
import { registerUpdateUniverseRelationTool, type UpdateUniverseRelationToolDependencies } from "../tools/update-universe-relation/register.js";
import { registerDeleteUniverseRelationTool, type DeleteUniverseRelationToolDependencies } from "../tools/delete-universe-relation/register.js";
import { registerGetUniverseDiarySourcesTool, type GetUniverseDiarySourcesToolDependencies } from "../tools/get-universe-diary-sources/register.js";
import { registerAddUniverseDiarySourceTool, type AddUniverseDiarySourceToolDependencies } from "../tools/add-universe-diary-source/register.js";
import { registerDeleteUniverseDiarySourceTool, type DeleteUniverseDiarySourceToolDependencies } from "../tools/delete-universe-diary-source/register.js";
import { UniverseAuthenticationError } from "../tools/universe/shared.js";
import {
  mcpToolSurfaceEnabled,
  resolveMcpToolExposure,
  type McpToolExposure,
} from "./tool-profiles.js";
import {
  ActiveUserAuthorizationError,
  requireActiveUser,
  type ActiveUserRepository,
} from "../../domains/require-active-user.js";

let defaultNotionReadClient: NotionReadClient | undefined;
let defaultNotionIntegration: NotionIntegration | undefined;

export function createActiveUserAuthorizer(
  repository: ActiveUserRepository,
  authenticatedUserId: string | undefined,
): () => Promise<string> {
  return async () => {
    if (!authenticatedUserId) {
      throw new ActiveUserAuthorizationError("USER_NOT_FOUND");
    }
    return requireActiveUser(repository, authenticatedUserId);
  };
}

function missingDatabaseService(): never {
  throw new Error("MCP_DATABASE_SERVICE_NOT_CONFIGURED");
}

function createMissingActiveUserAuthorizer(
  authenticatedUserId: string | undefined,
): () => Promise<string> {
  return async () => {
    if (!authenticatedUserId) {
      throw new ActiveUserAuthorizationError("USER_NOT_FOUND");
    }
    return missingDatabaseService();
  };
}

function getDefaultNotionReadClient(): NotionReadClient {
  if (!defaultNotionReadClient) {
    defaultNotionReadClient = new NotionReadClient(env.NOTION_PAT);
  }
  return defaultNotionReadClient;
}

function getDefaultNotionIntegration(): NotionIntegration {
  if (!defaultNotionIntegration) {
    defaultNotionIntegration = new NotionIntegration(env.NOTION_PAT);
  }
  return defaultNotionIntegration;
}


const productionWriteDiaryDependencies: WriteDiaryToolDependencies = {
  diaryService: {
    createMcpDiary: (context, input) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new WriteDiaryAuthenticationError();
  },
};

const productionUpdateDiaryDependencies: UpdateDiaryToolDependencies = {
  diaryService: {
    updateMcpDiary: (context, input) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new UpdateDiaryAuthenticationError();
  },
};

const productionSearchDiaryDependencies: SearchDiaryToolDependencies = {
  diaryService: {
    listDiaries: (input) => missingDatabaseService(),
    searchDiaryDiscovery: (input) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new DiaryReadAuthenticationError();
  },
};

const productionGetDiaryDependencies: GetDiaryToolDependencies = {
  diaryService: {
    readDiary: (input) => missingDatabaseService(),
    readArchivedDiary: (input) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new DiaryReadAuthenticationError();
  },
};

const productionDiaryCommentDependencies: DiaryCommentToolDependencies = {
  diaryCommentService: {
    addMcpComment: (context, input) => missingDatabaseService(),
    getComment: (input) => missingDatabaseService(),
    listComments: (input) => missingDatabaseService(),
    updateComment: (input) => missingDatabaseService(),
    deleteComment: (input) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new DiaryCommentAuthenticationError();
  },
};

const productionToyCommandDependencies: ToyCommandToolDependencies = {
  toyCommandService: {
    createIdempotently: (userId, input, idempotencyKey) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new ToyCommandAuthenticationError();
  },
};

const productionGlobalSearchDependencies: GlobalSearchToolDependencies = {
  globalSearchService: { search: (input) => missingDatabaseService() },
  getAuthenticatedUserId: () => { throw new GlobalSearchAuthenticationError(); },
};

const productionUniverseService: GetUniverseNodeToolDependencies["universeService"] & ListUniverseNodesToolDependencies["universeService"] & GetUniverseRelationsToolDependencies["universeService"] &
  CreateUniverseNodeToolDependencies["universeService"] & UpdateUniverseNodeToolDependencies["universeService"] &
  CreateUniverseRelationToolDependencies["universeService"] & DeleteUniverseRelationToolDependencies["relationService"] &
  UpdateUniverseRelationToolDependencies["universeService"] &
  GetUniverseDiarySourcesToolDependencies["sourceService"] & AddUniverseDiarySourceToolDependencies["sourceService"] &
  DeleteUniverseDiarySourceToolDependencies["sourceService"] = {
  loadUniverse: (userId) => missingDatabaseService(),
  readUniverseNode: (userId, nodeId) => missingDatabaseService(),
  listUniverseNodes: (userId, limit, after) => missingDatabaseService(),
  createMcpNode: (userId, input, expectedVersion, idempotencyKey) => missingDatabaseService(),
  updateMcpNode: (userId, nodeId, patch, expectedVersion) => missingDatabaseService(),
  createMcpRelation: (userId, input, expectedVersion, idempotencyKey) => missingDatabaseService(),
  updateMcpRelation: (userId, relationId, patch, expectedVersion) => missingDatabaseService(),
  deleteRelation: (userId, relationId, expectedVersion) => missingDatabaseService(),
  getUniverseDiarySources: (userId, nodeId) => missingDatabaseService(),
  addUniverseDiarySource: (userId, nodeId, diaryId, expectedVersion) => missingDatabaseService(),
  deleteUniverseDiarySource: (userId, nodeId, diaryId, expectedVersion) => missingDatabaseService(),
};

const productionNotionService: SearchNotionToolDependencies["notionService"] &
  ReadNotionPageToolDependencies["notionService"] = {
  searchPages: (input) => getDefaultNotionReadClient().searchPages(input),
  readPage: (pageId) => getDefaultNotionReadClient().readPage(pageId),
};

const productionTodoService = {
  readDay: (userId: string, date: string) => missingDatabaseService(),
  listDates: (userId: string) => missingDatabaseService(),
  replacePaperIdempotently: (
    input: Parameters<WriteTodoPaperToolDependencies["todoService"]["replacePaperIdempotently"]>[0],
  ) => missingDatabaseService(),
  appendEntryIdempotently: (
    input: Parameters<TodoEntryWriteToolDependencies["todoService"]["appendEntryIdempotently"]>[0],
  ) => missingDatabaseService(),
  appendEntriesIdempotently: (
    input: Parameters<TodoEntryWriteToolDependencies["todoService"]["appendEntriesIdempotently"]>[0],
  ) => missingDatabaseService(),
  updateEntryIdempotently: (
    input: Parameters<TodoEntryWriteToolDependencies["todoService"]["updateEntryIdempotently"]>[0],
  ) => missingDatabaseService(),
  deleteEntryIdempotently: (
    input: Parameters<TodoEntryWriteToolDependencies["todoService"]["deleteEntryIdempotently"]>[0],
  ) => missingDatabaseService(),
  search: (input: Parameters<SearchTodoToolDependencies["todoService"]["search"]>[0]) => missingDatabaseService(),
};

type TodoToolsDependencies = {
  todoService: ReadTodoDayToolDependencies["todoService"] &
    ListTodoDatesToolDependencies["todoService"] &
    WriteTodoPaperToolDependencies["todoService"] &
    TodoEntryWriteToolDependencies["todoService"] &
    SearchTodoToolDependencies["todoService"];
  getAuthenticatedUserId: () => string;
};

type NotionToolsDependencies = {
  notionService: SearchNotionToolDependencies["notionService"] &
    ReadNotionPageToolDependencies["notionService"];
  getAuthenticatedUserId: () => string;
};

type NotionReadDependencies =
  GetNotionConnectionToolDependencies &
  ReadNotionDatabaseToolDependencies &
  ReadNotionDataSourceToolDependencies &
  QueryNotionDataSourceToolDependencies;

type UniverseToolsDependencies = {
  universeService: GetUniverseNodeToolDependencies["universeService"] & Partial<ListUniverseNodesToolDependencies["universeService"]> & GetUniverseRelationsToolDependencies["universeService"];
  getAuthenticatedUserId: () => string;
};

type UniverseWriteToolsDependencies = {
  nodeService: CreateUniverseNodeToolDependencies["universeService"] & UpdateUniverseNodeToolDependencies["universeService"];
  relationService: CreateUniverseRelationToolDependencies["universeService"] & UpdateUniverseRelationToolDependencies["universeService"];
  getAuthenticatedUserId: () => string;
};

type UniverseProvenanceToolsDependencies = {
  relationService: DeleteUniverseRelationToolDependencies["relationService"];
  sourceService: GetUniverseDiarySourcesToolDependencies["sourceService"] &
    AddUniverseDiarySourceToolDependencies["sourceService"] &
    DeleteUniverseDiarySourceToolDependencies["sourceService"];
  getAuthenticatedUserId: () => string;
};

export type McpServerDependencies = {
  activeUserAuthorization?: () => Promise<string>;
  writeMemory?: WriteMemoryDependencies;
  diaryTools?: {
    diaryService: WriteDiaryToolDependencies["diaryService"] &
      SearchDiaryToolDependencies["diaryService"] &
      GetDiaryToolDependencies["diaryService"];
    getAuthenticatedUserId: () => string;
  };
  writeDiary?: WriteDiaryToolDependencies;
  updateDiary?: UpdateDiaryToolDependencies;
  searchDiary?: SearchDiaryToolDependencies;
  getDiary?: GetDiaryToolDependencies;
  diaryComments?: DiaryCommentToolDependencies;
  toyCommand?: ToyCommandToolDependencies;
  globalSearch?: GlobalSearchToolDependencies;
  todoTools?: TodoToolsDependencies;
  notionTools?: NotionToolsDependencies;
  notionRead?: NotionReadDependencies;
  universeTools?: UniverseToolsDependencies;
  universeWriteTools?: UniverseWriteToolsDependencies;
  universeProvenanceTools?: UniverseProvenanceToolsDependencies;
};

export function createMcpServer(
  dependencies: McpServerDependencies = {},
  authenticatedUserId?: string,
  toolExposure: McpToolExposure = resolveMcpToolExposure(["full"]),
): McpServer {
  const server = new McpServer({
    name: "leilei-os",
    version: "0.1.0",
  });

  const activeUserAuthorization =
    dependencies.activeUserAuthorization ??
    createMissingActiveUserAuthorizer(authenticatedUserId);

  if (mcpToolSurfaceEnabled(toolExposure, "core")) {
  registerWriteMemoryTool(server, dependencies.writeMemory ?? {
    subjectId: "G", requireActiveUser: activeUserAuthorization,
    repository: { insertMcpIdempotent: async () => { throw new Error("Memory writer unavailable."); } },
  });
  registerCreateDiaryTool(
    server,
    dependencies.writeDiary ?? dependencies.diaryTools ?? {
      ...productionWriteDiaryDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new WriteDiaryAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  registerUpdateDiaryTool(
    server,
    dependencies.updateDiary ?? {
      ...productionUpdateDiaryDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new UpdateDiaryAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  registerSearchDiaryTool(
    server,
    dependencies.searchDiary ?? dependencies.diaryTools ?? {
      ...productionSearchDiaryDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new DiaryReadAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  const getDiaryDependencies: GetDiaryToolDependencies =
    dependencies.getDiary ?? {
      diaryService:
        dependencies.diaryTools?.diaryService ??
        productionGetDiaryDependencies.diaryService,
      getAuthenticatedUserId:
        dependencies.diaryTools?.getAuthenticatedUserId ??
        (() => {
          if (!authenticatedUserId) throw new DiaryReadAuthenticationError();
          return authenticatedUserId;
        }),
    };
  registerGetDiaryTool(server, getDiaryDependencies);
  registerDiaryCommentTools(
    server,
    dependencies.diaryComments ?? {
      ...productionDiaryCommentDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) {
          throw new DiaryCommentAuthenticationError();
        }
        return authenticatedUserId;
      },
    },
  );
  registerToyCommandTools(
    server,
    dependencies.toyCommand ?? {
      ...productionToyCommandDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new ToyCommandAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  registerGlobalSearchTool(server, dependencies.globalSearch ?? {
    ...productionGlobalSearchDependencies,
    getAuthenticatedUserId: () => {
      if (!authenticatedUserId) throw new GlobalSearchAuthenticationError();
      return authenticatedUserId;
    },
  });
  }

  if (mcpToolSurfaceEnabled(toolExposure, "core")) {
  const universeTools = dependencies.universeTools ?? {
    universeService: productionUniverseService,
    getAuthenticatedUserId: () => {
      if (!authenticatedUserId) throw new UniverseAuthenticationError();
      return authenticatedUserId;
    },
  } satisfies UniverseToolsDependencies;
  registerGetUniverseNodeTool(server, universeTools);
  registerListUniverseGalaxiesTool(server, universeTools);
  registerListUniverseNodesTool(server, {
    universeService: universeTools.universeService?.listUniverseNodes
      ? universeTools.universeService as ListUniverseNodesToolDependencies["universeService"]
      : { listUniverseNodes: async () => { throw new UniverseServiceError("UNIVERSE_NOT_INITIALIZED"); } },
    getAuthenticatedUserId: universeTools.getAuthenticatedUserId,
  });
  registerGetUniverseRelationsTool(server, universeTools);
  const sharedUniverseService = universeTools.universeService;
  const universeWriteTools = dependencies.universeWriteTools ?? (
    sharedUniverseService && "createMcpNode" in sharedUniverseService && "updateMcpNode" in sharedUniverseService && "createMcpRelation" in sharedUniverseService && "updateMcpRelation" in sharedUniverseService
      ? {
          nodeService: sharedUniverseService as UniverseWriteToolsDependencies["nodeService"],
          relationService: sharedUniverseService as UniverseWriteToolsDependencies["relationService"],
          getAuthenticatedUserId: universeTools.getAuthenticatedUserId,
        }
      : {
          nodeService: productionUniverseService,
          relationService: productionUniverseService,
          getAuthenticatedUserId: () => {
            if (!authenticatedUserId) throw new UniverseAuthenticationError();
            return authenticatedUserId;
          },
        }
  ) satisfies UniverseWriteToolsDependencies;
  registerCreateUniverseNodeTool(server, { universeService: universeWriteTools.nodeService, getAuthenticatedUserId: universeWriteTools.getAuthenticatedUserId });
  registerUpdateUniverseNodeTool(server, { universeService: universeWriteTools.nodeService, getAuthenticatedUserId: universeWriteTools.getAuthenticatedUserId });
  registerCreateUniverseRelationTool(server, { universeService: universeWriteTools.relationService, getAuthenticatedUserId: universeWriteTools.getAuthenticatedUserId });
  registerUpdateUniverseRelationTool(server, { universeService: universeWriteTools.relationService, getAuthenticatedUserId: universeWriteTools.getAuthenticatedUserId });
  const universeProvenanceTools = dependencies.universeProvenanceTools ?? {
    relationService: productionUniverseService,
    sourceService: productionUniverseService,
    getAuthenticatedUserId: universeTools.getAuthenticatedUserId,
  } satisfies UniverseProvenanceToolsDependencies;
  registerDeleteUniverseRelationTool(server, { relationService: universeProvenanceTools.relationService, getAuthenticatedUserId: universeProvenanceTools.getAuthenticatedUserId });
  registerGetUniverseDiarySourcesTool(server, { sourceService: universeProvenanceTools.sourceService, getAuthenticatedUserId: universeProvenanceTools.getAuthenticatedUserId });
  registerAddUniverseDiarySourceTool(server, { sourceService: universeProvenanceTools.sourceService, getAuthenticatedUserId: universeProvenanceTools.getAuthenticatedUserId });
  registerDeleteUniverseDiarySourceTool(server, { sourceService: universeProvenanceTools.sourceService, getAuthenticatedUserId: universeProvenanceTools.getAuthenticatedUserId });
  }

  if (mcpToolSurfaceEnabled(toolExposure, "notion")) {
  const notionTools = dependencies.notionTools
    ? (dependencies.activeUserAuthorization || authenticatedUserId !== undefined)
      ? { ...dependencies.notionTools, requireActiveUser: activeUserAuthorization }
      : dependencies.notionTools
    : {
        notionService: productionNotionService,
        getAuthenticatedUserId: () => {
          if (!authenticatedUserId) throw new SearchNotionAuthenticationError();
          return authenticatedUserId;
        },
        requireActiveUser: activeUserAuthorization,
      };
  registerSearchNotionTool(server, notionTools);
  registerReadNotionPageTool(server, notionTools);
  }

  if (mcpToolSurfaceEnabled(toolExposure, "notion_advanced")) {
  const notionRead = dependencies.notionRead
    ? (dependencies.activeUserAuthorization || authenticatedUserId !== undefined)
      ? { ...dependencies.notionRead, requireActiveUser: activeUserAuthorization }
      : dependencies.notionRead
    : {
        notionIntegration: getDefaultNotionIntegration(),
        getAuthenticatedUserId: () => {
          if (!authenticatedUserId) throw new NotionAdvancedAuthenticationError();
          return authenticatedUserId;
        },
        requireActiveUser: activeUserAuthorization,
      } satisfies NotionReadDependencies;
  registerGetNotionConnectionTool(server, notionRead);
  registerReadNotionDatabaseTool(server, notionRead);
  registerReadNotionDataSourceTool(server, notionRead);
  registerQueryNotionDataSourceTool(server, notionRead);
  }

  if (mcpToolSurfaceEnabled(toolExposure, "core")) {
  registerReadTodoDayTool(server, dependencies.todoTools ?? {
    todoService: productionTodoService,
    getAuthenticatedUserId: () => {
      if (!authenticatedUserId) throw new TodoReadAuthenticationError();
      return authenticatedUserId;
    },
  });
  registerListTodoDatesTool(server, dependencies.todoTools ?? {
    todoService: productionTodoService,
    getAuthenticatedUserId: () => {
      if (!authenticatedUserId) throw new TodoReadAuthenticationError();
      return authenticatedUserId;
    },
  });
  registerReplaceTodoPaperTool(server, dependencies.todoTools ?? {
    todoService: productionTodoService,
    getAuthenticatedUserId: () => {
      if (!authenticatedUserId) throw new WriteTodoPaperAuthenticationError();
      return authenticatedUserId;
    },
  });
  registerTodoEntryWriteTools(server, dependencies.todoTools ?? {
    todoService: productionTodoService,
    getAuthenticatedUserId: () => {
      if (!authenticatedUserId) throw new TodoEntryWriteAuthenticationError();
      return authenticatedUserId;
    },
  });
  registerSearchTodoTool(server, dependencies.todoTools ?? {
    todoService: productionTodoService,
    getAuthenticatedUserId: () => {
      if (!authenticatedUserId) throw new TodoReadAuthenticationError();
      return authenticatedUserId;
    },
  });
  }



  return server;
}
