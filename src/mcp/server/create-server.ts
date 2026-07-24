import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MemoryService } from "../../domains/memory/memory-service.js";
import { DrizzleMemoryRepository } from "../../domains/memory/memory-repository.js";
import { DiaryService } from "../../domains/diary/diary-service.js";
import { DrizzleDiaryRepository } from "../../domains/diary/diary-repository.js";
import { TaskService } from "../../domains/task/task-service.js";
import { DrizzleTaskRepository } from "../../domains/task/task-repository.js";
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
  registerWriteDiaryTool,
  WriteDiaryAuthenticationError,
  type WriteDiaryToolDependencies,
} from "../tools/write-diary/register.js";
import {
  CreateTaskAuthenticationError,
  registerCreateTaskTool,
  type CreateTaskToolDependencies,
} from "../tools/create-task/register.js";

let defaultMemoryService: MemoryService | undefined;
let defaultDiaryService: DiaryService | undefined;
let defaultTaskService: TaskService | undefined;

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

const productionReadMemoryDependencies: ReadMemoryToolDependencies = {
  memoryService: {
    readMemory: (input) => getDefaultMemoryService().readMemory(input),
  },
  getAuthenticatedUserId: () => {
    throw new ReadMemoryAuthenticationError();
  },
};

const productionWriteDiaryDependencies: WriteDiaryToolDependencies = {
  diaryService: {
    createDiary: (context, input) =>
      getDefaultDiaryService().createDiary(context, input),
  },
  getAuthenticatedUserId: () => {
    throw new WriteDiaryAuthenticationError();
  },
};

const productionCreateTaskDependencies: CreateTaskToolDependencies = {
  taskService: {
    createTask: (context, input) =>
      getDefaultTaskService().createTask(context, input),
  },
  getAuthenticatedUserId: () => {
    throw new CreateTaskAuthenticationError();
  },
};

export type McpServerDependencies = {
  readMemory?: ReadMemoryToolDependencies;
  writeDiary?: WriteDiaryToolDependencies;
  createTask?: CreateTaskToolDependencies;
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
    dependencies.readMemory ?? {
      ...productionReadMemoryDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new ReadMemoryAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  registerWriteDiaryTool(
    server,
    dependencies.writeDiary ?? {
      ...productionWriteDiaryDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new WriteDiaryAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  registerCreateTaskTool(
    server,
    dependencies.createTask ?? {
      ...productionCreateTaskDependencies,
      getAuthenticatedUserId: () => {
        if (!authenticatedUserId) throw new CreateTaskAuthenticationError();
        return authenticatedUserId;
      },
    },
  );
  return server;
}
