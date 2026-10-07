import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";

test("Deployment 1 deletes thoughts, updates feelings in place, and preserves every other column and CHECK", {skip: process.env.RUN_MIND_MEMORY_MIGRATION_TEST !== "1"}, async () => {
  const sql = postgres(process.env.DATABASE_URL!, {max: 1});
  try {
    await sql.begin(async tx => {
      await tx`CREATE TEMP TABLE runtime_subject_states (LIKE public.runtime_subject_states INCLUDING ALL)`;
      await tx`ALTER TABLE runtime_subject_states DROP CONSTRAINT runtime_subject_states_kind_allowed`;
      await tx`ALTER TABLE runtime_subject_states ADD CONSTRAINT runtime_subject_states_kind_allowed CHECK (kind IN ('feel', 'memory', 'thought'))`;
      for (const [index, kind] of ["thought", "thought", "feel", "feel", "memory"].entries()) {
        await tx`INSERT INTO runtime_subject_states (id, user_id, subject_id, kind, text, payload, scope_applicability, settlement_status, path_status, validity_status, envelope, created_at, updated_at)
          VALUES (${`00000000-0000-4000-8000-00000000000${index}`}::uuid, '11111111-1111-4111-8111-111111111111', 'G', ${kind}, 'Reunion felt reassuring', ${tx.json({references:["relationship"],embedding:[0.1,0.2],lifecycle_v1:{salience:0.42},manual_v1:{occurredAt:"2020-01-01T00:00:00Z"}})}, 'global', ${index === 3 ? "unsettled" : "settled"}, ${index === 3 ? "superseded" : "current"}, 'valid', ${tx.json({source:{messageId:"original"},provenance:{origin:"manual"},settled_at:"2021-01-01"})}, '2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z')`;
      }
      const before = await tx`SELECT id, to_jsonb(s) AS record FROM runtime_subject_states s ORDER BY id`;
      const constraint = await tx`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='pg_temp.runtime_subject_states'::regclass AND conname='runtime_subject_states_kind_allowed'`;
      const path = new URL("../drizzle/0101_simplify_mind_memory.sql", import.meta.url);
      await tx.unsafe(existsSync(path) ? readFileSync(path,"utf8") : "SELECT 1");
      const after = await tx`SELECT id, to_jsonb(s) AS record FROM runtime_subject_states s ORDER BY id`;
      assert.equal(after.length, 3);
      assert.deepEqual(after.map(row => row.record), before.filter(row => row.record.kind !== "thought").map(row => ({...row.record, kind:"memory"})));
      const remainingConstraint = await tx`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='pg_temp.runtime_subject_states'::regclass AND conname='runtime_subject_states_kind_allowed'`;
      assert.deepEqual(remainingConstraint, constraint);
      assert.match(constraint[0]!.definition, /feel/);
      assert.match(constraint[0]!.definition, /thought/);
    });
  } finally {await sql.end();}
});

test("migration preserves real feeling relationships and cascades retired thought transitions", {skip:process.env.RUN_MIND_MEMORY_MIGRATION_TEST !== "1"}, async () => {
  const url = process.env.DATABASE_URL!;
  assert.ok(["127.0.0.1","localhost"].includes(new URL(url).hostname), "Use only an isolated local database");
  const sql = postgres(url, {max:1});
  const rollback = new Error("rollback migration fixture");
  try {
    await sql.begin(async tx => {
      await tx`ALTER TABLE runtime_subject_states DROP CONSTRAINT runtime_subject_states_kind_allowed`;
      await tx`ALTER TABLE runtime_subject_states ADD CONSTRAINT runtime_subject_states_kind_allowed CHECK (kind IN ('feel', 'memory', 'thought'))`;
      const [user] = await tx`INSERT INTO users (email, display_name) VALUES (${`mind-migration-${crypto.randomUUID()}@example.com`}, 'Migration fixture') RETURNING id`;
      const ids = {feel:crypto.randomUUID(), thought:crypto.randomUUID()};
      for (const kind of ["feel","thought"] as const) {
        await tx`INSERT INTO runtime_subject_states (id,user_id,subject_id,kind,text,payload,scope_applicability,settlement_status,path_status,validity_status,envelope)
          VALUES (${ids[kind]},${user!.id},'G',${kind},'Felt reassured', '{"embedding":[0.1],"references":["relationship"]}', 'global','settled','current','valid','{}')`;
        await tx`INSERT INTO runtime_subject_state_transitions (user_id,subject_id,state_id,reason,before_envelope,after_envelope) VALUES (${user!.id},'G',${ids[kind]},'legacy_fixture','{"source":"original"}','{"settled_at":"original"}')`;
      }
      const [before] = await tx`SELECT to_jsonb(t) AS record FROM runtime_subject_state_transitions t WHERE state_id=${ids.feel}`;
      await tx.unsafe(readFileSync(new URL("../drizzle/0101_simplify_mind_memory.sql", import.meta.url),"utf8"));
      const [after] = await tx`SELECT to_jsonb(t) AS record FROM runtime_subject_state_transitions t WHERE state_id=${ids.feel}`;
      assert.deepEqual(after,before);
      assert.equal((await tx`SELECT id FROM runtime_subject_state_transitions WHERE state_id=${ids.thought}`).length,0);
      assert.equal((await tx`SELECT kind FROM runtime_subject_states WHERE id=${ids.feel}`)[0]!.kind,"memory");
      throw rollback;
    }).catch(error => {if(error !== rollback) throw error;});
  } finally {await sql.end();}
});


test("Deployment 2 preserves memory rows and installs a validated memory-only CHECK", {skip:process.env.RUN_MIND_MEMORY_MIGRATION_TEST !== "1"}, async () => {
  const url = process.env.DATABASE_URL!;
  assert.ok(["127.0.0.1","localhost"].includes(new URL(url).hostname), "Use only an isolated local database");
  const sql = postgres(url, {max:1});
  try {
    await sql.begin(async tx => {
      await tx`CREATE TEMP TABLE runtime_subject_states (LIKE public.runtime_subject_states INCLUDING ALL)`;
      await tx`ALTER TABLE runtime_subject_states DROP CONSTRAINT runtime_subject_states_kind_allowed`;
      await tx`ALTER TABLE runtime_subject_states ADD CONSTRAINT runtime_subject_states_kind_allowed CHECK (kind IN ('feel', 'memory', 'thought'))`;
      await tx`INSERT INTO runtime_subject_states (id,user_id,subject_id,kind,text,scope_applicability,settlement_status,path_status,validity_status,envelope)
        VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','G','memory','Deployment 2 memory','global','settled','current','valid','{}')`;
      const [before] = await tx`SELECT to_jsonb(s) AS record FROM runtime_subject_states s`;
      await tx.unsafe(readFileSync(new URL("../drizzle/0102_tighten_mind_memory_check.sql", import.meta.url),"utf8"));
      const [after] = await tx`SELECT to_jsonb(s) AS record FROM runtime_subject_states s`;
      assert.deepEqual(after,before);
      const [constraint] = await tx`SELECT pg_get_constraintdef(oid) AS definition, convalidated FROM pg_constraint WHERE conrelid='pg_temp.runtime_subject_states'::regclass AND conname='runtime_subject_states_kind_allowed'`;
      assert.equal(constraint!.convalidated, true);
      assert.match(constraint!.definition, /kind.*memory/i);
      assert.doesNotMatch(constraint!.definition, /feel|thought/i);
    });
  } finally {await sql.end();}
});

test("Deployment 2 aborts instead of rewriting residual legacy rows", {skip:process.env.RUN_MIND_MEMORY_MIGRATION_TEST !== "1"}, async () => {
  const url = process.env.DATABASE_URL!;
  assert.ok(["127.0.0.1","localhost"].includes(new URL(url).hostname), "Use only an isolated local database");
  const sql = postgres(url, {max:1});
  try {
    await assert.rejects(
      sql.begin(async tx => {
        await tx`CREATE TEMP TABLE runtime_subject_states (LIKE public.runtime_subject_states INCLUDING ALL)`;
        await tx`ALTER TABLE runtime_subject_states DROP CONSTRAINT runtime_subject_states_kind_allowed`;
        await tx`ALTER TABLE runtime_subject_states ADD CONSTRAINT runtime_subject_states_kind_allowed CHECK (kind IN ('feel', 'memory', 'thought'))`;
        await tx`INSERT INTO runtime_subject_states (id,user_id,subject_id,kind,text,scope_applicability,settlement_status,path_status,validity_status,envelope)
          VALUES ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','G','feel','Legacy residue','global','settled','current','valid','{}')`;
        await tx.unsafe(readFileSync(new URL("../drizzle/0102_tighten_mind_memory_check.sql", import.meta.url),"utf8"));
      }),
      /Cannot tighten runtime_subject_states\.kind to memory only/,
    );
  } finally {await sql.end();}
});
