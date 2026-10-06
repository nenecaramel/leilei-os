import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = "ios/LeileiOS/LeileiOS/Infrastructure/";
const surfaces = [
  ["NativeLive", "NativeLiveConversationSummary", "nativeLiveConversationPage"],
  ["Mind", "MindProductItem", "mindPage"],
  ["System", "SystemConnectionsSnapshot", "systemConnections"],
  ["Import", "ImportPreviewSnapshot", "previewImport"],
] as const;

for (const [surface, model, method] of surfaces) {
  test(`iOS ${surface} API contracts have a local feature boundary`, () => {
    const models = `${root}API/${surface}/${surface}Models.swift`;
    const api = `${root}API/${surface}/${surface}API.swift`;
    assert.ok(fs.existsSync(models), `missing ${models}`);
    assert.ok(fs.existsSync(api), `missing ${api}`);
    assert.match(fs.readFileSync(models, "utf8"), new RegExp(`(?:struct|enum) ${model}\\b`));
    assert.match(fs.readFileSync(api, "utf8"), /extension LeileiAPIClient/);
    assert.match(fs.readFileSync(api, "utf8"), new RegExp(`func ${method}\\b`));
    const transport = fs.readFileSync(`${root}LeileiAPIClient.swift`, "utf8");
    assert.doesNotMatch(transport, new RegExp(`(?:struct|enum) ${model}\\b|func ${method}\\b`));
  });
}

test("shared iOS transport retains authentication, errors and injected URLSession", () => {
  const transport = fs.readFileSync(`${root}LeileiAPIClient.swift`, "utf8");
  assert.match(transport, /final class LeileiAPIClient/);
  assert.match(transport, /enum LeileiAPIError/);
  assert.match(transport, /session: URLSession = \.shared/);
  assert.match(transport, /authSession\.accessToken\(\)/);
  assert.match(transport, /case 401:/);
  assert.match(transport, /case 403:/);
  assert.match(transport, /func request<Response: Decodable>/);
});
