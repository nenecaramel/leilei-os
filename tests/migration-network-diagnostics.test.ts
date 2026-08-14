import assert from "node:assert/strict";
import test from "node:test";
import { collectMigrationNetworkDiagnostics } from "../src/database/migration-network-diagnostics.js";

test("collects safe Railway migration network diagnostics without exposing endpoint values", async () => {
  const observedHosts: string[] = [];
  const diagnostics = await collectMigrationNetworkDiagnostics(
    "postgresql://user:password@roundhouse.proxy.rlwy.net:5432/app",
    "environment-id",
    "postgresql://user:password@postgres.railway.internal:5432/app",
    {
      lookup: async () => [{ family: 4 }, { family: 6 }],
      probeTcp: async (hostname, port) => {
        observedHosts.push(`${hostname}:${port}`);
        return { ok: true };
      },
    },
  );

  assert.deepEqual(diagnostics, {
    hostClass: "RAILWAY_PROXY",
    portSet: true,
    environmentIdSet: true,
    rewriteApplied: true,
    privateDns: "PASS",
    privateDnsFamilies: "BOTH",
    privateDnsErrorCode: "",
    privateTcp: "PASS",
    privateTcpErrorCode: "",
    originalTcp: "PASS",
    originalTcpErrorCode: "",
  });
  assert.deepEqual(observedHosts, [
    "postgres.railway.internal:5432",
    "roundhouse.proxy.rlwy.net:5432",
  ]);
});

test("records bounded failure codes and safe classifications for unavailable paths", async () => {
  const diagnostics = await collectMigrationNetworkDiagnostics(
    "postgresql://user:password@db.example.invalid/app",
    undefined,
    "postgresql://user:password@db.example.invalid/app",
    {
      lookup: async () => {
        const error = new Error("private DNS details must not escape");
        Object.assign(error, { code: "ENOTFOUND" });
        throw error;
      },
      probeTcp: async (hostname) => ({
        ok: false,
        errorCode: hostname === "postgres.railway.internal" ? "ENOTFOUND" : "ETIMEDOUT",
      }),
    },
  );

  assert.equal(diagnostics.hostClass, "OTHER");
  assert.equal(diagnostics.portSet, false);
  assert.equal(diagnostics.environmentIdSet, false);
  assert.equal(diagnostics.rewriteApplied, false);
  assert.equal(diagnostics.privateDns, "FAIL");
  assert.equal(diagnostics.privateDnsFamilies, "NONE");
  assert.equal(diagnostics.privateDnsErrorCode, "ENOTFOUND");
  assert.equal(diagnostics.privateTcp, "FAIL");
  assert.equal(diagnostics.privateTcpErrorCode, "ENOTFOUND");
  assert.equal(diagnostics.originalTcp, "FAIL");
  assert.equal(diagnostics.originalTcpErrorCode, "ETIMEDOUT");
});
