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
  registerWriteDiaryTool,
  WriteDiaryAuthenticationError,
  type WriteDiaryToolDependencies,
} from "../tools/write-diary/register.js";
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

let defaultMemoryService: MemoryService | undefined;
let defaultDiaryService: DiaryService | undefined;
let defaultTaskService: TaskService | undefined;
let defaultToyCommandService: ToyCommandService | undefined;
let defaultGlobalSearchService: GlobalSearchService | undefined;

function getDefaultGlobalSearchService(): GlobalSearchService {
  if (!defaultGlobalSearchService) {
    if (!env.DATABASE_URL) throw new Error("Global search database is not configured.");
    const { db } = createDatabase(env.DATABASE_URL);
    defaultGlobalSearchService = new GlobalSearchService(new DrizzleGlobalSearchRepository(db));
  }
  return defaultGlobalSearchService;
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

const productionWriteDiaryDependencies: WriteDiaryToolDependencies = {
  diaryService: {
    createMcpDiary: (context, input) =>
      getDefaultDiaryService().createMcpDiary(context, input),
  },
  getAuthenticatedUserId: () => {
    throw new WriteDiaryAuthenticationError();
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

export type McpServerDependencies = {
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
  diaryTools?: {
    diaryService: WriteDiaryToolDependencies["diaryService"] &
      SearchDiaryToolDependencies["diaryService"] &
      GetDiaryToolDependencies["diaryService"];
    getAuthenticatedUserId: () => string;
  };
  writeDiary?: WriteDiaryToolDependencies;
  searchDiary?: SearchDiaryToolDependencies;
  getDiary?: GetDiaryToolDependencies;
  taskTools?: {
    taskService: CreateTaskToolDependencies["taskService"] &
      ListTasksToolDependencies["taskService"] &
      GetTaskToolDependencies["taskService"];
    getAuthenticatedUserId: () => string;
  };
  createTask?: CreateTaskToolDependencies;
  listTasks?: ListTasksToolDependencies;
  getTask?: GetTaskToolDependencies;
  toyCommand?: ToyCommandToolDependencies;
  globalSearch?: GlobalSearchToolDependencies;
};

export function createMcpServer(
  dependencies: McpServerDependencies = {},
  authenticatedUserId?: string,
): McpServer {
  const server = new McpServer({
    name: "leilei-os",
    version: "0.1.0",
  });

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
  return server;
}
