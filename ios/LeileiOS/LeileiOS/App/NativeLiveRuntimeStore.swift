import Foundation

extension AppModel {
    func refreshActiveNativeLiveRuntimeMetadata() async {
        guard isAuthenticated,
              let conversationID = activeNativeLiveConversationID else {
            return
        }

        do {
            let snapshot =
                try await api.nativeLiveConversationRuntimeMetadata(
                    conversationID: conversationID
                )

            guard activeNativeLiveConversationID == conversationID else {
                return
            }

            nativeLiveRuntimeMetadata = snapshot.runtimeMetadata
            activeNativeLiveWorkspaceID = snapshot.workspaceId
            activeNativeLiveWorkspaceRoot = snapshot.effectiveWorkspaceRoot
            if let metadata = snapshot.runtimeMetadata {
                nativeLiveRuntimeMetadataByConversationID[
                    conversationID
                ] = metadata
            } else {
                nativeLiveRuntimeMetadataByConversationID
                    .removeValue(forKey: conversationID)
            }
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
        } catch {
            // Durable metadata is auxiliary to canonical chat loading.
        }
    }

    func beginNativeLiveRuntimeObservation(
        prepareID: String,
        conversationID: UUID
    ) {
        nativeLiveRuntimeObservationTask?.cancel()

        nativeLiveRuntimeSurface = NativeLiveRuntimeSurfaceState(
            prepareID: prepareID,
            conversationID: conversationID,
            events: [],
            interactions: [],
            controls: [],
            nextAfterSequence: 0
        )

        nativeLiveRuntimeObservationTask = Task { @MainActor [weak self] in
            guard let self else { return }

            var cycle = 0

            while !Task.isCancelled,
                  self.nativeLiveRuntimeSurface?.prepareID == prepareID {
                await self.refreshNativeLiveRuntimeSurface(
                    prepareID: prepareID,
                    conversationID: conversationID,
                    includeInteractions: cycle.isMultiple(of: 2)
                )
                cycle += 1

                try? await Task.sleep(
                    for: .milliseconds(500)
                )
            }
        }
    }

    func stopNativeLiveRuntimeObservation(
        prepareID: String
    ) {
        guard nativeLiveRuntimeSurface?.prepareID == prepareID else {
            return
        }

        nativeLiveRuntimeObservationTask?.cancel()
        nativeLiveRuntimeObservationTask = nil
        nativeLiveRuntimeSurface = nil
    }

    private func refreshNativeLiveRuntimeSurface(
        prepareID: String,
        conversationID: UUID,
        includeInteractions: Bool
    ) async {
        guard var surface = nativeLiveRuntimeSurface,
              surface.prepareID == prepareID,
              surface.conversationID == conversationID else {
            return
        }

        do {
            let page = try await api.nativeLiveRuntimeEvents(
                prepareID: prepareID,
                afterSequence: surface.nextAfterSequence
            )
            guard page.prepareID == prepareID else {
                return
            }

            if !page.events.isEmpty {
                let known = Set(surface.events.map(\.sequence))
                surface.events.append(
                    contentsOf: page.events.filter {
                        !known.contains($0.sequence)
                    }
                )
            }
            surface.nextAfterSequence = page.nextAfterSequence
        } catch {
            // Runtime observation is fail-soft. Canonical turn completion
            // remains authoritative.
        }

        if includeInteractions {
            do {
                surface.interactions =
                    try await api.nativeLiveRuntimeInteractions(
                        prepareID: prepareID
                    )
            } catch {
                // Fail-soft; the next observation can recover.
            }

            do {
                surface.controls =
                    try await api.nativeLiveRuntimeControls(
                        prepareID: prepareID
                    )
            } catch {
                // Fail-soft; the next observation can recover.
            }
        }

        guard nativeLiveRuntimeSurface?.prepareID == prepareID else {
            return
        }
        nativeLiveRuntimeSurface = surface
    }

    func resolveNativeLiveRuntimeInteraction(
        _ interaction: NativeLiveRuntimeInteractionSnapshot,
        response: [String: NativeLiveJSONValue]
    ) async throws {
        guard let surface = nativeLiveRuntimeSurface,
              surface.prepareID == interaction.prepareID,
              surface.interactions.contains(where: {
                  $0.interactionID == interaction.interactionID
                      && $0.status == "pending"
              }) else {
            throw NativeLiveSendError.notReady
        }

        do {
            let updated =
                try await api.resolveNativeLiveRuntimeInteraction(
                    prepareID: interaction.prepareID,
                    interactionID: interaction.interactionID,
                    response: response
                )

            guard var latest = nativeLiveRuntimeSurface,
                  latest.prepareID == interaction.prepareID else {
                return
            }

            if let index = latest.interactions.firstIndex(where: {
                $0.interactionID == updated.interactionID
            }) {
                latest.interactions[index] = updated
            } else {
                latest.interactions.append(updated)
            }
            nativeLiveRuntimeSurface = latest
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
            throw LeileiAPIError.missingAccessToken
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
            throw LeileiAPIError.unauthorized
        } catch {
            throw error
        }
    }

    func sendNativeLiveMidTurnInput(
        _ text: String
    ) async throws -> String {
        let normalized = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !normalized.isEmpty,
              normalized.count <= 8_000 else {
            throw NativeLiveRuntimeControlClientError.invalidMidTurnInput
        }

        let control =
            try await createNativeLiveRuntimeControl(
                kind: "mid_turn_input",
                payload: [
                    "text": .string(normalized),
                ]
            )
        return control.controlID
    }

    func interruptNativeLiveTurn() async throws {
        _ = try await createNativeLiveRuntimeControl(
            kind: "interrupt",
            payload: [:]
        )
    }

    private func createNativeLiveRuntimeControl(
        kind: String,
        payload: [String: NativeLiveJSONValue]
    ) async throws -> NativeLiveRuntimeControlSnapshot {
        guard var surface = nativeLiveRuntimeSurface else {
            throw NativeLiveRuntimeControlClientError.notReady
        }

        let controlID = UUID()

        do {
            let created =
                try await api.createNativeLiveRuntimeControl(
                    prepareID: surface.prepareID,
                    controlID: controlID,
                    kind: kind,
                    payload: payload
                )

            guard nativeLiveRuntimeSurface?.prepareID
                    == surface.prepareID else {
                return created
            }

            if let index = surface.controls.firstIndex(where: {
                $0.controlID == created.controlID
            }) {
                surface.controls[index] = created
            } else {
                surface.controls.append(created)
            }
            nativeLiveRuntimeSurface = surface
            return created
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
            throw LeileiAPIError.missingAccessToken
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
            throw LeileiAPIError.unauthorized
        } catch {
            throw error
        }
    }
}

private enum NativeLiveRuntimeControlClientError:
    LocalizedError {
    case notReady
    case invalidMidTurnInput

    var errorDescription: String? {
        switch self {
        case .notReady:
            return "The current turn is not accepting input."
        case .invalidMidTurnInput:
            return "Mid-turn input must contain 1-8000 characters."
        }
    }
}
