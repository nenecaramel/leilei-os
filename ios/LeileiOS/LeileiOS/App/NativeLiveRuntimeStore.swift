import Foundation

extension AppModel {
    @discardableResult
    func refreshActiveNativeLiveRuntimeMetadata() async -> Bool {
        guard isAuthenticated,
              let conversationID = activeNativeLiveConversationID else {
            return false
        }

        do {
            let snapshot =
                try await api.nativeLiveConversationRuntimeMetadata(
                    conversationID: conversationID
                )

            guard activeNativeLiveConversationID == conversationID else {
                return false
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
            return true
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
            return false
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
            return false
        } catch {
            // Durable metadata is auxiliary to canonical chat loading.
            return false
        }
    }

    func beginNativeLiveRuntimeObservation(
        prepareID: String,
        conversationID: UUID,
        requestID: String? = nil, userMessageID: String? = nil, operation: String? = nil, startedAt: String? = nil,
        preparedUserMessage: NativeLiveCurrentPathMessage? = nil, replacementTargetUserMessageID: String? = nil
    ) {
        if let previous = nativeLiveRuntimeSurface,
           previous.prepareID != prepareID,
           previous.foregroundTurnCompleted {
            beginNativeLiveBackgroundObservation(
                from: previous
            )
        }

        nativeLiveRuntimeObservationTask?.cancel()

        nativeLiveRuntimeSurface = NativeLiveRuntimeSurfaceState(
            prepareID: prepareID,
            conversationID: conversationID,
            events: [],
            interactions: [],
            controls: [],
            nextAfterSequence: 0,
            requestID:requestID, userMessageID:userMessageID, operation:operation, startedAt:startedAt,
            preparedUserMessage:preparedUserMessage, replacementTargetUserMessageID:replacementTargetUserMessageID
        )

        nativeLiveRuntimeObservationTask = Task { @MainActor [weak self] in
            guard let self else { return }

            var cycle = 0
            var sawBackgroundDrainCandidate = false

            while !Task.isCancelled,
                  self.nativeLiveRuntimeSurface?.prepareID == prepareID {
                await self.refreshNativeLiveRuntimeSurface(
                    prepareID: prepareID,
                    conversationID: conversationID,
                    includeInteractions: cycle.isMultiple(of: 2)
                )
                cycle += 1

                if let surface = self.nativeLiveRuntimeSurface,
                   surface.prepareID == prepareID,
                   surface.foregroundTurnCompleted {
                    if surface.shouldRemainObservedAfterForeground {
                        sawBackgroundDrainCandidate = false
                    } else if sawBackgroundDrainCandidate {
                        if self.activeNativeLiveConversationID
                            == conversationID {
                            await self.refreshNativeLiveCurrentPath(
                                force: true,
                                surfaceTransientFailure: false
                            )
                        }
                        self.stopNativeLiveRuntimeObservation(
                            prepareID: prepareID
                        )
                        return
                    } else {
                        sawBackgroundDrainCandidate = true
                    }
                }

                try? await Task.sleep(
                    for: .milliseconds(500)
                )
            }
        }
    }

    private func beginNativeLiveBackgroundObservation(
        from initialSurface: NativeLiveRuntimeSurfaceState
    ) {
        let prepareID = initialSurface.prepareID
        let conversationID = initialSurface.conversationID

        nativeLiveBackgroundObservationTasks[prepareID]?.cancel()
        nativeLiveBackgroundRuntimeSurfaces[prepareID] =
            initialSurface
        nativeLiveBackgroundSurfaceOrder.removeAll {
            $0 == prepareID
        }
        nativeLiveBackgroundSurfaceOrder.append(prepareID)

        nativeLiveBackgroundObservationTasks[prepareID] =
            Task { @MainActor [weak self] in
                guard let self else { return }
                defer {
                    self.nativeLiveBackgroundObservationTasks
                        .removeValue(forKey: prepareID)
                    self.pruneNativeLiveBackgroundRuntimeSurfaces()
                }

                var cycle = 0
                var sawBackgroundDrainCandidate = false
                var sawPostForegroundActivity =
                    initialSurface.hasVisibleBackgroundTasks
                var refreshedActivityAnchor = false

                while !Task.isCancelled,
                      self.nativeLiveBackgroundRuntimeSurfaces[
                        prepareID
                      ] != nil {
                    let changed =
                        await self.refreshNativeLiveBackgroundRuntimeSurface(
                            prepareID: prepareID,
                            conversationID: conversationID,
                            includeInteractions:
                                cycle.isMultiple(of: 2)
                        )
                    cycle += 1

                    guard let surface =
                            self.nativeLiveBackgroundRuntimeSurfaces[
                                prepareID
                            ] else {
                        return
                    }

                    if changed,
                       !refreshedActivityAnchor,
                       self.activeNativeLiveConversationID
                            == conversationID {
                        await self.refreshNativeLiveCurrentPath(
                            force: true,
                            surfaceTransientFailure: false
                        )
                        refreshedActivityAnchor = true
                    }

                    if surface.shouldRemainObservedAfterForeground {
                        sawPostForegroundActivity = true
                        sawBackgroundDrainCandidate = false
                    } else if sawBackgroundDrainCandidate {
                        if self.activeNativeLiveConversationID
                            == conversationID {
                            await self.refreshNativeLiveCurrentPath(
                                force: true,
                                surfaceTransientFailure: false
                            )
                        }
                        if !sawPostForegroundActivity {
                            self.nativeLiveBackgroundRuntimeSurfaces
                                .removeValue(forKey: prepareID)
                        }
                        return
                    } else {
                        sawBackgroundDrainCandidate = true
                    }

                    try? await Task.sleep(
                        for: .milliseconds(500)
                    )
                }
            }
    }

    private func refreshNativeLiveBackgroundRuntimeSurface(
        prepareID: String,
        conversationID: UUID,
        includeInteractions: Bool
    ) async -> Bool {
        guard var surface =
                nativeLiveBackgroundRuntimeSurfaces[prepareID],
              surface.conversationID == conversationID else {
            return false
        }

        var changed = false

        do {
            let page = try await api.nativeLiveRuntimeEvents(
                prepareID: prepareID,
                afterSequence: surface.nextAfterSequence
            )
            guard page.prepareID == prepareID else {
                return false
            }

            if !page.events.isEmpty {
                let known = Set(surface.events.map(\.sequence))
                let newEvents = page.events.filter {
                    !known.contains($0.sequence)
                }
                if !newEvents.isEmpty {
                    surface.events.append(contentsOf: newEvents)
                    changed = true
                }
            }
            if surface.nextAfterSequence != page.nextAfterSequence {
                surface.nextAfterSequence = page.nextAfterSequence
                changed = true
            }
        } catch {
            // Background observation is fail-soft. Durable runtime rows
            // remain available to the next refresh or app launch.
        }

        if includeInteractions {
            do {
                let interactions =
                    try await api.nativeLiveRuntimeInteractions(
                        prepareID: prepareID
                    )
                if interactions != surface.interactions {
                    surface.interactions = interactions
                    changed = true
                }
            } catch {
                // Fail-soft; the next cycle can recover.
            }
        }

        guard changed,
              nativeLiveBackgroundRuntimeSurfaces[prepareID]
                != nil else {
            return false
        }
        nativeLiveBackgroundRuntimeSurfaces[prepareID] = surface
        return true
    }

    func continueNativeLiveRuntimeObservationForBackgroundTasks(
        prepareID: String,
        conversationID: UUID
    ) async -> Bool {
        await refreshNativeLiveRuntimeSurface(
            prepareID: prepareID,
            conversationID: conversationID,
            includeInteractions: true
        )

        guard var surface = nativeLiveRuntimeSurface,
              surface.prepareID == prepareID,
              surface.conversationID == conversationID else {
            return false
        }

        // Keep the observer alive for a short settle window even when the
        // first post-result read has not received background_tasks_changed
        // yet. The observation loop requires two consecutive empty cycles
        // before it refreshes canonical history and stops.
        surface.foregroundTurnCompleted = true
        nativeLiveRuntimeSurface = surface
        return true
    }

    func stopNativeLiveRuntimeObservations(
        conversationID: UUID
    ) {
        if nativeLiveRuntimeSurface?.conversationID == conversationID {
            nativeLiveRuntimeObservationTask?.cancel()
            nativeLiveRuntimeObservationTask = nil
            nativeLiveRuntimeSurface = nil
        }

        let backgroundPrepareIDs =
            nativeLiveBackgroundRuntimeSurfaces.compactMap {
                prepareID, surface in
                surface.conversationID == conversationID
                    ? prepareID
                    : nil
            }

        for prepareID in backgroundPrepareIDs {
            nativeLiveBackgroundObservationTasks[
                prepareID
            ]?.cancel()
            nativeLiveBackgroundObservationTasks
                .removeValue(forKey: prepareID)
            nativeLiveBackgroundRuntimeSurfaces
                .removeValue(forKey: prepareID)
        }
        nativeLiveBackgroundSurfaceOrder.removeAll {
            backgroundPrepareIDs.contains($0)
        }
    }

    private func pruneNativeLiveBackgroundRuntimeSurfaces(
        maxCompletedCount: Int = 8
    ) {
        nativeLiveBackgroundSurfaceOrder.removeAll {
            nativeLiveBackgroundRuntimeSurfaces[$0] == nil
        }

        let activePrepareIDs =
            Set(nativeLiveBackgroundObservationTasks.keys)
        let completedPrepareIDs =
            nativeLiveBackgroundSurfaceOrder.filter {
                !activePrepareIDs.contains($0)
            }
        let overflow =
            max(completedPrepareIDs.count - maxCompletedCount, 0)

        guard overflow > 0 else { return }

        for prepareID in completedPrepareIDs.prefix(overflow) {
            nativeLiveBackgroundRuntimeSurfaces
                .removeValue(forKey: prepareID)
        }
        nativeLiveBackgroundSurfaceOrder.removeAll {
            nativeLiveBackgroundRuntimeSurfaces[$0] == nil
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
        // A failed/interrupted turn may have no canonical assistant. Retain its visible
        // body/evidence until authoritative replacement or conversation teardown.
        let hasCanonical = nativeLiveCurrentPath?.messages.contains { $0.role == "assistant" && $0.activity?.prepareId == prepareID } == true
        let hasDurableFailure = nativeLiveCurrentPath?.failedTurn?.prepareId == prepareID
        if hasCanonical || hasDurableFailure { nativeLiveRuntimeSurface = nil }
        else { nativeLiveRuntimeSurface?.foregroundTurnCompleted = true }
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

        var changed = false

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
                let newEvents = page.events.filter {
                    !known.contains($0.sequence)
                }
                if !newEvents.isEmpty {
                    surface.events.append(contentsOf: newEvents)
                    changed = true
                }
            }
            if surface.nextAfterSequence != page.nextAfterSequence {
                surface.nextAfterSequence = page.nextAfterSequence
                changed = true
            }
        } catch {
            // Runtime observation is fail-soft. Canonical turn completion
            // remains authoritative.
        }

        if includeInteractions {
            do {
                let interactions =
                    try await api.nativeLiveRuntimeInteractions(
                        prepareID: prepareID
                    )
                if interactions != surface.interactions {
                    surface.interactions = interactions
                    changed = true
                }
            } catch {
                // Fail-soft; the next observation can recover.
            }

            do {
                let controls =
                    try await api.nativeLiveRuntimeControls(
                        prepareID: prepareID
                    )
                if controls != surface.controls {
                    surface.controls = controls
                    changed = true
                }
            } catch {
                // Fail-soft; the next observation can recover.
            }
        }

        guard changed,
              nativeLiveRuntimeSurface?.prepareID == prepareID else {
            return
        }
        nativeLiveRuntimeSurface = surface
    }

    func resolveNativeLiveRuntimeInteraction(
        _ interaction: NativeLiveRuntimeInteractionSnapshot,
        response: [String: NativeLiveJSONValue]
    ) async throws {
        guard interaction.status == "pending" else {
            throw NativeLiveSendError.notReady
        }

        do {
            let updated =
                try await api.resolveNativeLiveRuntimeInteraction(
                    prepareID: interaction.prepareID,
                    interactionID: interaction.interactionID,
                    response: response
                )

            if var latest = nativeLiveRuntimeSurface,
               latest.prepareID == interaction.prepareID {
                if let index = latest.interactions.firstIndex(where: {
                    $0.interactionID == updated.interactionID
                }) {
                    latest.interactions[index] = updated
                } else {
                    latest.interactions.append(updated)
                }
                nativeLiveRuntimeSurface = latest
            } else if var background =
                        nativeLiveBackgroundRuntimeSurfaces[
                            interaction.prepareID
                        ] {
                if let index = background.interactions.firstIndex(
                    where: {
                        $0.interactionID == updated.interactionID
                    }
                ) {
                    background.interactions[index] = updated
                } else {
                    background.interactions.append(updated)
                }
                nativeLiveBackgroundRuntimeSurfaces[
                    interaction.prepareID
                ] = background
            } else {
                await refreshNativeLiveCurrentPath(
                    force: true,
                    surfaceTransientFailure: false
                )
            }
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
