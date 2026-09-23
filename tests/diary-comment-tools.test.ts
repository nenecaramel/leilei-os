import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  DiaryCommentDomainError,
  type AddDiaryCommentResult,
  type DiaryCommentResult,
  type ListDiaryCommentsResult,
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
  assert.deepEqual(
    (add.structuredContent as {
      data: {
        outcome: string;
        entity_type: string;
        entity_id: string;
        revision: number | null;
        detail_tool: string | null;
        detail_arguments: unknown;
      };
    }).data,
    {
      comment: COMMENT,
      outcome: "applied",
      entity_type: "diary_comment",
      entity_id: COMMENT_ID,
      revision: 2,
      detail_tool: "get_diary_comment",
      detail_arguments: { id: COMMENT_ID, scope: "active" },
    },
  );

  const updated = await pair.client.callTool({
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

  assert.equal((updated.structuredContent as { data: { outcome: string } }).data.outcome, "applied");

  const deleted = await pair.client.callTool({
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
  assert.deepEqual(
    (deleted.structuredContent as {
      data: {
        outcome: string;
        entity_type: string;
        entity_id: string;
        revision: number | null;
        detail_tool: string | null;
        detail_arguments: unknown;
      };
    }).data,
    {
      comment_id: COMMENT_ID,
      deleted: true,
      outcome: "applied",
      entity_type: "diary_comment",
      entity_id: COMMENT_ID,
      revision: null,
      detail_tool: null,
      detail_arguments: null,
    },
  );
});

test("Diary comment revision conflicts point to exact comment readback", async (t) => {
  const comments = new CommentService();
  comments.updateComment = async () => {
    throw new DiaryCommentDomainError(
      "COMMENT_REVISION_CONFLICT",
      "private stale comment detail",
    );
  };
  const pair = await connect(comments);
  t.after(async () => {
    await pair.client.close();
    await pair.server.close();
  });

  const result = await pair.client.callTool({
    name: "update_diary_comment",
    arguments: {
      id: COMMENT_ID,
      expected_revision: 2,
      content: "changed",
    },
  });

  assert.equal(result.isError, true);
  assert.deepEqual(
    (result.structuredContent as any).error,
    {
      code: "COMMENT_REVISION_CONFLICT",
      message: "Diary comment revision changed. Read the comment again before retrying.",
      retryable: false,
      reason: "stale_revision",
      current_revision: null,
      recommended_tool: "get_diary_comment",
      recommended_arguments: { id: COMMENT_ID, scope: "active" },
    },
  );
  assert.doesNotMatch(JSON.stringify(result), /private stale comment detail/);
});

test("get_diary returns a comment pagination pointer without embedding comments", async (t) => {
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
      comments_tool: string;
      comments_arguments: { diary_id: string; scope: string };
    };
  }).data;
  assert.equal(data.comments_tool, "list_diary_comments");
  assert.deepEqual(data.comments_arguments, {
    diary_id: DIARY_ID,
    scope: "active",
  });
  assert.equal(comments.listCalls.length, 0);
  assert.equal(JSON.stringify(result.structuredContent).includes('"comments"'), false);
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
