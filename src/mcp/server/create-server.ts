import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MemoryService } from "../../domains/memory/memory-service.js";
import { DrizzleMemoryRepository } from "../../domains/memory/memory-repository.js";
import { DiaryService } from "../../domains/diary/diary-service.js";
import { DrizzleDiaryRepository } from "../../domains/diary/diary-repository.js";
import { createDatabase } from "../../database/client.js";
import { env } from "../../config/env.js";
import { registerHelloTool } from "../tools/hello/register.js";
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

let defaultMemoryService: MemoryService | undefined;
let defaultDiaryService: DiaryService | undefined;

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

const productionReadMemoryDependencies: ReadMemoryToolDependencies = {
  memoryService: {
    readMemory: (input) => getDefaultMemoryService().readMemory(input),
  },
  getAuthenticatedUserId: () => {
    if (!env.MCP_AUTH_TOKEN || !env.MCP_USER_ID) {
      throw new ReadMemoryAuthenticationError();
    }

    return env.MCP_USER_ID;
  },
};

const productionWriteDiaryDependencies: WriteDiaryToolDependencies = {
  diaryService: {
    createDiary: (context, input) =>
      getDefaultDiaryService().createDiary(context, input),
  },
  getAuthenticatedUserId: () => {
    if (!env.MCP_AUTH_TOKEN || !env.MCP_USER_ID) {
      throw new WriteDiaryAuthenticationError();
    }

    return env.MCP_USER_ID;
  },
};

export type McpServerDependencies = {
  readMemory?: ReadMemoryToolDependencies;
  writeDiary?: WriteDiaryToolDependencies;
};

export function createMcpServer(
  dependencies: McpServerDependencies = {},
): McpServer {
  const server = new McpServer({
    name: "leilei-os",
    version: "0.1.0",
  });

  registerHelloTool(server);
  registerReadMemoryTool(
    server,
    dependencies.readMemory ?? productionReadMemoryDependencies,
  );
  registerWriteDiaryTool(
    server,
    dependencies.writeDiary ?? productionWriteDiaryDependencies,
  );
  return server;
}
