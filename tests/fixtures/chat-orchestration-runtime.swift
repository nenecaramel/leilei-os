import Foundation

// Only the UI storage and external AppModel calls are substituted. The complete
// production extension and runtime evidence models compile unchanged below.
@propertyWrapper struct Cell<Value> {
    final class Storage { var value: Value; init(_ value: Value) { self.value = value } }
    let storage: Storage
    init(wrappedValue: Value) { storage = Storage(wrappedValue) }
    var wrappedValue: Value { get { storage.value } nonmutating set { storage.value = newValue } }
}
@MainActor final class AppModel {
    var nativeLiveRuntimeSurface: NativeLiveRuntimeSurfaceState?
    var activeNativeLiveConversationID: UUID?
    var interrupts = 0, sends = 0
    var throwDelivery = false
    func sendNativeLiveMidTurnInput(_ text: String) async throws -> String {
        sends += 1; await Task.yield()
        if throwDelivery { throw NSError(domain: "ambiguous", code: 1) }
        return "exact-control"
    }
    func interruptNativeLiveTurn() async throws { interrupts += 1; await Task.yield() }
}
@MainActor struct ChatView {
    let appModel: AppModel
    @Cell var messageText = ""
    @Cell var pendingMidTurnDelivery: NativeLivePendingMidTurnDelivery?
    @Cell var isRuntimeControlInFlight = false
    @Cell var isComposerFocused = false
}
@main struct RuntimeChecks {
    @MainActor static func main() async {
        let id = UUID(), other = UUID(), app = AppModel()
        app.activeNativeLiveConversationID = id
        let view = ChatView(appModel: app)
        func surface() -> NativeLiveRuntimeSurfaceState { .init(prepareID: "prepare", conversationID: id, events: [], interactions: [], controls: [], nextAfterSequence: 0) }
        func event(_ kind: String, _ uuid: String, _ state: String = "") -> NativeLiveRuntimeEventSnapshot {
            .init(sequence: 1, event: .init(type: "runtime", providerSessionID: nil, payload: ["kind": .string(kind), "command_uuid": .string(uuid), "user_message_uuid": .string(uuid), "state": .string(state)]), createdAt: "2026-10-06T00:00:00Z")
        }
        func control(_ uuid: String, command: String, status: String = "applied", kind: String = "mid_turn_input") -> NativeLiveRuntimeControlSnapshot {
            .init(controlID: uuid, prepareID: "prepare", kind: kind, payload: [:], status: status, reservedBy: nil,
                  receipt: ["status": .string("queued"), "command_uuid": .string(command)], failureCode: nil, createdAt: "now", updatedAt: "now", appliedAt: nil)
        }
        for signal in ["receipt:queued", "attributed", "lifecycle:queued", "lifecycle:started", "lifecycle:completed"] {
            view.messageText = "  typed  "; view.pendingMidTurnDelivery = .init(controlID: "exact-control", text: "typed")
            view.reconcilePendingMidTurnDelivery(signal)
            precondition(view.messageText.isEmpty && view.pendingMidTurnDelivery == nil, "Accepted evidence must clear only the submitted text")
        }
        for signal in ["failed:timeout", "lifecycle:cancelled", "lifecycle:discarded", "lifecycle:refused"] {
            view.messageText = "typed"; view.pendingMidTurnDelivery = .init(controlID: "exact-control", text: "typed")
            view.reconcilePendingMidTurnDelivery(signal)
            precondition(view.messageText == "typed" && view.pendingMidTurnDelivery == nil, "Rejected delivery must keep text and unlock explicit retry")
        }
        for signal in [nil, "lifecycle:received", "unknown"] as [String?] {
            view.messageText = "typed"; view.pendingMidTurnDelivery = .init(controlID: "exact-control", text: "typed")
            view.reconcilePendingMidTurnDelivery(signal)
            precondition(view.messageText == "typed" && view.pendingMidTurnDelivery != nil, "Ambiguous evidence must keep pending delivery")
        }
        view.messageText = "newer typing"; view.reconcilePendingMidTurnDelivery("receipt:queued")
        precondition(view.messageText == "newer typing", "Acceptance cannot erase newer input")
        view.pendingMidTurnDelivery = .init(controlID: "exact-control", text: "typed")
        var s = surface(); s.controls = [control("exact-control", command: "wrong-control")]; app.nativeLiveRuntimeSurface = s
        precondition(view.pendingMidTurnDeliverySignal == nil, "Queued receipt requires exact provider command UUID")
        s.controls = [control("wrong-control", command: "wrong-control")]; s.events = [event("command_lifecycle", "wrong-control", "completed")]; app.nativeLiveRuntimeSurface = s
        precondition(view.pendingMidTurnDeliverySignal == nil, "Other control lifecycle cannot accept this text")
        s.events = []; s.controls = [control("exact-control", command: "exact-control")]; app.nativeLiveRuntimeSurface = s
        precondition(view.pendingMidTurnDeliverySignal == "receipt:queued")
        s.events = [event("command_lifecycle", "exact-control", "refused")]; app.nativeLiveRuntimeSurface = s
        precondition(view.pendingMidTurnDeliverySignal == "lifecycle:refused", "Lifecycle evidence keeps its original precedence")
        s.controls = []; s.events = [event("user_message_attribution", "exact-control")]; app.nativeLiveRuntimeSurface = s
        precondition(view.pendingMidTurnDeliverySignal == "attributed")
        app.activeNativeLiveConversationID = other
        precondition(view.visibleRuntimeSurface == nil && !view.isRuntimeTurnActive && view.pendingMidTurnDeliverySignal == nil)
        app.activeNativeLiveConversationID = id; s = surface(); s.foregroundTurnCompleted = true; app.nativeLiveRuntimeSurface = s
        precondition(!view.isRuntimeTurnActive)
        s.foregroundTurnCompleted = false; app.nativeLiveRuntimeSurface = s; view.pendingMidTurnDelivery = nil
        view.interruptCurrentTurn(); view.interruptCurrentTurn()
        precondition(view.isRuntimeControlInFlight, "Interrupt must reserve synchronously")
        for _ in 0..<100 { await Task.yield() }
        precondition(app.interrupts == 1 && !view.isRuntimeControlInFlight, "Duplicate interrupt must be blocked and reservation released")
        s.controls = [control("interrupt", command: "interrupt", status: "reserved", kind: "interrupt")]; app.nativeLiveRuntimeSurface = s
        view.interruptCurrentTurn(); for _ in 0..<10 { await Task.yield() }; precondition(app.interrupts == 1)
        app.nativeLiveRuntimeSurface = surface(); view.messageText = "typed"; app.throwDelivery = true
        view.sendMidTurnInput("typed"); for _ in 0..<100 { await Task.yield() }
        precondition(view.messageText == "typed" && view.pendingMidTurnDelivery == nil && app.sends == 1 && !view.isRuntimeControlInFlight, "Ambiguous send must preserve text without automatic retry")
        print("Runtime orchestration PASS: acceptance/rejection/ambiguity, exact UUID, newer typing, conversation mismatch, completion and duplicate interrupt")
    }
}
