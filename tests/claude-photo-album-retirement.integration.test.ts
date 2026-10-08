import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const enabled = process.env.RUN_ALBUM_RETIREMENT_DATABASE_TEST === "1";
const root = resolve(new URL("..", import.meta.url).pathname);
const migrationsFolder = resolve(root, "drizzle");
const journal = JSON.parse(readFileSync(resolve(migrationsFolder, "meta/_journal.json"), "utf8"));
const head = journal.entries.at(-1);
const previous = journal.entries.at(-2);

async function withDatabase(run: (sql: ReturnType<typeof postgres>, url: string) => Promise<void>) {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "local Postgres only");
  assert.match(url.pathname, /test|regression|ephemeral/);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.notEqual(process.env.RAILWAY_ENVIRONMENT_NAME, "production");
  const admin = postgres(url.toString(), { max: 1 });
  const name = `album_retirement_test_${randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 1 });
  try { await run(sql, url.toString()); }
  finally {
    await sql.end();
    await admin.unsafe(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}

function officialRunner(url: string) {
  const env = { ...process.env, DATABASE_URL: url };
  delete env.RAILWAY_ENVIRONMENT_ID;
  execFileSync(process.execPath, ["--import", "tsx", "src/database/migrate.ts"], {
    cwd: root, env, stdio: "pipe", timeout: 60_000,
  });
}

async function assertRetired(sql: ReturnType<typeof postgres>) {
  const [row] = await sql`select to_regclass('public.claude_album_photos') as album`;
  assert.equal(row.album, null);
  const artifacts = await sql`select count(*)::int as count from pg_class
    where relnamespace = 'public'::regnamespace and relname like 'claude_album_photos%'`;
  assert.equal(artifacts[0].count, 0, "dedicated indexes are removed with the table");
}

async function snapshot(sql: ReturnType<typeof postgres>) {
  const tables = await sql`select tablename from pg_tables where schemaname = 'public'
    and tablename not in ('claude_album_photos', 'leilei_schema_migrations') order by tablename`;
  const result: Record<string, unknown> = {};
  for (const { tablename } of tables) {
    const rows = await sql.unsafe(`select to_jsonb(t)::text as row from public."${tablename}" t order by to_jsonb(t)::text`);
    result[tablename] = rows.map(row => row.row);
  }
  return result;
}

test("album retirement fresh DB discovers one 0104 then 0105 and bootstraps the official ledger", { skip: !enabled }, async () => {
  assert.equal(previous.tag, "0104_claude_code_recall_receipts");
  assert.equal(head.tag, "0105_retire_claude_photo_album");
  assert.ok(head.when > previous.when);
  assert.equal(journal.entries.filter((entry: { tag: string }) => entry.tag.startsWith("0104_")).length, 1);
  await withDatabase(async (sql, url) => {
    await migrate(drizzle(sql), { migrationsFolder });
    await assertRetired(sql);
    const before = await snapshot(sql);
    officialRunner(url);
    officialRunner(url);
    assert.deepEqual(await snapshot(sql), before);
    const rows = await sql`select created_at::text as created_at from public.leilei_schema_migrations`;
    assert.deepEqual(rows.map(row => row.created_at), [String(head.when)]);
  });
});

test("album retirement upgrades populated 0104 through the official runner without changing any other row", { skip: !enabled }, async () => {
  const folder = mkdtempSync(resolve(tmpdir(), "album-retirement-migrations-"));
  try {
    cpSync(migrationsFolder, folder, { recursive: true });
    writeFileSync(resolve(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) }));
    await withDatabase(async (sql, url) => {
      await migrate(drizzle(sql), { migrationsFolder: folder });
      const user = randomUUID(), attachment = randomUUID(), message = randomUUID();
      const source = randomUUID(), imported = randomUUID(), conversation = randomUUID();
      await sql`insert into users(id,email,display_name) values (${user}, 'album-retirement@example.test', 'retirement fixture')`;
      await sql`insert into conversation_import_sources
        (id,user_id,provider,original_filename,raw_sha256,raw_bytes)
        values (${source},${user},'claude','fixture.json',${"c".repeat(64)},1)`;
      await sql`insert into conversation_import_runs(id,user_id,source_id,parser_version)
        values (${imported},${user},${source},'retirement-test')`;
      await sql`insert into conversations
        (id,user_id,provider,source_conversation_id,source_fingerprint,first_seen_import_id,last_seen_import_id)
        values (${conversation},${user},'claude','retirement-test',${"d".repeat(64)},${imported},${imported})`;
      await sql`insert into conversation_messages
        (id,user_id,conversation_id,source_node_id,role,display_text,source_fingerprint,first_seen_import_id,last_seen_import_id)
        values (${message},${user},${conversation},'retirement-test','user','preserve source message',${"e".repeat(64)},${imported},${imported})`;
      await sql`insert into native_live_chat_attachments
        (id,user_id,object_key,filename,mime_type,size_bytes,sha256,kind,expires_at,content)
        values (${attachment},${user},'retirement-test/shared-attachment','source.jpg','image/jpeg',1,${"a".repeat(64)},'image',now()+interval '1 day',decode('ff','hex'))`;
      await sql`insert into claude_code_recall_receipts
        (id,user_id,subject_id,conversation_id,context_epoch,state_ids,context_sha256,recalled_at,expires_at)
        values (${randomUUID()},${user},'fixture','claude-code:retirement',0,ARRAY[${randomUUID()}::uuid],${"b".repeat(64)},now(),now()+interval '24 hours')`;
      for (let index = 0; index < 9; index++) {
        await sql`insert into claude_album_photos
          (id,user_id,object_key,filename,mime_type,size_bytes,sha256,why_saved,source_attachment_id,source_message_id,trigger_user_message_id)
          values (${randomUUID()},${user},${`claude-album/test/${index}`},${`fixture-${index}.jpg`},'image/jpeg',1,${"a".repeat(64)},'test fixture',${index === 0 ? attachment : randomUUID()},${message},${message})`;
      }
      assert.equal((await sql`select count(*)::int as count from claude_album_photos`)[0].count, 9);
      await assert.rejects(() => assertRetired(sql), assert.AssertionError, "pre-retirement witness must reject the 0104 schema");
      const before = await snapshot(sql);
      officialRunner(url);
      await assertRetired(sql);
      assert.deepEqual(await snapshot(sql), before, "every non-album table and row stays identical");
      const rows = await sql`select created_at::text as created_at from public.leilei_schema_migrations order by created_at`;
      assert.deepEqual(rows.map(row => row.created_at), [String(previous.when), String(head.when)]);
      officialRunner(url);
      assert.deepEqual(await snapshot(sql), before);
      assert.equal((await sql`select count(*)::int as count from public.leilei_schema_migrations`)[0].count, 2);
    });
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
