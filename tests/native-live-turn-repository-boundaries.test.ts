import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = "src/domains/bridge/turn/turn-repository/";

test("turn repository has explicit operation boundaries behind the existing entrypoint", () => {
  for (const [file, symbol] of [
    ["prepare", "prepareSend"], ["reads", "readTurn"],
    ["finalize-success", "finalizeSuccess"], ["finalize-failure", "finalizeFailure"],
    ["cleanup", "purgeReplacementArtifacts"],
  ]) {
    const path = `${root}${file}.ts`;
    assert.ok(fs.existsSync(path), `missing ${path}`);
    assert.match(fs.readFileSync(path, "utf8"), new RegExp(`export async function ${symbol}\\(`));
  }
  const repository = fs.readFileSync(`${root}repository.ts`, "utf8");
  assert.match(repository, /export class DrizzleNativeLiveBackendTurnPort/);
  assert.doesNotMatch(repository, /\.transaction\(|isolationLevel|\.update\(/);
  assert.doesNotMatch(fs.readFileSync("src/domains/bridge/turn/native-live-backend-turn-repository.ts", "utf8"), /export class|\.transaction\(/);
});

test("turn transaction owners keep serializable prepare and terminal commit boundaries", () => {
  for (const file of ["prepare", "finalize-success", "finalize-failure"]) {
    const path = `${root}${file}.ts`;
    assert.ok(fs.existsSync(path), `missing ${path}`);
    const source = fs.readFileSync(path, "utf8");
    assert.match(source, /this\.db\.transaction\(/);
    assert.match(source, /isolationLevel: "serializable"/);
  }
  assert.match(fs.readFileSync(`${root}prepare.ts`, "utf8"), /async function prepareWithRaceRecovery/);
  assert.match(fs.readFileSync(`${root}finalize-success.ts`, "utf8"), /persistFinalizedContextLineage/);
});
