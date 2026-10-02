import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const chatView = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Chat/ChatView.swift",
  "utf8",
);

test("iOS chat does not keep production awake with foreground current-path polling", () => {
  assert.doesNotMatch(chatView, /\.task\(id: foregroundSyncTaskID\)/);
  assert.doesNotMatch(chatView, /observeForegroundConversationChanges/);
  assert.doesNotMatch(chatView, /for:\s*\.seconds\(12\)/);

  assert.match(
    chatView,
    /\.task\(id: appModel\.activeNativeLiveConversationID\)[\s\S]*refreshNativeLiveCurrentPath\(\)/,
  );
  assert.match(
    chatView,
    /\.onChange\(of: scenePhase\)[\s\S]*refreshNativeLiveCurrentPath\(\)/,
  );
  assert.match(
    chatView,
    /onRefresh:[\s\S]*refreshNativeLiveCurrentPath\(force: true\)/,
  );
});


const runtimeStore = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/App/NativeLiveRuntimeStore.swift",
  "utf8",
);
const turnController = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/App/NativeLiveTurnController.swift",
  "utf8",
);
const runtimeModels = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Infrastructure/NativeLiveRuntimeModels.swift",
  "utf8",
);

test("background task observation outlives the foreground turn only while user-visible work remains", () => {
  assert.match(
    runtimeModels,
    /var visibleBackgroundTaskIDs: Set<String>/,
  );
  assert.match(
    runtimeModels,
    /task\["ambient"\]\?\.boolValue != true/,
  );
  assert.match(
    runtimeModels,
    /event\.sequence > activeSetSequence/,
  );
  assert.match(
    runtimeStore,
    /continueNativeLiveRuntimeObservationForBackgroundTasks/,
  );
  assert.match(
    runtimeStore,
    /surface\.foregroundTurnCompleted/,
  );
  assert.match(
    runtimeStore,
    /sawBackgroundDrainCandidate/,
  );
  assert.match(
    runtimeStore,
    /activeNativeLiveConversationID[\s\S]*== conversationID[\s\S]*refreshNativeLiveCurrentPath\([\s\S]*force: true/,
  );
  assert.match(
    turnController,
    /shouldStopRuntimeObservation =[\s\S]*continueNativeLiveRuntimeObservationForBackgroundTasks/,
  );
});
