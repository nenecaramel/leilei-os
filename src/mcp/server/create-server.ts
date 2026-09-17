import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { env } from "../../config/env.js";
import { NotionReadClient } from "../../domains/notion/notion-read-client.js";
import { NotionIntegration } from "../../domains/notion/notion-read-integration.js";
import { registerGetWeatherContextTool } from "../tools/get-weather-context/register.js";
import {
  ReadMemoryAuthenticationError,
  registerReadMemoryTool,
  type ReadMemoryToolDependencies,
} from "../tools/read-memory/register.js";
import {
  registerSearchMemoryTool,
  type SearchMemoryToolDependencies,
} from "../tools/search-memory/register.js";
import {
  registerGetMemoryTool,
  type GetMemoryToolDependencies,
} from "../tools/get-memory/register.js";
import {
  registerWriteMemoryTool,
  WriteMemoryAuthenticationError,
  type WriteMemoryToolDependencies,
} from "../tools/write-memory/register.js";
import {
  registerUpdateMemoryTool,
  UpdateMemoryAuthenticationError,
  type UpdateMemoryToolDependencies,
} from "../tools/update-memory/register.js";
import {
  registerWriteDiaryTool,
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
  DiaryLifecycleAuthenticationError,
  registerDiaryLifecycleTools,
  type DiaryLifecycleToolDependencies,
} from "../tools/diary-lifecycle/register.js";
import {
  DiaryCommentAuthenticationError,
  registerDiaryCommentTools,
  type DiaryCommentToolDependencies,
} from "../tools/diary-comment/register.js";
import {
  CreateTaskAuthenticationError,
  registerCreateTaskTool,
  type CreateTaskToolDependencies,
} from "../tools/create-task/register.js";
import {
  registerUpdateTaskTool,
  UpdateTaskAuthenticationError,
  type UpdateTaskToolDependencies,
} from "../tools/update-task/register.js";
import {
  registerTransitionTaskTool,
  TransitionTaskAuthenticationError,
  type TransitionTaskToolDependencies,
} from "../tools/transition-task/register.js";
import {
  registerListTasksTool,
  TaskReadAuthenticationError,
  type ListTasksToolDependencies,
} from "../tools/list-tasks/register.js";
import {
  registerGetTaskTool,
  type GetTaskToolDependencies,
} from "../tools/get-task/register.js";
import {
  registerToyCommandTools,
  ToyCommandAuthenticationError,
  type ToyCommandToolDependencies,
} from "../tools/toy-command/register.js";
import { GlobalSearchAuthenticationError, registerGlobalSearchTool, type GlobalSearchToolDependencies } from "../tools/global-search/register.js";
import { ConversationArchiveAuthenticationError, registerConversationArchiveTools, type ConversationArchiveMcpToolDependencies } from "../tools/conversation-archive/register.js";
import {
  registerSearchNotionTool,
  SearchNotionAuthenticationError,
  type SearchNotionToolDependencies,
} from "../tools/search-notion/register.js";
import {
  ReadNotionPageAuthenticationError,
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
  registerWriteTodoPaperTool,
  WriteTodoPaperAuthenticationError,
  type WriteTodoPaperToolDependencies,
} from "../tools/write-todo-paper/register.js";
import {
  registerTodoEntryWriteTools,
  TodoEntryWriteAuthenticationError,
  type TodoEntryWriteToolDependencies,
} from "../tools/todo-entry/register.js";
import { registerSearchTodoTool, type SearchTodoToolDependencies } from "../tools/search-todo/register.js";
import { registerSearchUniverseTool, type SearchUniverseToolDependencies } from "../tools/search-universe/register.js";
import { registerGetUniverseNodeTool, type GetUniverseNodeToolDependencies } from "../tools/get-universe-node/register.js";
import { registerListUniverseNodesTool, type ListUniverseNodesToolDependencies } from "../tools/list-universe-nodes/register.js";
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
import { registerSharedPaperTools, SharedPaperAuthenticationError, type SharedPaperToolDependencies, type SharedPaperToolService } from "../tools/shared-paper/register.js";
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


const productionReadMemoryDependencies: ReadMemoryToolDependencies = {
  memoryService: {
    readMemory: (input) => missingDatabaseService(),
    readMemoryDiscovery: (input) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new ReadMemoryAuthenticationError();
  },
};

const productionSearchMemoryDependencies: SearchMemoryToolDependencies = {
  memoryService: {
    readMemory: (input) => missingDatabaseService(),
    searchMemoryDiscovery: (input) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new ReadMemoryAuthenticationError();
  },
};

const productionGetMemoryDependencies: GetMemoryToolDependencies = {
  memoryService: {
    readMemoryDetail: (input) => missingDatabaseService(),
    readArchivedMemoryDetail: (input) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new ReadMemoryAuthenticationError();
  },
};

const productionWriteMemoryDependencies: WriteMemoryToolDependencies = {
  memoryService: {
    createMcpMemory: (context, input, idempotencyKey) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new WriteMemoryAuthenticationError();
  },
};

const productionUpdateMemoryDependencies: UpdateMemoryToolDependencies = {
  memoryService: {
    updateMcpMemory: (context, input) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new UpdateMemoryAuthenticationError();
  },
};

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

const productionDiaryLifecycleDependencies: DiaryLifecycleToolDependencies = {
  diaryService: {
    archiveMcpDiary: (context, input) => missingDatabaseService(),
    restoreMcpDiary: (context, input) => missingDatabaseService(),
    permanentlyDeleteMcpDiary: (context, input) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new DiaryLifecycleAuthenticationError();
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

const productionCreateTaskDependencies: CreateTaskToolDependencies = {
  taskService: {
    createTaskIdempotently: (context, input, idempotencyKey) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new CreateTaskAuthenticationError();
  },
};

const productionUpdateTaskDependencies: UpdateTaskToolDependencies = {
  taskService: {
    updateMcpTask: (context, input) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new UpdateTaskAuthenticationError();
  },
};

const productionTransitionTaskDependencies: TransitionTaskToolDependencies = {
  taskService: {
    transitionMcpTask: (context, input) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new TransitionTaskAuthenticationError();
  },
};

const productionListTasksDependencies: ListTasksToolDependencies = {
  taskService: {
    listTasks: (input) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new TaskReadAuthenticationError();
  },
};

const productionGetTaskDependencies: GetTaskToolDependencies = {
  taskService: {
    readTask: (input) => missingDatabaseService(),
    readArchivedTask: (input) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => {
    throw new TaskReadAuthenticationError();
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

const productionConversationArchiveDependencies: ConversationArchiveMcpToolDependencies = {
  conversationArchiveReadService: {
    search: (input) => missingDatabaseService(),
    modelView: (input) => missingDatabaseService(),
  },
  getAuthenticatedUserId: () => { throw new ConversationArchiveAuthenticationError(); },
};

const productionUniverseService: SearchUniverseToolDependencies["globalSearchService"] &
  GetUniverseNodeToolDependencies["universeService"] & ListUniverseNodesToolDependencies["universeService"] & GetUniverseRelationsToolDependencies["universeService"] &
  CreateUniverseNodeToolDependencies["universeService"] & UpdateUniverseNodeToolDependencies["universeService"] &
  CreateUniverseRelationToolDependencies["universeService"] & DeleteUniverseRelationToolDependencies["relationService"] &
  UpdateUniverseRelationToolDependencies["universeService"] &
  GetUniverseDiarySourcesToolDependencies["sourceService"] & AddUniverseDiarySourceToolDependencies["sourceService"] &
  DeleteUniverseDiarySourceToolDependencies["sourceService"] = {
  search: (input) => missingDatabaseService(),
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
  updateEntryIdempotently: (
    input: Parameters<TodoEntryWriteToolDependencies["todoService"]["updateEntryIdempotently"]>[0],
  ) => missingDatabaseService(),
  deleteEntryIdempotently: (
    input: Parameters<TodoEntryWriteToolDependencies["todoService"]["deleteEntryIdempotently"]>[0],
  ) => missingDatabaseService(),
  search: (input: Parameters<SearchTodoToolDependencies["todoService"]["search"]>[0]) => missingDatabaseService(),
};

const productionSharedPaperService: SharedPaperToolService = {
  listPapers: () => missingDatabaseService(),
  searchPapers: () => missingDatabaseService(),
  getPaper: () => missingDatabaseService(),
  listEdits: () => missingDatabaseService(),
  createPaperIdempotently: () => missingDatabaseService(),
  editPaperByMatch: () => missingDatabaseService(),
  appendPaperIdempotently: () => missingDatabaseService(),
  archivePaperIdempotently: () => missingDatabaseService(),
  restorePaperIdempotently: () => missingDatabaseService(),
  deletePaperIdempotently: () => missingDatabaseService(),
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
  globalSearchService: SearchUniverseToolDependencies["globalSearchService"];
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
  memoryReads?: {
    memoryService: ReadMemoryToolDependencies["memoryService"] &
      SearchMemoryToolDependencies["memoryService"] &
      GetMemoryToolDependencies["memoryService"];
    getAuthenticatedUserId: () => string;
  };
  readMemory?: ReadMemoryToolDependencies;
  searchMemory?: SearchMemoryToolDependencies;
  getMemory?: GetMemoryToolDependencies;
  writeMemory?: WriteMemoryToolDependencies;
  updateMemory?: UpdateMemoryToolDependencies;
  diaryTools?: {
    diaryService: WriteDiaryToolDependencies["diaryService"] &
      SearchDiaryToolDependencies["diaryService"] &
      GetDiaryToolDependencies["diaryService"];
    getAuthenticatedUserId: () => string;
  };
  writeDiary?: WriteDiaryToolDependencies;
  updateDiary?: UpdateDiaryToolDependencies;
  diaryLifecycle?: DiaryLifecycleToolDependencies;
  searchDiary?: SearchDiaryToolDependencies;
  getDiary?: GetDiaryToolDependencies;
  diaryComments?: DiaryCommentToolDependencies;
  taskTools?: {
    taskService: CreateTaskToolDependencies["taskService"] &
      ListTasksToolDependencies["taskService"] &
      GetTaskToolDependencies["taskService"];
    getAuthenticatedUserId: () => string;
  };
  createTask?: CreateTaskToolDependencies;
  updateTask?: UpdateTaskToolDependencies;
  transitionTask?: TransitionTaskToolDependencies;
  listTasks?: ListTasksToolDependencies;
  getTask?: GetTaskToolDependencies;
  toyCommand?: ToyCommandToolDependencies;
  globalSearch?: GlobalSearchToolDependencies;
  conversationArchiveTools?: ConversationArchiveMcpToolDependencies;
  todoTools?: TodoToolsDependencies;
  sharedPaperTools?: SharedPaperToolDependencies;
  notionTools?: NotionToolsDependencies;
  notionRead?: NotionReadDependencies;
  universeTools?: UniverseToolsDependencies;
  universeWriteTools?: UniverseWriteToolsDependencies;
  universeProvenanceTools?: UniverseProvenanceToolsDependencies;
};

export function createMcpServer(
  dependencies: McpServerDependencies = {},
  authenticatedUserId?: string,
): McpServer {
  const server = new McpServer({
    name: "leilei-os",
    version: "0.1.0",
  });

  const activeUserAuthorization =
    dependencies.activeUserAuthorization ??
    createMissingActiveUserAuthorizer(authenticatedUserId);

  registerGetWeatherContextTool(server)
  registerReadMemoryTool(
    server,
    dependencies.readMemory ?? dependencies.memoryReads ?? {
      ...productionReadMemoryDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new ReadMemoryAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  registerSearchMemoryTool(
    server,
    dependencies.searchMemory ?? dependencies.memoryReads ?? {
      ...productionSearchMemoryDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new ReadMemoryAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  registerGetMemoryTool(
    server,
    dependencies.getMemory ?? dependencies.memoryReads ?? {
      ...productionGetMemoryDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new ReadMemoryAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  registerWriteMemoryTool(
    server,
    dependencies.writeMemory ?? {
      ...productionWriteMemoryDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new WriteMemoryAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  registerUpdateMemoryTool(
    server,
    dependencies.updateMemory ?? {
      ...productionUpdateMemoryDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new UpdateMemoryAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  registerWriteDiaryTool(
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
  registerDiaryLifecycleTools(
    server,
    dependencies.diaryLifecycle ?? {
      ...productionDiaryLifecycleDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new DiaryLifecycleAuthenticationError();
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
      ...(dependencies.diaryComments
        ? {
            diaryCommentService:
              dependencies.diaryComments.diaryCommentService,
          }
        : {}),
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
  registerCreateTaskTool(
    server,
    dependencies.createTask ?? dependencies.taskTools ?? {
      ...productionCreateTaskDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new CreateTaskAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  registerUpdateTaskTool(
    server,
    dependencies.updateTask ?? {
      ...productionUpdateTaskDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new UpdateTaskAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  registerTransitionTaskTool(
    server,
    dependencies.transitionTask ?? {
      ...productionTransitionTaskDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new TransitionTaskAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  registerListTasksTool(
    server,
    dependencies.listTasks ?? dependencies.taskTools ?? {
      ...productionListTasksDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new TaskReadAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  registerGetTaskTool(
    server,
    dependencies.getTask ?? dependencies.taskTools ?? {
      ...productionGetTaskDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new TaskReadAuthenticationError();
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
  registerConversationArchiveTools(server, dependencies.conversationArchiveTools ?? {
    ...productionConversationArchiveDependencies,
    getAuthenticatedUserId: () => {
      if (!authenticatedUserId) throw new ConversationArchiveAuthenticationError();
      return authenticatedUserId;
    },
  });
  const universeTools = dependencies.universeTools ?? {
    universeService: productionUniverseService,
    globalSearchService: productionUniverseService,
    getAuthenticatedUserId: () => {
      if (!authenticatedUserId) throw new UniverseAuthenticationError();
      return authenticatedUserId;
    },
  } satisfies UniverseToolsDependencies;
  registerSearchUniverseTool(server, universeTools);
  registerGetUniverseNodeTool(server, universeTools);
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
  registerWriteTodoPaperTool(server, dependencies.todoTools ?? {
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
  registerSharedPaperTools(server, dependencies.sharedPaperTools ?? {
    sharedPaperService: productionSharedPaperService,
    getAuthenticatedUserId: () => {
      if (!authenticatedUserId) throw new SharedPaperAuthenticationError();
      return authenticatedUserId;
    },
  });
  return server;
}
