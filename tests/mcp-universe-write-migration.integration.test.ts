import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import test from "node:test";

const databaseUrl = process.env.DATABASE_URL;
const parsed = databaseUrl ? new URL(databaseUrl) : null;
const run = process.env.RUN_UNIVERSE_MCP_WRITE_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && (parsed?.hostname === "localhost" || parsed?.hostname === "127.0.0.1");

test(
  "0025 upgrades a UUID MCP ledger losslessly and admits Universe resource ids",
  { skip: !run },
  async () => {
    const admin = postgres(databaseUrl!, { max: 1, prepare: false, ssl: false });
    const schemaName = `mcp_universe_0025_${randomBytes(8).toString("hex")}`;
    const scoped = () => postgres(databaseUrl!, {
      max: 1,
      prepare: false,
      ssl: false,
      connection: { search_path: schemaName },
    });
    const legacyId = randomUUID();
    const userId = randomUUID();
    try {
      await admin.unsafe(`CREATE SCHEMA "${schemaName}"`);
      const client = scoped();
      try {
        await client.unsafe(`
          CREATE TABLE mcp_write_idempotency (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL,
            tool_name varchar(100) NOT NULL,
            idempotency_key varchar(128) NOT NULL,
            request_hash varchar(64) NOT NULL,
            resource_type varchar(32) NOT NULL,
            resource_id uuid NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT mcp_write_idempotency_tool_allowed CHECK
              (tool_name IN ('create_task', 'write_diary', 'write_memory', 'toy_set', 'toy_stop', 'write_todo_paper')),
            CONSTRAINT mcp_write_idempotency_resource_type_allowed CHECK
              (resource_type IN ('task', 'diary_entry', 'memory', 'toy_command', 'todo_paper'))
          )
        `);
        await client`
          INSERT INTO mcp_write_idempotency
            (id, user_id, tool_name, idempotency_key, request_hash, resource_type, resource_id)
          VALUES
            (${randomUUID()}::uuid, ${userId}::uuid, 'create_task', 'legacy-ledger-0001', ${"a".repeat(64)}, 'task', ${legacyId}::uuid)
        `;

        const migration = await readFile(new URL("../drizzle/0025_wild_xavin.sql", import.meta.url), "utf8");
        for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
          await client.unsafe(statement);
        }

        const [column] = await client`
          SELECT data_type FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'mcp_write_idempotency' AND column_name = 'resource_id'
        `;
        assert.equal(column?.data_type, "text");
        const [legacy] = await client`
          SELECT resource_id FROM mcp_write_idempotency WHERE idempotency_key = 'legacy-ledger-0001'
        `;
        assert.equal(legacy?.resource_id, legacyId);

        await client`
          INSERT INTO mcp_write_idempotency
            (id, user_id, tool_name, idempotency_key, request_hash, resource_type, resource_id)
          VALUES
            (${randomUUID()}::uuid, ${userId}::uuid, 'create_universe_node', 'node-ledger-0001', ${"b".repeat(64)}, 'universe_node', 'node-existing')
        `;
        await client`
          INSERT INTO mcp_write_idempotency
            (id, user_id, tool_name, idempotency_key, request_hash, resource_type, resource_id)
          VALUES
            (${randomUUID()}::uuid, ${userId}::uuid, 'create_universe_relation', 'edge-ledger-0001', ${"c".repeat(64)}, 'universe_relation', 'edge-existing')
        `;

        await assert.rejects(
          client`
            INSERT INTO mcp_write_idempotency
              (id, user_id, tool_name, idempotency_key, request_hash, resource_type, resource_id)
            VALUES
              (${randomUUID()}::uuid, ${userId}::uuid, 'unsupported_tool', 'unsupported-tool-0001', ${"d".repeat(64)}, 'task', 'not-a-uuid')
          `,
          (error: unknown) => (error as { code?: string }).code === "23514",
        );
        await assert.rejects(
          client`
            INSERT INTO mcp_write_idempotency
              (id, user_id, tool_name, idempotency_key, request_hash, resource_type, resource_id)
            VALUES
              (${randomUUID()}::uuid, ${userId}::uuid, 'create_task', 'unsupported-resource-0001', ${"e".repeat(64)}, 'unsupported_resource', 'not-a-uuid')
          `,
          (error: unknown) => (error as { code?: string }).code === "23514",
        );
      } finally {
        await client.end();
      }
    } finally {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => undefined);
      await admin.end();
    }
  },
);
