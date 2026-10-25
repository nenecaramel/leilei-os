import test from "node:test";
import assert from "node:assert/strict";
import { bearerTokenMatches } from "../src/auth/internal-auth.js";

test("bearer token matching requires the exact scheme and token", () => {
  assert.equal(bearerTokenMatches("Bearer secret-token", "secret-token"), true);
  for (const header of [
    undefined,
    "",
    "Bearer ",
    "bearer secret-token",
    "Basic secret-token",
    "Bearer secret-tokem",
    "Bearer secret-token ",
    "Bearer secret",
  ]) {
    assert.equal(bearerTokenMatches(header, "secret-token"), false, String(header));
  }
});
