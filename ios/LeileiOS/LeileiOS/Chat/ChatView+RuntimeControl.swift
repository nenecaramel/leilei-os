import Foundation

struct NativeLivePendingMidTurnDelivery:
    Equatable {
    let controlID: String
    let text: String
}

extension ChatView {
    var visibleRuntimeSurface:
        NativeLiveRuntimeSurfaceState? {
        guard let surface = appModel.nativeLiveRuntimeSurface,
              surface.conversationID
                == appModel.activeNativeLiveConversationID else {
            return nil
        }
        return surface
    }

    var isRuntimeTurnActive: Bool {
        if let nativeState =
            visibleRuntimeSurface?.providerTurnActive {
            return nativeState
        }
        if visibleRuntimeSurface?.foregroundTurnCompleted == true {
            return false
        }
        return visibleRuntimeSurface != nil
    }

    var pendingMidTurnDeliverySignal: String? {
        guard let pending = pendingMidTurnDelivery,
              let surface = visibleRuntimeSurface else {
            return nil
        }

        if let state = surface.commandLifecycleState(
            for: pending.controlID
        ) {
            return "lifecycle:\(state)"
        }

        if surface.hasUserMessageAttribution(
            pending.controlID
        ) {
            return "attributed"
        }

        if let control = surface.controls.first(where: {
            $0.controlID == pending.controlID
        }) {
            if control.providerQueueAccepted {
                return "receipt:queued"
            }
            if control.status == "failed" {
                return "failed:"
                    + (control.failureCode ?? "unknown")
            }
        }

        return nil
    }

    var runtimeInterruptRequested: Bool {
        visibleRuntimeSurface?.controls.contains {
            $0.kind == "interrupt"
                && $0.status != "failed"
        } == true
    }

    func sendMidTurnInput(
        _ text: String
    ) {
        let normalized = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !normalized.isEmpty,
              !isRuntimeControlInFlight,
              pendingMidTurnDelivery == nil,
              isRuntimeTurnActive else {
            return
        }

        isRuntimeControlInFlight = true

        Task { @MainActor in
            defer {
                isRuntimeControlInFlight = false
            }

            do {
                let controlID =
                    try await appModel.sendNativeLiveMidTurnInput(
                        normalized
                    )
                pendingMidTurnDelivery =
                    NativeLivePendingMidTurnDelivery(
                        controlID: controlID,
                        text: normalized
                    )
                reconcilePendingMidTurnDelivery(
                    pendingMidTurnDeliverySignal
                )
                isComposerFocused = true
            } catch {
                // Preserve the typed text. The control may be retried
                // explicitly by the user; never blind-retry an ambiguous send.
            }
        }
    }

    func reconcilePendingMidTurnDelivery(
        _ signal: String?
    ) {
        guard let pending = pendingMidTurnDelivery,
              let signal else {
            return
        }

        let accepted =
            signal == "receipt:queued"
            || signal == "attributed"
            || signal == "lifecycle:queued"
            || signal == "lifecycle:started"
            || signal == "lifecycle:completed"

        let rejected =
            signal.hasPrefix("failed:")
            || signal == "lifecycle:cancelled"
            || signal == "lifecycle:discarded"
            || signal == "lifecycle:refused"

        guard accepted || rejected else {
            return
        }

        if accepted,
           messageText.trimmingCharacters(
               in: .whitespacesAndNewlines
           ) == pending.text {
            messageText = ""
        }

        pendingMidTurnDelivery = nil
    }

    func interruptCurrentTurn() {
        guard !isRuntimeControlInFlight,
              !runtimeInterruptRequested,
              isRuntimeTurnActive else {
            return
        }

        isRuntimeControlInFlight = true

        Task { @MainActor in
            defer {
                isRuntimeControlInFlight = false
            }

            do {
                try await appModel.interruptNativeLiveTurn()
            } catch {
                // Never blind-retry an interrupt with unknown delivery.
            }
        }
    }
}
