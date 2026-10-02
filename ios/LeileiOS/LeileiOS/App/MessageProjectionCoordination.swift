import Foundation

extension AppModel {
    func refreshMindWrites(
        messageID: String,
        force: Bool = false
    ) async {
        guard isAuthenticated,
              !messageID.isEmpty else {
            return
        }

        if !force,
           mindWritesByMessageID[messageID] != nil {
            return
        }

        guard !mindWriteRequestsInFlight.contains(messageID) else {
            return
        }

        mindWriteRequestsInFlight.insert(messageID)
        defer {
            mindWriteRequestsInFlight.remove(messageID)
        }

        do {
            let projection = try await api.mindWrites(
                messageID: messageID
            )
            mindWritesByMessageID[messageID] = projection
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
        } catch {
            // Message-level Mind projection is fail-soft.
        }
    }

    func refreshAlbumSaves(
        userMessageID: String,
        force: Bool = false
    ) async {
        guard isAuthenticated,
              !userMessageID.isEmpty else {
            return
        }

        if !force,
           albumSavesByUserMessageID[userMessageID] != nil {
            return
        }

        guard !albumSaveRequestsInFlight.contains(
            userMessageID
        ) else {
            return
        }

        albumSaveRequestsInFlight.insert(userMessageID)
        defer {
            albumSaveRequestsInFlight.remove(userMessageID)
        }

        do {
            let projection = try await api.albumSaves(
                userMessageID: userMessageID
            )
            albumSavesByUserMessageID[userMessageID] =
                projection
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
        } catch {
            // Album save projection is fail-soft.
        }
    }

    func scheduleCurrentHeadMindWriteRefresh() {
        currentHeadMindWriteRefreshTask?.cancel()

        guard let messageID =
                nativeLiveCurrentPath?.currentHeadMessageId,
              nativeLiveCurrentPath?.messages.contains(where: {
                  $0.id == messageID
                      && $0.role == "assistant"
              }) == true else {
            return
        }

        currentHeadMindWriteRefreshTask =
            Task { @MainActor [weak self] in
                guard let self else { return }

                for attempt in 0..<6 {
                    guard !Task.isCancelled else {
                        return
                    }

                    await self.refreshMindWrites(
                        messageID: messageID,
                        force: true
                    )

                    if let projection =
                            self.mindWritesByMessageID[messageID],
                       projection.total > 0 {
                        return
                    }

                    guard attempt < 5 else {
                        return
                    }

                    try? await Task.sleep(
                        for: .seconds(2)
                    )
                }
            }
    }
}
