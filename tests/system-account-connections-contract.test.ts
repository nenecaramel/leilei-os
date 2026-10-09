import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const accountSource = readFileSync(
  new URL("../web/src/pages/SystemAccountPage.tsx", import.meta.url),
  "utf8",
);
const connectionsWrapperSource = readFileSync(
  new URL("../web/src/pages/SystemConnectionsPage.tsx", import.meta.url),
  "utf8",
);
const connectionsContentSource = readFileSync(
  new URL("../web/src/pages/SystemConnectionsPageContent.tsx", import.meta.url),
  "utf8",
);
const connectionsSource =
  connectionsWrapperSource + connectionsContentSource;

test("Account is Auth0-owned and exposes only the approved identity surface", () => {
  assert.match(accountSource, /useAuth0/);
  assert.match(accountSource, /Name/);
  assert.match(accountSource, /Email/);
  assert.match(accountSource, /Signed in with Auth0/);
  assert.match(accountSource, /Sign out/);
  assert.match(accountSource, /window\.location\.origin/);

  assert.doesNotMatch(
    accountSource,
    /preferred_name|accent_color|timezone|password|delete account/i,
  );
  assert.doesNotMatch(
    accountSource,
    /avatar|user-avatar|<img/i,
  );
});

test("Connections reads only the approved safe System endpoint", () => {
  assert.match(connectionsSource, /useWebApiClient/);
  assert.match(connectionsSource, /"\/system\/connections"/);
  assert.match(connectionsSource, /Web API/);
  assert.match(connectionsSource, /ChatGPT \/ Claude MCP/);
  assert.match(connectionsSource, /Internal MCP/);
  assert.match(connectionsSource, /Online/);
  assert.match(connectionsSource, /Available/);
  assert.match(connectionsSource, /Not enabled/);

  assert.doesNotMatch(
    connectionsSource,
    />\\s*(?:Connect|Disconnect)\\s*</i,
  );
  assert.doesNotMatch(
    connectionsSource,
    /\\b(?:token|secret|scope|endpoint)\\b/i,
  );
});
