#!/usr/bin/env node
/**
 * Claude Code Mind PR verification, local Docker PostgreSQL 18 ONLY.
 * Explicitly refuses unauthenticated DB targets and production environments.
 * Does not install a Hook, edit Memory outside the disposable test database,
 * restart Mac daemons, deploy Railway, or merge the PR.
 *
 * Run after creating and attesting an isolated PostgreSQL 18 Docker container:
 *   node scripts/run-claude-mind-local-acceptance.mjs
 * Optional: MIND_BENCH_COUNT=30000 for the larger benchmark (default 10000).
 */
import { spawnSync } from "node:child_process";
import { isolatedPostgresTarget, verifyIsolatedPostgresTarget } from "./isolated-postgres-target.mjs";

if (!process.env.DATABASE_URL || !process.env.ISOLATED_POSTGRES_CONTAINER_ID) {
  throw new Error("REFUSING_NONISOLATED_DATABASE");
}
const target = isolatedPostgresTarget(process.env.DATABASE_URL);
if (!target.containerId) throw new Error("DOCKER_CONTAINER_ATTESTATION_REQUIRED");
await verifyIsolatedPostgresTarget(target);
console.log("MIND_RECALL_TEST_DATABASE_ATTESTED");

const env={
  ...process.env,
  RUN_CLAUDE_CODE_MIND_DATABASE_TEST:"1",
};
const pnpm=process.platform==="win32"?"pnpm.cmd":"pnpm";
function run(title,args){
  console.log("START "+title);
  const result=spawnSync(pnpm,args,{env,stdio:"inherit",shell:false});
  if(result.error)throw result.error;
  if(result.status!==0){
    console.error("FAILED "+title);
    process.exit(result.status??1);
  }
  console.log("PASS "+title);
}
run("TYPECHECK",["typecheck"]);
run("ISOLATED_DB_MIGRATION",["db:migrate"]);
run("MIGRATION_JOURNAL_CHECK",["db:check"]);
run("CLAUDE_RECALL_UNIT_AND_DB",[
  "exec","tsx","--test","--test-concurrency=1",
  "tests/claude-code-mind-candidates.integration.test.ts",
  "tests/mind-indexed-recall.test.ts",
  "tests/claude-code-mind-hooks.test.ts",
  "tests/claude-code-mind-hybrid-server.test.ts",
  "tests/runtime-local-hybrid-mind-recall.test.ts",
  "tests/claude-code-mind-dedupe.test.ts",
  "tests/claude-code-mind-finalized.test.ts",
  "tests/mind-hybrid-candidates.test.ts",
]);
run("ISOLATED_SQL_VS_16OCT_BENCH",[
  "exec","tsx","scripts/bench-claude-mind-candidates.ts",
]);
console.log("MIND_RECALL_LOCAL_ACCEPTANCE_PASS");
