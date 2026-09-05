import "dotenv/config";
import postgres from "postgres";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { ContentAuthor } from "../src/domains/content-author.js";

export const phase2SeedEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  MCP_USER_ID: z.string().uuid(),
  SEED_CONTENT_AUTHOR: z.enum(["L", "G", "C"]),
  SEED_USER_EMAIL: z
    .string()
    .email()
    .default("leilei-mcp@example.invalid"),
  SEED_USER_DISPLAY_NAME: z.string().trim().min(1).max(120).default("Leilei"),
});

const testMemories = [
  {
    category: "profile",
    key: "preferred_name",
    content: "Leilei",
    visibility: "assistant",
    sortOrder: 10,
  },
  {
    category: "preference",
    key: "response_style",
    content: "Prefers concise, structured responses.",
    visibility: "assistant",
    sortOrder: 20,
  },
  {
    category: "goal",
    key: "phase_2_validation_goal",
    content: "Validate that Leilei OS reads real PostgreSQL memory through MCP.",
    visibility: "assistant",
    sortOrder: 30,
  },
  {
    category: "profile",
    key: "private_visibility_test",
    content: "This low-sensitivity test record must never be returned by read_memory.",
    visibility: "private",
    sortOrder: 40,
  },
] as const;

export type Phase2SeedInput = {
  userId: string;
  email: string;
  displayName: string;
  author: ContentAuthor;
};

export async function seedPhase2ValidationData(
  transaction: postgres.TransactionSql,
  input: Phase2SeedInput,
) {
  await transaction`
    insert into users (id, email, display_name, status)
    values (
      ${input.userId}::uuid,
      ${input.email},
      ${input.displayName},
      'active'
    )
    on conflict (id) do update set
      email = excluded.email,
      display_name = excluded.display_name,
      status = 'active',
      updated_at = now()
  `;

  for (const memory of testMemories) {
    await transaction`
      insert into core_memories (
        user_id,
        category,
        key,
        content,
        visibility,
        source,
        author,
        status,
        sort_order
      )
      values (
        ${input.userId}::uuid,
        ${memory.category}::memory_category,
        ${memory.key},
        ${memory.content},
        ${memory.visibility}::memory_visibility,
        'phase_2_validation',
        ${input.author}::content_author,
        'active',
        ${memory.sortOrder}
      )
      on conflict (user_id, key) do update set
        category = excluded.category,
        content = excluded.content,
        visibility = excluded.visibility,
        author = excluded.author,
        status = 'active',
        sort_order = excluded.sort_order,
        updated_at = now()
    `;
  }
}

async function main() {
  const seedEnv = phase2SeedEnvSchema.parse(process.env);
  const sql = postgres(seedEnv.DATABASE_URL, {
    max: 1,
    prepare: false,
  });

  try {
    await sql.begin((transaction) =>
      seedPhase2ValidationData(transaction, {
        userId: seedEnv.MCP_USER_ID,
        email: seedEnv.SEED_USER_EMAIL,
        displayName: seedEnv.SEED_USER_DISPLAY_NAME,
        author: seedEnv.SEED_CONTENT_AUTHOR,
      }),
    );

    console.log("Phase 2 validation data initialized successfully.");
  } finally {
    await sql.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
