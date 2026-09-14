import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  AddDiaryCommentResult,
  DiaryCommentResult,
  ListDiaryCommentsResult,
} from "../src/domains/diary/diary-comment-service.js";
import type {
  AuthenticatedDiaryContext,
  CreateDiaryInput,
  CreateDiaryResult,
  DiaryEntryResult,
  ListDiariesInput,
  ListDiariesResult,
  ReadDiaryInput,
} from "../src/domains/diary/diary-service.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

const USER_ID = "00000000-0000-4000-8000-000000000111";
const DIARY_ID = "00000000-0000-4000-8000-000000000211";
const COMMENT_ID = "00000000-0000-4000-8000-000000000311";

const COMMENT: DiaryCommentResult = {
  id: COMMENT_ID,
  diary_id: DIARY_ID,
  author: "C",
  content: "这是独立 comment。",
  revision: 2,
  created_at: "2026-09-14T01:00:00.000Z",
  updated_at: "2026-09-14T01:05:00.000Z",
};

const ENTRY: DiaryEntryResult = {
  id: DIARY_ID,
  title: "Diary with comments",
  content: "正文保持独立。",
  date: "2026-09-14",
  tags: [],
  mood: null,
  author: "L",
  created_at: "2026-09-14T00:00:00.000Z",
  updated_at: "2026-09-14T00:00:00.000Z",
};

class CommentService {
  addCalls: unknown[] = [];
  updateCalls: unknown[] = [];
  deleteCalls: unknown[] = [];
  listCalls: unknown[] = [];
  getCalls: unknown[] = [];

  async addMcpComment(
    context: { userId: string },
    input: {
      diaryId: string;
      author: "L" | "G" | "C";
      content: string;
      idempotencyKey: string;
    },
  ): Promise<AddDiaryCommentResult> {
    this.addCalls.push({ context, input });
    return {
      comment: COMMENT,
      metadata: { created: true, idempotent_replay: false },
    };
  }

  async getComment(input: {
    userId: string;
    id: string;
    scope?: "active" | "archived";
  }): Promise<DiaryCommentResult> {
    this.getCalls.push(input);
    return COMMENT;
  }

  async listComments(input: {
    userId: string;
    diaryId: string;
    scope?: "active" | "archived";
    limit?: number;
    before?: string;
  }): Promise<ListDiaryCommentsResult> {
    this.listCalls.push(input);
    return {
      comments: [COMMENT],
      metadata: {
        count: 1,
        returned: 1,
        has_more: false,
        next_before: null,
      },
    };
  }

  async updateComment(input: {
    userId: string;
    id: string;
    expectedRevision: number;
    content: string;
  }): Promise<DiaryCommentResult> {
    this.updateCalls.push(input);
    return { ...COMMENT, content: input.content, revision: 3 };
  }

  async deleteComment(input: {
    userId: string;
    id: string;
    expectedRevision: number;
  }): Promise<{ comment_id: string; deleted: true }> {
    this.deleteCalls.push(input);
    return { comment_id: input.id, deleted: true };
  }
}

class DiaryServiceStub {
  async listDiaries(_input: ListDiariesInput): Promise<ListDiariesResult> {
    return { diaries: [ENTRY], metadata: { count: 1 } };
  }
  async searchDiaryDiscovery() {
    return {
      diaries: [{
        id: ENTRY.id,
        title: ENTRY.title,
        date: ENTRY.date,
        tags: ENTRY.tags,
        mood: ENTRY.mood,
        author: ENTRY.author,
        created_at: ENTRY.created_at,
        updated_at: ENTRY.updated_at,
        snippet: null,
      }],
      metadata: { count: 1 },
    };
  }
  async readDiary(_input: ReadDiaryInput): Promise<DiaryEntryResult> {
    return ENTRY;
  }
  async readArchivedDiary(_input: ReadDiaryInput): Promise<DiaryEntryResult> {
    return ENTRY;
  }
  async createMcpDiary(
    _context: AuthenticatedDiaryContext,
    input: CreateDiaryInput,
  ): Promise<CreateDiaryResult> {
    return {
      diary: {
        id: DIARY_ID,
        title: input.title,
        date: input.date,
        tags: [...input.tags],
        mood: input.mood ?? null,
        author: input.author,
        created_at: ENTRY.created_at,
      },
      metadata: { created: true, idempotent_replay: false },
    };
  }
}

async function connect(
  comments: CommentService,
) {
  const server = createMcpServer({
    diaryTools: {
      diaryService: new DiaryServiceStub(),
      getAuthenticatedUserId: () => USER_ID,
    },
    diaryComments: {
      diaryCommentService: comments,
      getAuthenticatedUserId: () => USER_ID,
    },
  });
  const client = new Client(
    { name: "diary-comment-tools-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("Diary comment MCP inventory exposes the full CRUD surface with safe annotations", async (t) => {
  const pair = await connect(new CommentService());
  t.after(async () => {
    await pair.client.close();
    await pair.server.close();
  });

  const tools = await pair.client.listTools();
  const expected = {
    add_diary_comment: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    get_diary_comment: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    list_diary_comments: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    update_diary_comment: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    delete_diary_comment: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  } as const;

  for (const [name, annotations] of Object.entries(expected)) {
    const tool = tools.tools.find((candidate) => candidate.name === name);
    assert.ok(tool, name);
    assert.deepEqual(tool.annotations, annotations);
    assert.equal("user_id" in (tool.inputSchema.properties ?? {}), false);
  }
});

test("Diary comment MCP mutations bind authenticated identity and preserve revision CAS", async (t) => {
  const comments = new CommentService();
  const pair = await connect(comments);
  t.after(async () => {
    await pair.client.close();
    await pair.server.close();
  });

  const add = await pair.client.callTool({
    name: "add_diary_comment",
    arguments: {
      diary_id: DIARY_ID,
      author: "C",
      content: "这是独立 comment。",
      idempotency_key: "diary-comment-tool-0001",
    },
  });
  assert.equal(add.isError, undefined);
  assert.deepEqual(comments.addCalls[0], {
    context: { userId: USER_ID },
    input: {
      diaryId: DIARY_ID,
      author: "C",
      content: "这是独立 comment。",
      idempotencyKey: "diary-comment-tool-0001",
    },
  });

  await pair.client.callTool({
    name: "update_diary_comment",
    arguments: {
      id: COMMENT_ID,
      expected_revision: 2,
      content: "改过的 comment。",
    },
  });
  assert.deepEqual(comments.updateCalls[0], {
    userId: USER_ID,
    id: COMMENT_ID,
    expectedRevision: 2,
    content: "改过的 comment。",
  });

  await pair.client.callTool({
    name: "delete_diary_comment",
    arguments: {
      id: COMMENT_ID,
      expected_revision: 3,
    },
  });
  assert.deepEqual(comments.deleteCalls[0], {
    userId: USER_ID,
    id: COMMENT_ID,
    expectedRevision: 3,
  });
});

test("get_diary includes the recent canonical comment window when the comment service is configured", async (t) => {
  const comments = new CommentService();
  const pair = await connect(comments);
  t.after(async () => {
    await pair.client.close();
    await pair.server.close();
  });

  const result = await pair.client.callTool({
    name: "get_diary",
    arguments: { id: DIARY_ID },
  });

  const data = (result.structuredContent as {
    data: {
      comments: DiaryCommentResult[];
      comments_metadata: {
        count: number;
        returned: number;
        truncated: boolean;
      };
    };
  }).data;
  assert.deepEqual(data.comments, [COMMENT]);
  assert.deepEqual(data.comments_metadata, {
    count: 1,
    returned: 1,
    truncated: false,
  });
  assert.deepEqual(comments.listCalls[0], {
    userId: USER_ID,
    diaryId: DIARY_ID,
    scope: "active",
    limit: 50,
  });
});

test("list_diary_comments supports archived reads and opaque pagination", async (t) => {
  const comments = new CommentService();
  const pair = await connect(comments);
  t.after(async () => {
    await pair.client.close();
    await pair.server.close();
  });

  const result = await pair.client.callTool({
    name: "list_diary_comments",
    arguments: {
      diary_id: DIARY_ID,
      scope: "archived",
      limit: 25,
      before: "opaque-cursor",
    },
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(comments.listCalls[0], {
    userId: USER_ID,
    diaryId: DIARY_ID,
    scope: "archived",
    limit: 25,
    before: "opaque-cursor",
  });
});
