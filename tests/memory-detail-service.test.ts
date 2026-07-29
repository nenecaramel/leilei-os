import assert from "node:assert/strict";
import test from "node:test";
import type {
  MemoryRepository,
} from "../src/domains/memory/memory-repository.js";
import {
  MemoryDomainError,
  MemoryService,
} from "../src/domains/memory/memory-service.js";

function repository(
  overrides: Partial<MemoryRepository> = {},
): MemoryRepository {
  return {
    async findUserById() {
      return { displayName: "Leilei", status: "active" };
    },
    async findActiveAssistantMemories() {
      return [];
    },
    async findActiveAssistantMemoryCategories() {
      return [];
    },
    async findActiveAssistantMemoryTags() {
      return [];
    },
    async findActiveAssistantMemoryById() {
      return {
        id: "memory-1",
        category: "preference",
        key: "focus_style",
        content: "One milestone at a time.",
        tags: [],
        source: "phase_2_validation",
        updatedAt: new Date("2026-07-28T00:00:00.000Z"),
      };
    },
    async findArchivedAssistantMemories() {
      return [];
    },
    async findArchivedAssistantMemoryById() {
      return null;
    },
    async createMemory() {},
    async updateMemory() {
      return true;
    },
    async archiveMemory() {
      return true;
    },
    async restoreMemory() {
      return true;
    },
    ...overrides,
  };
}

test("Memory restore validates the active user and trims the id before mutation", async () => {
  const calls: unknown[] = [];
  const service = new MemoryService(repository({
    async restoreMemory(input) {
      calls.push(input);
      return true;
    },
  }));

  await service.restoreMemory({
    userId: "user-a",
    id: " archived-1 ",
  });
  assert.deepEqual(calls, [{
    userId: "user-a",
    id: "archived-1",
    actorType: "user",
    channel: "web",
  }]);
});

for (const userState of ["missing", "disabled"] as const) {
  test(`Memory restore rejects a ${userState} user before mutation`, async () => {
    let mutated = false;
    const service = new MemoryService(repository({
      async findUserById() {
        return userState === "missing"
          ? null
          : { displayName: "Leilei", status: "disabled" };
      },
      async restoreMemory() {
        mutated = true;
        return true;
      },
    }));

    await assert.rejects(
      service.restoreMemory({
        userId: "user-a",
        id: "archived-1",
      }),
      (error) =>
        error instanceof MemoryDomainError &&
        error.code ===
          (userState === "missing"
            ? "USER_NOT_FOUND"
            : "USER_DISABLED"),
    );
    assert.equal(mutated, false);
  });
}

test("Memory restore and repeated restore hide ineligible records as not found", async () => {
  let eligible = true;
  const service = new MemoryService(repository({
    async restoreMemory() {
      const result = eligible;
      eligible = false;
      return result;
    },
  }));
  const input = { userId: "user-a", id: "archived-1" };

  await service.restoreMemory(input);
  await assert.rejects(
    service.restoreMemory(input),
    (error) =>
      error instanceof MemoryDomainError &&
      error.code === "MEMORY_NOT_FOUND",
  );
});

test("Memory archived detail validates the user and returns safe fields", async () => {
  const calls: unknown[] = [];
  const service = new MemoryService(repository({
    async findArchivedAssistantMemoryById(input) {
      calls.push(input);
      return {
        id: input.id,
        category: "project",
        key: "finished_project",
        content: "Archived context",
        tags: ["archive"],
        source: "web",
        updatedAt: new Date("2026-07-29T03:00:00.000Z"),
      };
    },
  }));

  const result = await service.readArchivedMemoryDetail({
    userId: "user-a",
    id: " archived-1 ",
  });

  assert.deepEqual(calls, [{ userId: "user-a", id: "archived-1" }]);
  assert.deepEqual(result, {
    id: "archived-1",
    category: "project",
    key: "finished_project",
    content: "Archived context",
    tags: ["archive"],
    source: "web",
    updated_at: "2026-07-29T03:00:00.000Z",
  });
});

test("Memory archived detail returns complete content while archived list remains bounded", async () => {
  const completeContent = "A".repeat(4_050);
  const record = {
    id: "archived-long",
    category: "project" as const,
    key: "archived_long",
    content: completeContent,
    tags: ["archive"],
    source: "web",
    updatedAt: new Date("2026-07-29T03:00:00.000Z"),
  };
  const service = new MemoryService(repository({
    async findArchivedAssistantMemoryById() {
      return record;
    },
    async findArchivedAssistantMemories() {
      return [record];
    },
  }));

  const detail = await service.readArchivedMemoryDetail({
    userId: "user-a",
    id: record.id,
  });
  const list = await service.readArchivedMemories({
    userId: "user-a",
  });

  assert.equal(detail.content, completeContent);
  assert.equal(detail.content.length, completeContent.length);
  assert.equal(detail.content.endsWith("…"), false);
  assert.notEqual(list.memories[0]?.content, completeContent);
  assert.equal(list.memories[0]?.content.endsWith("…"), true);
});

for (const recordKind of [
  "missing",
  "active",
  "private",
  "restricted",
  "cross-user",
] as const) {
  test(`Memory archived detail hides ${recordKind} records as not found`, async () => {
    const service = new MemoryService(repository({
      async findArchivedAssistantMemoryById() {
        return null;
      },
    }));

    await assert.rejects(
      service.readArchivedMemoryDetail({
        userId: "user-a",
        id: `${recordKind}-memory`,
      }),
      (error) =>
        error instanceof MemoryDomainError &&
        error.code === "MEMORY_NOT_FOUND",
    );
  });
}

for (const userState of ["missing", "disabled"] as const) {
  test(`Memory archived detail rejects a ${userState} user before record lookup`, async () => {
    let queried = false;
    const service = new MemoryService(repository({
      async findUserById() {
        return userState === "missing"
          ? null
          : { displayName: "Leilei", status: "disabled" };
      },
      async findArchivedAssistantMemoryById() {
        queried = true;
        return null;
      },
    }));

    await assert.rejects(
      service.readArchivedMemoryDetail({
        userId: "user-a",
        id: "archived-1",
      }),
      (error) =>
        error instanceof MemoryDomainError &&
        error.code ===
          (userState === "missing"
            ? "USER_NOT_FOUND"
            : "USER_DISABLED"),
    );
    assert.equal(queried, false);
  });
}

test("Memory detail uses the authenticated user for an active assistant-visible record", async () => {
  const calls: unknown[] = [];
  const service = new MemoryService(repository({
    async findActiveAssistantMemoryById(input) {
      calls.push(input);
      return {
        id: input.id,
        category: "preference",
        key: "focus_style",
        content: "One milestone at a time.",
        tags: ["focus"],
        source: "phase_2_validation",
        updatedAt: new Date("2026-07-28T00:00:00.000Z"),
      };
    },
  }));

  const result = await service.readMemoryDetail({
    userId: "user-a",
    id: " memory-1 ",
  });

  assert.deepEqual(calls, [{ userId: "user-a", id: "memory-1" }]);
  assert.equal(result.id, "memory-1");
  assert.equal(result.content, "One milestone at a time.");
  assert.equal(result.source, "phase_2_validation");
});

test("Memory list exposes source only for the trusted Web read path", async () => {
  const service = new MemoryService(repository({
    async findActiveAssistantMemories() {
      return [{
        id: "memory-1",
        category: "goal",
        key: "source_rule",
        content: "Source remains immutable.",
        tags: [],
        source: "web",
        updatedAt: new Date("2026-07-28T00:00:00.000Z"),
      }];
    },
  }));

  const internal = await service.readMemory({ userId: "user-a" });
  const web = await service.readMemory({
    userId: "user-a",
    includeSource: true,
  });

  assert.equal("source" in internal.memories[0], false);
  assert.equal(web.memories[0]?.source, "web");
});

test("Memory search and category filters are normalized and combined for the authenticated user", async () => {
  const calls: unknown[] = [];
  const service = new MemoryService(repository({
    async findActiveAssistantMemories(input) {
      calls.push(input);
      return [];
    },
  }));

  await service.readMemory({
    userId: "user-a",
    query: "  focused plan  ",
    categories: ["goal"],
    tag: " focus ",
  });

  assert.deepEqual(calls, [{
    userId: "user-a",
    query: "focused plan",
    categories: ["goal"],
    keys: undefined,
    tag: "focus",
    ordering: "default",
    limit: 50,
  }]);
});

test("Memory supports search-only and exact-category-only repository queries", async () => {
  const calls: unknown[] = [];
  const service = new MemoryService(repository({
    async findActiveAssistantMemories(input) {
      calls.push(input);
      return [];
    },
  }));

  await service.readMemory({
    userId: "user-a",
    query: "literal %_\\ text",
  });
  await service.readMemory({
    userId: "user-a",
    categories: ["project"],
  });

  assert.deepEqual(calls, [
    {
      userId: "user-a",
      query: "literal %_\\ text",
      categories: undefined,
      keys: undefined,
      tag: undefined,
      ordering: "default",
      limit: 50,
    },
    {
      userId: "user-a",
      query: undefined,
      categories: ["project"],
      keys: undefined,
      tag: undefined,
      ordering: "default",
      limit: 50,
    },
  ]);
});

test("Memory Service forwards explicit Web ordering without changing the default", async () => {
  const calls: unknown[] = [];
  const service = new MemoryService(repository({
    async findActiveAssistantMemories(input) {
      calls.push(input);
      return [];
    },
  }));

  await service.readMemory({ userId: "user-a" });
  await service.readMemory({
    userId: "user-a",
    ordering: "updated_desc",
  });

  assert.deepEqual(
    calls.map((call) => (call as { ordering: string }).ordering),
    ["default", "updated_desc"],
  );
});

test("Memory category options use only the authenticated active user's repository scope", async () => {
  const users: string[] = [];
  const service = new MemoryService(repository({
    async findActiveAssistantMemoryCategories(userId) {
      users.push(userId);
      return ["goal", "project"];
    },
  }));

  assert.deepEqual(
    await service.listAvailableCategories("user-a"),
    ["goal", "project"],
  );
  assert.deepEqual(users, ["user-a"]);
});

test("Memory category options reject a disabled user before querying visible categories", async () => {
  let queried = false;
  const service = new MemoryService(repository({
    async findUserById() {
      return { displayName: "Leilei", status: "disabled" };
    },
    async findActiveAssistantMemoryCategories() {
      queried = true;
      return [];
    },
  }));

  await assert.rejects(
    service.listAvailableCategories("user-a"),
    (error) =>
      error instanceof MemoryDomainError &&
      error.code === "USER_DISABLED",
  );
  assert.equal(queried, false);
});

test("Memory creates and edits normalized tags using the shared tag rules", async () => {
  const writes: unknown[] = [];
  const service = new MemoryService(repository({
    async createMemory(input) {
      writes.push({ create: input });
    },
    async updateMemory(input) {
      writes.push({ update: input });
      return true;
    },
  }));

  await service.createMemory({
    userId: "user-a",
    category: "goal",
    key: "tagged_memory",
    content: "Tagged content",
    tags: [" 计划 ", "MCP", "计划"],
  });
  await service.updateMemory({
    userId: "user-a",
    id: "memory-1",
    content: "Updated",
    tags: ["MCP", "完成"],
  });

  assert.deepEqual(writes, [
    {
      create: {
        userId: "user-a",
        category: "goal",
        key: "tagged_memory",
        content: "Tagged content",
        tags: ["计划", "MCP"],
        source: "web",
      },
    },
    {
      update: {
        userId: "user-a",
        id: "memory-1",
        content: "Updated",
        tags: ["MCP", "完成"],
      },
    },
  ]);
});

for (const operation of ["create", "update", "archive"] as const) {
  test(`Memory ${operation} validates an active user before mutating`, async () => {
    let mutations = 0;
    const service = new MemoryService(repository({
      async createMemory() {
        mutations += 1;
      },
      async updateMemory() {
        mutations += 1;
        return true;
      },
      async archiveMemory() {
        mutations += 1;
        return true;
      },
    }));

    if (operation === "create") {
      await service.createMemory({
        userId: "user-a",
        category: "goal",
        key: "memory-key",
        content: "Content",
      });
    } else if (operation === "update") {
      await service.updateMemory({
        userId: "user-a",
        id: "memory-1",
        content: "Updated",
      });
    } else {
      await service.archiveMemory({
        userId: "user-a",
        id: "memory-1",
      });
    }

    assert.equal(mutations, 1);
  });

  for (const userState of ["missing", "disabled"] as const) {
    test(`Memory ${operation} rejects a ${userState} user without mutating`, async () => {
      let mutations = 0;
      const service = new MemoryService(repository({
        async findUserById() {
          return userState === "missing"
            ? null
            : { displayName: "Leilei", status: "disabled" };
        },
        async createMemory() {
          mutations += 1;
        },
        async updateMemory() {
          mutations += 1;
          return true;
        },
        async archiveMemory() {
          mutations += 1;
          return true;
        },
      }));

      const action =
        operation === "create"
          ? service.createMemory({
              userId: "user-a",
              category: "goal",
              key: "memory-key",
              content: "Content",
            })
          : operation === "update"
            ? service.updateMemory({
                userId: "user-a",
                id: "memory-1",
                content: "Updated",
              })
            : service.archiveMemory({
                userId: "user-a",
                id: "memory-1",
              });

      await assert.rejects(
        action,
        (error) =>
          error instanceof MemoryDomainError &&
          error.code ===
            (userState === "missing"
              ? "USER_NOT_FOUND"
              : "USER_DISABLED"),
      );
      assert.equal(mutations, 0);
    });
  }
}

for (const reason of [
  "missing",
  "cross-user",
  "archived",
  "private",
  "restricted",
] as const) {
  test(`Memory update returns MEMORY_NOT_FOUND for a ${reason} record`, async () => {
    const service = new MemoryService(repository({
      async updateMemory() {
        return false;
      },
    }));

    await assert.rejects(
      service.updateMemory({
        userId: "user-a",
        id: `memory-${reason}`,
        content: "Updated",
      }),
      (error) =>
        error instanceof MemoryDomainError &&
        error.code === "MEMORY_NOT_FOUND",
    );
  });

  test(`Memory archive returns MEMORY_NOT_FOUND for a ${reason} record`, async () => {
    const service = new MemoryService(repository({
      async archiveMemory() {
        return false;
      },
    }));

    await assert.rejects(
      service.archiveMemory({
        userId: "user-a",
        id: `memory-${reason}`,
      }),
      (error) =>
        error instanceof MemoryDomainError &&
        error.code === "MEMORY_NOT_FOUND",
    );
  });
}

test("Memory repeated archive returns MEMORY_NOT_FOUND after the first success", async () => {
  let attempts = 0;
  const service = new MemoryService(repository({
    async archiveMemory() {
      attempts += 1;
      return attempts === 1;
    },
  }));

  const input = { userId: "user-a", id: "memory-1" };
  await service.archiveMemory(input);
  await assert.rejects(
    service.archiveMemory(input),
    (error) =>
      error instanceof MemoryDomainError &&
      error.code === "MEMORY_NOT_FOUND",
  );
});

test("Memory archive assigns the server-owned Web lifecycle actor and channel", async () => {
  const calls: unknown[] = [];
  const service = new MemoryService(repository({
    async archiveMemory(input) {
      calls.push(input);
      return true;
    },
  }));

  await service.archiveMemory({
    userId: "user-a",
    id: "memory-1",
  });

  assert.deepEqual(calls, [{
    userId: "user-a",
    id: "memory-1",
    actorType: "user",
    channel: "web",
  }]);
});

test("Memory tag validation rejects blank, oversized, and excessive tags", async () => {
  const service = new MemoryService(repository());
  for (const tags of [
    ["   "],
    ["x".repeat(51)],
    Array.from({ length: 21 }, (_, index) => `tag-${index}`),
  ]) {
    await assert.rejects(
      service.createMemory({
        userId: "user-a",
        category: "goal",
        key: "tagged_memory",
        content: "Tagged content",
        tags,
      }),
      (error) =>
        error instanceof MemoryDomainError &&
        error.code === "INVALID_MEMORY_TAGS",
    );
  }
});

test("Memory tag options use only the authenticated active user's repository scope", async () => {
  const users: string[] = [];
  const service = new MemoryService(repository({
    async findActiveAssistantMemoryTags(userId) {
      users.push(userId);
      return ["MCP", "计划"];
    },
  }));

  assert.deepEqual(
    await service.listAvailableTags("user-a"),
    ["MCP", "计划"],
  );
  assert.deepEqual(users, ["user-a"]);
});

test("Memory search rejects oversized input before querying records", async () => {
  let queried = false;
  const service = new MemoryService(repository({
    async findActiveAssistantMemories() {
      queried = true;
      return [];
    },
  }));

  await assert.rejects(
    service.readMemory({
      userId: "user-a",
      query: "x".repeat(201),
    }),
    (error) =>
      error instanceof MemoryDomainError &&
      error.code === "INVALID_MEMORY_QUERY",
  );
  assert.equal(queried, false);
});

test("Memory detail cannot return a record outside the authenticated user scope", async () => {
  const service = new MemoryService(repository({
    async findActiveAssistantMemoryById(input) {
      assert.equal(input.userId, "user-a");
      return null;
    },
  }));

  await assert.rejects(
    service.readMemoryDetail({
      userId: "user-a",
      id: "owned-by-user-b",
    }),
    (error) =>
      error instanceof MemoryDomainError &&
      error.code === "MEMORY_NOT_FOUND",
  );
});

test("Memory detail checks active user status before querying the record", async () => {
  let queried = false;
  const service = new MemoryService(repository({
    async findUserById() {
      return { displayName: "Leilei", status: "disabled" };
    },
    async findActiveAssistantMemoryById() {
      queried = true;
      return null;
    },
  }));

  await assert.rejects(
    service.readMemoryDetail({
      userId: "user-a",
      id: "memory-1",
    }),
    (error) =>
      error instanceof MemoryDomainError &&
      error.code === "USER_DISABLED",
  );
  assert.equal(queried, false);
});

test("Memory archived list validates the active user and returns bounded safe records", async () => {
  const calls: unknown[] = [];
  const service = new MemoryService(repository({
    async findArchivedAssistantMemories(input) {
      calls.push(input);
      return [{
        id: "memory-archived",
        category: "project",
        key: "completed_project",
        content: "Archived context",
        tags: ["archive"],
        source: "web",
        updatedAt: new Date("2026-07-29T01:00:00.000Z"),
      }];
    },
  }));

  const result = await service.readArchivedMemories({
    userId: "user-a",
  });

  assert.deepEqual(calls, [{ userId: "user-a", limit: 50 }]);
  assert.deepEqual(result, {
    memories: [{
      id: "memory-archived",
      category: "project",
      key: "completed_project",
      content: "Archived context",
      tags: ["archive"],
      source: "web",
      updated_at: "2026-07-29T01:00:00.000Z",
    }],
    metadata: { count: 1 },
  });
});

for (const userState of ["missing", "disabled"] as const) {
  test(`Memory archived list rejects a ${userState} user before querying records`, async () => {
    let queried = false;
    const service = new MemoryService(repository({
      async findUserById() {
        return userState === "missing"
          ? null
          : { displayName: "Leilei", status: "disabled" };
      },
      async findArchivedAssistantMemories() {
        queried = true;
        return [];
      },
    }));

    await assert.rejects(
      service.readArchivedMemories({ userId: "user-a" }),
      (error) =>
        error instanceof MemoryDomainError &&
        error.code ===
          (userState === "missing"
            ? "USER_NOT_FOUND"
            : "USER_DISABLED"),
    );
    assert.equal(queried, false);
  });
}
