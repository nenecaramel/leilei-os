import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MemoryService } from "../../domains/memory/memory-service.js";
import { DrizzleMemoryRepository } from "../../domains/memory/memory-repository.js";
import { DiaryService } from "../../domains/diary/diary-service.js";
import { DrizzleDiaryRepository } from "../../domains/diary/diary-repository.js";
import { TaskService } from "../../domains/task/task-service.js";
import { DrizzleTaskRepository } from "../../domains/task/task-repository.js";
import { ToyCommandService } from "../../domains/toy/toy-command-service.js";
import { DrizzleToyCommandRepository } from "../../domains/toy/toy-command-repository.js";
import { createDatabase } from "../../database/client.js";
import { env } from "../../config/env.js";
import { NotionReadClient } from "../../domains/notion/notion-read-client.js";
import { NotionIntegration } from "../../domains/notion/notion-read-integration.js";
import { registerHelloTool } from "../tools/hello/register.js";
import { registerGetLocalContextTool } from "../tools/get-local-context/register.js";
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
import { GlobalSearchService } from "../../domains/global-search/global-search-service.js";
import { DrizzleGlobalSearchRepository } from "../../domains/global-search/global-search-repository.js";
import { GlobalSearchAuthenticationError, registerGlobalSearchTool, type GlobalSearchToolDependencies } from "../tools/global-search/register.js";
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
import { TodoService } from "../../domains/todo/todo-service.js";
import { DrizzleTodoRepository } from "../../domains/todo/todo-repository.js";
import { UniverseService } from "../../domains/universe/universe-service.js";
import { DrizzleUniverseRepository } from "../../domains/universe/universe-repository-drizzle.js";
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
import { registerSearchUniverseTool, type SearchUniverseToolDependencies } from "../tools/search-universe/register.js";
import { registerGetUniverseNodeTool, type GetUniverseNodeToolDependencies } from "../tools/get-universe-node/register.js";
import { registerGetUniverseRelationsTool, type GetUniverseRelationsToolDependencies } from "../tools/get-universe-relations/register.js";
import { UniverseAuthenticationError } from "../tools/universe/shared.js";
import {
  ActiveUserAuthorizationError,
  requireActiveUser,
  type ActiveUserRepository,
} from "../../domains/require-active-user.js";

let defaultMemoryService: MemoryService | undefined;
let defaultDiaryService: DiaryService | undefined;
let defaultTaskService: TaskService | undefined;
let defaultToyCommandService: ToyCommandService | undefined;
let defaultGlobalSearchService: GlobalSearchService | undefined;
let defaultTodoService: TodoService | undefined;
let defaultNotionReadClient: NotionReadClient | undefined;
let defaultNotionIntegration: NotionIntegration | undefined;
let defaultUniverseService: UniverseService | undefined;
let defaultActiveUserRepository: ActiveUserRepository | undefined;

function getDefaultActiveUserRepository(): ActiveUserRepository {
  if (!defaultActiveUserRepository) {
    if (!env.DATABASE_URL) {
      throw new Error("Active user database is not configured.");
    }
    const { db } = createDatabase(env.DATABASE_URL);
    defaultActiveUserRepository = new DrizzleMemoryRepository(db);
  }
  return defaultActiveUserRepository;
}

export function createProductionActiveUserAuthorizer(
  authenticatedUserId: string | undefined,
): () => Promise<string> {
  return async () => {
    if (!authenticatedUserId) {
      throw new ActiveUserAuthorizationError("USER_NOT_FOUND");
    }
    return requireActiveUser(
      getDefaultActiveUserRepository(),
      authenticatedUserId,
    );
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

function getDefaultTodoService(): TodoService {
  if (!defaultTodoService) {
    if (!env.DATABASE_URL) {
      throw new Error("Todo database is not configured.");
    }
    const { db } = createDatabase(env.DATABASE_URL);
    defaultTodoService = new TodoService(new DrizzleTodoRepository(db));
  }
  return defaultTodoService;
}

function getDefaultGlobalSearchService(): GlobalSearchService {
  if (!defaultGlobalSearchService) {
    if (!env.DATABASE_URL) throw new Error("Global search database is not configured.");
    const { db } = createDatabase(env.DATABASE_URL);
    defaultGlobalSearchService = new GlobalSearchService(new DrizzleGlobalSearchRepository(db));
  }
  return defaultGlobalSearchService;
}

function getDefaultUniverseService(): UniverseService {
  if (!defaultUniverseService) {
    if (!env.DATABASE_URL) throw new Error("Universe database is not configured.");
    const { db } = createDatabase(env.DATABASE_URL);
    defaultUniverseService = new UniverseService(new DrizzleUniverseRepository(db));
  }
  return defaultUniverseService;
}

function getDefaultMemoryService(): MemoryService {
  if (!defaultMemoryService) {
    if (!env.DATABASE_URL) {
      throw new Error("Memory database is not configured.");
    }

    const { db } = createDatabase(env.DATABASE_URL);
    defaultMemoryService = new MemoryService(new DrizzleMemoryRepository(db));
  }

  return defaultMemoryService;
}

function getDefaultDiaryService(): DiaryService {
  if (!defaultDiaryService) {
    if (!env.DATABASE_URL) {
      throw new Error("Diary database is not configured.");
    }

    const { db } = createDatabase(env.DATABASE_URL);
    defaultDiaryService = new DiaryService(new DrizzleDiaryRepository(db));
  }

  return defaultDiaryService;
}

function getDefaultTaskService(): TaskService {
  if (!defaultTaskService) {
    if (!env.DATABASE_URL) {
      throw new Error("Task database is not configured.");
    }

    const { db } = createDatabase(env.DATABASE_URL);
    defaultTaskService = new TaskService(new DrizzleTaskRepository(db));
  }

  return defaultTaskService;
}

function getDefaultToyCommandService(): ToyCommandService {
  if (!defaultToyCommandService) {
    if (!env.DATABASE_URL) {
      throw new Error("Toy database is not configured.");
    }

    const { db } = createDatabase(env.DATABASE_URL);
    defaultToyCommandService = new ToyCommandService(
      new DrizzleToyCommandRepository(db),
      env.LEILEI_TOY_BRIDGE_USER_ID,
    );
  }

  return defaultToyCommandService;
}

const productionReadMemoryDependencies: ReadMemoryToolDependencies = {
  memoryService: {
    readMemory: (input) => getDefaultMemoryService().readMemory(input),
  },
  getAuthenticatedUserId: () => {
    throw new ReadMemoryAuthenticationError();
  },
};

const productionSearchMemoryDependencies: SearchMemoryToolDependencies = {
  memoryService: {
    readMemory: (input) => getDefaultMemoryService().readMemory(input),
  },
  getAuthenticatedUserId: () => {
    throw new ReadMemoryAuthenticationError();
  },
};

const productionGetMemoryDependencies: GetMemoryToolDependencies = {
  memoryService: {
    readMemoryDetail: (input) =>
      getDefaultMemoryService().readMemoryDetail(input),
    readArchivedMemoryDetail: (input) =>
      getDefaultMemoryService().readArchivedMemoryDetail(input),
  },
  getAuthenticatedUserId: () => {
    throw new ReadMemoryAuthenticationError();
  },
};

const productionWriteMemoryDependencies: WriteMemoryToolDependencies = {
  memoryService: {
    createMcpMemory: (context, input, idempotencyKey) =>
      getDefaultMemoryService().createMcpMemory(context, input, idempotencyKey),
  },
  getAuthenticatedUserId: () => {
    throw new WriteMemoryAuthenticationError();
  },
};

const productionUpdateMemoryDependencies: UpdateMemoryToolDependencies = {
  memoryService: {
    updateMcpMemory: (context, input) =>
      getDefaultMemoryService().updateMcpMemory(context, input),
  },
  getAuthenticatedUserId: () => {
    throw new UpdateMemoryAuthenticationError();
  },
};

const productionWriteDiaryDependencies: WriteDiaryToolDependencies = {
  diaryService: {
    createMcpDiary: (context, input) =>
      getDefaultDiaryService().createMcpDiary(context, input),
  },
  getAuthenticatedUserId: () => {
    throw new WriteDiaryAuthenticationError();
  },
};

const productionUpdateDiaryDependencies: UpdateDiaryToolDependencies = {
  diaryService: {
    updateMcpDiary: (context, input) =>
      getDefaultDiaryService().updateMcpDiary(context, input),
  },
  getAuthenticatedUserId: () => {
    throw new UpdateDiaryAuthenticationError();
  },
};

const productionSearchDiaryDependencies: SearchDiaryToolDependencies = {
  diaryService: {
    listDiaries: (input) => getDefaultDiaryService().listDiaries(input),
  },
  getAuthenticatedUserId: () => {
    throw new DiaryReadAuthenticationError();
  },
};

const productionGetDiaryDependencies: GetDiaryToolDependencies = {
  diaryService: {
    readDiary: (input) => getDefaultDiaryService().readDiary(input),
    readArchivedDiary: (input) => getDefaultDiaryService().readArchivedDiary(input),
  },
  getAuthenticatedUserId: () => {
    throw new DiaryReadAuthenticationError();
  },
};

const productionCreateTaskDependencies: CreateTaskToolDependencies = {
  taskService: {
    createTaskIdempotently: (context, input, idempotencyKey) =>
      getDefaultTaskService().createTaskIdempotently(
        context,
        input,
        idempotencyKey,
      ),
  },
  getAuthenticatedUserId: () => {
    throw new CreateTaskAuthenticationError();
  },
};

const productionUpdateTaskDependencies: UpdateTaskToolDependencies = {
  taskService: {
    updateMcpTask: (context, input) =>
      getDefaultTaskService().updateMcpTask(context, input),
  },
  getAuthenticatedUserId: () => {
    throw new UpdateTaskAuthenticationError();
  },
};

const productionTransitionTaskDependencies: TransitionTaskToolDependencies = {
  taskService: {
    transitionMcpTask: (context, input) =>
      getDefaultTaskService().transitionMcpTask(context, input),
  },
  getAuthenticatedUserId: () => {
    throw new TransitionTaskAuthenticationError();
  },
};

const productionListTasksDependencies: ListTasksToolDependencies = {
  taskService: {
    listTasks: (input) => getDefaultTaskService().listTasks(input),
  },
  getAuthenticatedUserId: () => {
    throw new TaskReadAuthenticationError();
  },
};

const productionGetTaskDependencies: GetTaskToolDependencies = {
  taskService: {
    readTask: (input) => getDefaultTaskService().readTask(input),
    readArchivedTask: (input) => getDefaultTaskService().readArchivedTask(input),
  },
  getAuthenticatedUserId: () => {
    throw new TaskReadAuthenticationError();
  },
};

const productionToyCommandDependencies: ToyCommandToolDependencies = {
  toyCommandService: {
    createIdempotently: (userId, input, idempotencyKey) =>
      getDefaultToyCommandService().createIdempotently(
        userId,
        input,
        idempotencyKey,
      ),
  },
  getAuthenticatedUserId: () => {
    throw new ToyCommandAuthenticationError();
  },
};

const productionGlobalSearchDependencies: GlobalSearchToolDependencies = {
  globalSearchService: { search: (input) => getDefaultGlobalSearchService().search(input) },
  getAuthenticatedUserId: () => { throw new GlobalSearchAuthenticationError(); },
};

const productionUniverseService: SearchUniverseToolDependencies["globalSearchService"] &
  GetUniverseNodeToolDependencies["universeService"] & GetUniverseRelationsToolDependencies["universeService"] = {
  search: (input) => getDefaultGlobalSearchService().search(input),
  loadUniverse: (userId) => getDefaultUniverseService().loadUniverse(userId),
};

const productionNotionService: SearchNotionToolDependencies["notionService"] &
  ReadNotionPageToolDependencies["notionService"] = {
  searchPages: (input) => getDefaultNotionReadClient().searchPages(input),
  readPage: (pageId) => getDefaultNotionReadClient().readPage(pageId),
};

const productionTodoService = {
  readDay: (userId: string, date: string) =>
    getDefaultTodoService().readDay(userId, date),
  listDates: (userId: string) => getDefaultTodoService().listDates(userId),
  replacePaperIdempotently: (
    input: Parameters<TodoService["replacePaperIdempotently"]>[0],
  ) => getDefaultTodoService().replacePaperIdempotently(input),
};

type TodoToolsDependencies = {
  todoService: ReadTodoDayToolDependencies["todoService"] &
    ListTodoDatesToolDependencies["todoService"] &
    WriteTodoPaperToolDependencies["todoService"];
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
  universeService: GetUniverseNodeToolDependencies["universeService"] & GetUniverseRelationsToolDependencies["universeService"];
  globalSearchService: SearchUniverseToolDependencies["globalSearchService"];
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
  searchDiary?: SearchDiaryToolDependencies;
  getDiary?: GetDiaryToolDependencies;
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
  todoTools?: TodoToolsDependencies;
  notionTools?: NotionToolsDependencies;
  notionRead?: NotionReadDependencies;
  universeTools?: UniverseToolsDependencies;
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
    createProductionActiveUserAuthorizer(authenticatedUserId);

  registerHelloTool(server);
  registerGetLocalContextTool(server);
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
  registerGetDiaryTool(
    server,
    dependencies.getDiary ?? dependencies.diaryTools ?? {
      ...productionGetDiaryDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new DiaryReadAuthenticationError();
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
  registerGetUniverseRelationsTool(server, universeTools);
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
  return server;
}
