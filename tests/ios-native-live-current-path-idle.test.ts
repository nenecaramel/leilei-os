import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const chatView = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Chat/ChatView.swift",
  "utf8",
) + fs.readFileSync("ios/LeileiOS/LeileiOS/Chat/ChatView+RuntimeControl.swift", "utf8")
  + fs.readFileSync("ios/LeileiOS/LeileiOS/Chat/ChatView+ConversationLifecycle.swift", "utf8");

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
    runtimeModels,
    /hasPendingRuntimeInteraction/,
  );
  assert.match(
    runtimeModels,
    /shouldRemainObservedAfterForeground/,
  );
  assert.match(
    runtimeStore,
    /continueNativeLiveRuntimeObservationForBackgroundTasks/,
  );
  assert.match(
    runtimeStore,
    /beginNativeLiveBackgroundObservation/,
  );
  assert.match(
    runtimeStore,
    /nativeLiveBackgroundRuntimeSurfaces/,
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


test("foreground completion unlocks the composer even while background observation stays alive", () => {
  assert.match(
    chatView,
    /if visibleRuntimeSurface\?\.foregroundTurnCompleted == true[\s\S]*return false/,
  );
});


test("archive and delete can stop all runtime observers for one conversation", () => {
  const conversationCoordination = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/App/ConversationCoordination.swift",
    "utf8",
  );

  assert.match(
    runtimeStore,
    /func stopNativeLiveRuntimeObservations\([\s\S]*conversationID: UUID/,
  );
  assert.match(
    conversationCoordination,
    /archiveNativeLiveConversation[\s\S]*stopNativeLiveRuntimeObservations/,
  );
  assert.match(
    conversationCoordination,
    /deleteNativeLiveConversation[\s\S]*stopNativeLiveRuntimeObservations/,
  );
});


test("completed detached background activity cache is bounded while active watchers are preserved", () => {
  assert.match(
    runtimeStore,
    /pruneNativeLiveBackgroundRuntimeSurfaces/,
  );
  assert.match(
    runtimeStore,
    /maxCompletedCount: Int = 8/,
  );
  assert.match(
    runtimeStore,
    /activePrepareIDs[\s\S]*nativeLiveBackgroundObservationTasks\.keys/,
  );
});


test("iOS observes proactive head changes through bounded long-poll instead of periodic current-path polling", () => {
  const conversationCoordination = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/App/ConversationCoordination.swift",
    "utf8",
  );
  const nativeLiveAPI = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveAPI.swift",
    "utf8",
  );

  assert.match(
    conversationCoordination,
    /beginNativeLiveConversationHeadObservation/,
  );
  assert.match(
    conversationCoordination,
    /waitNativeLiveConversationHead/,
  );
  assert.match(
    conversationCoordination,
    /result\.outcome == "changed"[\s\S]*refreshNativeLiveCurrentPath/,
  );
  assert.doesNotMatch(
    conversationCoordination,
    /while[\s\S]{0,400}Task\.sleep\([\s\S]{0,200}refreshNativeLiveCurrentPath/,
  );
  assert.match(
    nativeLiveAPI,
    /\/head\/wait/,
  );
  assert.match(
    chatView,
    /\.task\(id: appModel\.activeNativeLiveConversationID\)[\s\S]*beginNativeLiveConversationHeadObservation/,
  );
  assert.match(
    chatView,
    /phase != \.active[\s\S]*stopNativeLiveConversationHeadObservation/,
  );
  assert.match(
    chatView,
    /phase == \.active[\s\S]*beginNativeLiveConversationHeadObservation/,
  );
});
