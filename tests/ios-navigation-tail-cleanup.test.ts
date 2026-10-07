import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const navigationRoot = "ios/LeileiOS/LeileiOS/Navigation/";
const pagesRoot = "ios/LeileiOS/LeileiOS/Pages/";

test("iOS main navigation exposes only reachable product pages", () => {
  const appPage = readFileSync(
    navigationRoot + "AppPage.swift",
    "utf8",
  );
  const cases = [
    ...appPage.matchAll(/^\s*case\s+(\w+)/gm),
  ].map((match) => match[1]);

  assert.deepEqual(cases, [
    "chat",
    "diary",
    "daySpace",
    "conversations",
    "mind",
    "universe",
    "globalSearch",
  ]);

  const sidebar = readFileSync(
    navigationRoot + "SidebarView.swift",
    "utf8",
  );
  assert.match(sidebar, /let onSettings: \(\) -> Void/);
  assert.doesNotMatch(sidebar, /\.account\b/);

  const container = readFileSync(
    navigationRoot + "PageContainer.swift",
    "utf8",
  );
  assert.match(container, /switch selectedPage/);
  assert.doesNotMatch(container, /PlaceholderPage/);

  assert.equal(
    existsSync(pagesRoot + "ConnectionsPage.swift"),
    false,
  );
  assert.equal(
    existsSync(pagesRoot + "PlaceholderPage.swift"),
    false,
  );
});

test("Conversations keeps the reachable View all page but splits support surfaces", () => {
  const sidebar = readFileSync(
    navigationRoot + "SidebarView.swift",
    "utf8",
  );
  assert.match(
    sidebar,
    /selectedPage = \.conversations/,
  );

  const conversations = readFileSync(
    pagesRoot + "ConversationsView.swift",
    "utf8",
  );
  assert.ok(
    conversations.split("\n").length <= 350,
    "ConversationsView should stay a coordinator-sized surface",
  );
  assert.doesNotMatch(
    conversations,
    /struct ConversationCreateSheet/,
  );
  assert.doesNotMatch(
    conversations,
    /struct ClaudeSessionForkSheet/,
  );

  assert.equal(
    existsSync(
      pagesRoot
        + "Conversations/ConversationList.swift",
    ),
    true,
  );
  assert.equal(
    existsSync(
      pagesRoot
        + "Conversations/ClaudeSessionForkSheet.swift",
    ),
    true,
  );

  const pageContainer = readFileSync(
    navigationRoot + "PageContainer.swift",
    "utf8",
  );
  assert.match(
    pageContainer,
    /case \.conversations:[\s\S]*ConversationsView\(/,
  );
  assert.match(
    pageContainer,
    /ClaudeSessionForkSheet/,
  );
});
