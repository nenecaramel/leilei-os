import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

test("actual Swift runtime refresh publishes events before slow secondary reads and preserves concurrent state", { skip: process.platform !== "darwin" }, () => {
  const source = readFileSync("ios/LeileiOS/LeileiOS/App/NativeLiveRuntimeStore.swift", "utf8");
  function method(name: string) {
    const start = source.indexOf(`    private func ${name}(`);
    assert.ok(start >= 0);
    const open = source.indexOf("{", start);
    let depth = 1, end = open + 1;
    for (; depth; end++) { if (source[end] === "{") depth++; if (source[end] === "}") depth--; }
    return source.slice(start, end);
  }
  const folder = mkdtempSync(join(tmpdir(), "ios-runtime-delivery-"));
  try {
    writeFileSync(join(folder, "main.swift"), `
import Foundation
struct Event: Equatable { let sequence: Int }
struct NativeLiveRuntimeControlSnapshot: Equatable { var controlID = UUID(); let label: String }
typealias NativeLiveJSONValue = String
enum NativeLiveRuntimeControlClientError: Error { case notReady }
enum LeileiAPIError: Error { case missingAccessToken, unauthorized }
struct Page { let prepareID: String; let events: [Event]; let nextAfterSequence: Int }
struct Surface {
 let prepareID: String; let conversationID: UUID
 var events: [Event] = []; var interactions: [String] = []; var controls: [NativeLiveRuntimeControlSnapshot] = []; var nextAfterSequence = 0
}
@MainActor final class API {
 var interactionStarted = false, controlsStarted = false, createStarted = false
 var createdID: UUID?
 var interactionGate: CheckedContinuation<Void, Never>?, controlsGate: CheckedContinuation<Void, Never>?, createGate: CheckedContinuation<Void, Never>?
 func nativeLiveRuntimeEvents(prepareID: String, afterSequence: Int) async throws -> Page {
   Page(prepareID: prepareID, events: [Event(sequence: 1)], nextAfterSequence: 1)
 }
 func nativeLiveRuntimeInteractions(prepareID: String) async throws -> [String] {
   interactionStarted = true; await withCheckedContinuation { interactionGate = $0 }; return ["interaction"]
 }
 func nativeLiveRuntimeControls(prepareID: String) async throws -> [NativeLiveRuntimeControlSnapshot] {
   controlsStarted = true; await withCheckedContinuation { controlsGate = $0 }; return [.init(label: "stale-control")]
 }
 func createNativeLiveRuntimeControl(prepareID: String, controlID: UUID, kind: String, payload: [String: NativeLiveJSONValue]) async throws -> NativeLiveRuntimeControlSnapshot {
   createdID = controlID; createStarted = true; await withCheckedContinuation { createGate = $0 }; return .init(controlID: controlID, label: "created")
 }
}
@MainActor final class AppModel {
 let api = API()
 var nativeLiveRuntimeSurface: Surface?
 var nativeLiveBackgroundRuntimeSurfaces: [String: Surface] = [:]
 func clearNativeLiveSessionData() { nativeLiveRuntimeSurface = nil }
 ${method("createNativeLiveRuntimeControl")}
 ${method("refreshNativeLiveRuntimeSurface")}
 ${method("refreshNativeLiveBackgroundRuntimeSurface")}
 func check() async {
   let cid = UUID()
   nativeLiveRuntimeSurface = Surface(prepareID: "first", conversationID: cid)
   let foreground = Task { await self.refreshNativeLiveRuntimeSurface(prepareID: "first", conversationID: cid, includeInteractions: true) }
   while !api.interactionStarted { await Task.yield() }
   precondition(nativeLiveRuntimeSurface?.events.count == 1, "events must publish before slow interactions")
   api.interactionGate?.resume(); api.interactionGate = nil
   while !api.controlsStarted { await Task.yield() }
   precondition(nativeLiveRuntimeSurface?.interactions == ["interaction"], "interactions must publish before slow controls")
   nativeLiveRuntimeSurface?.controls = [.init(label: "new-control")]
   api.controlsGate?.resume(); api.controlsGate = nil
   await foreground.value
   precondition(nativeLiveRuntimeSurface?.controls.map(\\.label) == ["new-control"], "slow read cannot overwrite concurrent control change")

   api.interactionStarted = false
   nativeLiveBackgroundRuntimeSurfaces["background"] = Surface(prepareID: "background", conversationID: cid)
   let background = Task { await self.refreshNativeLiveBackgroundRuntimeSurface(prepareID: "background", conversationID: cid, includeInteractions: true) }
   while !api.interactionStarted { await Task.yield() }
   precondition(nativeLiveBackgroundRuntimeSurfaces["background"]?.events.count == 1, "background events must publish before slow interactions")
   nativeLiveBackgroundRuntimeSurfaces.removeValue(forKey: "background")
   api.interactionGate?.resume(); api.interactionGate = nil
   _ = await background.value
   precondition(nativeLiveBackgroundRuntimeSurfaces["background"] == nil, "retired observation must not be resurrected")

   api.interactionStarted = false
   nativeLiveRuntimeSurface = Surface(prepareID: "first", conversationID: cid)
   let stale = Task { await self.refreshNativeLiveRuntimeSurface(prepareID: "first", conversationID: cid, includeInteractions: true) }
   while !api.interactionStarted { await Task.yield() }
   nativeLiveRuntimeSurface = Surface(prepareID: "second", conversationID: cid)
   api.interactionGate?.resume(); api.interactionGate = nil
   await stale.value
   precondition(nativeLiveRuntimeSurface?.prepareID == "second" && nativeLiveRuntimeSurface?.events.isEmpty == true)
   let control = Task { try! await self.createNativeLiveRuntimeControl(kind: "interrupt", payload: [:]) }
   while !api.createStarted { await Task.yield() }
   nativeLiveRuntimeSurface?.controls = [.init(controlID: api.createdID!, label: "applied")]
   nativeLiveRuntimeSurface?.events = [Event(sequence: 5)]
   nativeLiveRuntimeSurface?.nextAfterSequence = 5
   api.createGate?.resume(); api.createGate = nil
   _ = await control.value
   precondition(nativeLiveRuntimeSurface?.events == [Event(sequence: 5)] && nativeLiveRuntimeSurface?.nextAfterSequence == 5, "control response must not roll back streamed events")
   precondition(nativeLiveRuntimeSurface?.controls.map(\\.label) == ["applied"], "late create response cannot regress an already applied same-ID control")
   print("Runtime delivery PASS")
 }
}
@main struct Run { static func main() async { await AppModel().check() } }
`);
    execFileSync("swiftc", ["-parse-as-library", "-swift-version", "6", join(folder, "main.swift"), "-o", join(folder, "run")], { timeout: 60_000, stdio: "pipe" });
    assert.match(execFileSync(join(folder, "run"), { timeout: 15_000, encoding: "utf8", stdio: "pipe" }), /Runtime delivery PASS/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
