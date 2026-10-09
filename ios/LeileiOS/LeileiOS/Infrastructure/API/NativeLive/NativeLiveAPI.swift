import Foundation

extension LeileiAPIClient {
    func nativeLiveConversations(
        limit: Int = 50,
        scope: NativeLiveConversationListScope = .active
    ) async throws -> [NativeLiveConversationSummary] {
        try await nativeLiveConversationPage(
            limit: limit,
            scope: scope
        ).conversations
    }

    func nativeLiveConversationPage(
        limit: Int = 50,
        cursor: String? = nil,
        scope: NativeLiveConversationListScope = .active
    ) async throws -> NativeLiveConversationPage {
        guard (1...100).contains(limit) else {
            throw LeileiAPIError.invalidResponse
        }

        var components = URLComponents()
        components.path = "/api/v1/native-live/conversations"
        var queryItems = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "scope", value: scope.rawValue)
        ]
        if let cursor {
            guard !cursor.isEmpty else {
                throw LeileiAPIError.invalidResponse
            }
            queryItems.append(
                URLQueryItem(name: "cursor", value: cursor)
            )
        }
        components.queryItems = queryItems
        guard let path = components.string else {
            throw LeileiAPIError.invalidResponse
        }

        let envelope: NativeLiveConversationListEnvelope = try await request(
            path: path,
            authenticated: true
        )
        return NativeLiveConversationPage(
            conversations: envelope.data.conversations,
            nextCursor: envelope.data.nextCursor
        )
    }

    func createNativeLiveConversation(
        title: String? = nil
    ) async throws -> NativeLiveConversationSummary {
        let body = try JSONEncoder().encode(
            CreateNativeLiveConversationBody(title: title)
        )
        let envelope: NativeLiveConversationEnvelope = try await request(
            path: "/api/v1/native-live/conversations",
            method: "POST",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func renameNativeLiveConversation(
        conversationID: UUID,
        title: String
    ) async throws -> NativeLiveConversationSummary {
        let body = try JSONEncoder().encode(
            RenameNativeLiveConversationBody(title: title)
        )
        let envelope: NativeLiveConversationEnvelope = try await request(
            path: "/api/v1/native-live/conversations/\(conversationID.uuidString.lowercased())",
            method: "PATCH",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func archiveNativeLiveConversation(
        conversationID: UUID
    ) async throws {
        let _: NoContentResponse = try await request(
            path: "/api/v1/native-live/conversations/\(conversationID.uuidString.lowercased())/archive",
            method: "POST",
            authenticated: true
        )
    }

    func restoreNativeLiveConversation(
        conversationID: UUID
    ) async throws {
        let _: NoContentResponse = try await request(
            path: "/api/v1/native-live/conversations/\(conversationID.uuidString.lowercased())/restore",
            method: "POST",
            authenticated: true
        )
    }

    func deleteNativeLiveConversation(
        conversationID: UUID
    ) async throws {
        let _: NoContentResponse = try await request(
            path:
                "/api/v1/native-live/conversations/"
                + "\(conversationID.uuidString.lowercased())"
                + "?confirm=true",
            method: "DELETE",
            authenticated: true
        )
    }

    func createNativeLiveAttachmentUploadSlot(
        filename: String,
        mimeType: String,
        sizeBytes: Int,
        sha256: String,
        kind: NativeLiveComposerAttachmentKind
    ) async throws -> NativeLiveAttachmentUploadSlot {
        let body = try JSONEncoder().encode(
            NativeLiveAttachmentUploadSlotBody(
                filename: filename,
                mimeType: mimeType,
                sizeBytes: sizeBytes,
                sha256: sha256,
                kind: kind
            )
        )
        let envelope: NativeLiveAttachmentUploadSlotEnvelope =
            try await request(
                path: "/api/v1/native-live/attachments/upload-slots",
                method: "POST",
                body: body,
                authenticated: true
            )
        let result = envelope.data
        guard let transferURL = URL(
            string: result.upload.url,
            relativeTo: baseURL
        )?.absoluteURL else {
            throw LeileiAPIError.invalidResponse
        }
        return NativeLiveAttachmentUploadSlot(
            attachment: result.attachment,
            upload: NativeLiveAttachmentTransferSlot(
                url: transferURL.absoluteString,
                method: result.upload.method,
                headers: result.upload.headers,
                expiresAt: result.upload.expiresAt
            )
        )
    }

    func uploadNativeLiveAttachmentBytes(
        _ data: Data,
        to slot: NativeLiveAttachmentTransferSlot
    ) async throws {
        guard slot.method == "PUT",
              let url = URL(string: slot.url) else {
            throw LeileiAPIError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        for (name, value) in slot.headers {
            request.setValue(value, forHTTPHeaderField: name)
        }

        let (_, response) = try await session.upload(
            for: request,
            from: data
        )
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else {
            throw LeileiAPIError.invalidResponse
        }
    }

    func completeNativeLiveAttachment(
        attachmentID: String
    ) async throws -> NativeLiveChatAttachmentSnapshot {
        let envelope: NativeLiveAttachmentCompleteEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/attachments/"
                    + attachmentID
                    + "/complete",
                method: "POST",
                authenticated: true
            )
        return envelope.data.attachment
    }

    func nativeLiveAttachmentDownloadSlot(
        attachmentID: String
    ) async throws -> NativeLiveAttachmentDownloadSlot {
        let envelope: NativeLiveAttachmentDownloadSlotEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/attachments/"
                    + attachmentID
                    + "/download-slot",
                method: "POST",
                authenticated: true
            )
        let result = envelope.data
        guard let transferURL = URL(
            string: result.download.url,
            relativeTo: baseURL
        )?.absoluteURL else {
            throw LeileiAPIError.invalidResponse
        }
        return NativeLiveAttachmentDownloadSlot(
            attachment: result.attachment,
            download: NativeLiveAttachmentTransferSlot(
                url: transferURL.absoluteString,
                method: result.download.method,
                headers: result.download.headers,
                expiresAt: result.download.expiresAt
            )
        )
    }

    func prepareNativeLiveSend(
        conversationID: UUID,
        expectedHeadMessageID: String?,
        text: String,
        inputMode: NativeLiveInputMode = .text,
        attachmentIDs: [String] = [],
        execution: NativeLiveExecutionSelection? = nil,
        requestID: UUID = UUID()
    ) async throws -> NativeLivePrepareResult {
        let body = try JSONEncoder().encode(
            NativeLiveSendBody(
                dispatchTarget: "claude_code",
                requestId: requestID.uuidString.lowercased(),
                operation: "send",
                conversationId: conversationID.uuidString.lowercased(),
                expectedHeadMessageId: expectedHeadMessageID,
                text: text,
                attachmentIds: attachmentIDs,
                execution: execution,
                inputMode: inputMode
            )
        )
        let envelope: NativeLivePrepareEnvelope = try await request(
            path: "/api/v1/native-live/prepare",
            method: "POST",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func prepareNativeLiveRetry(
        conversationID: UUID,
        targetUserMessageID: String,
        execution: NativeLiveExecutionSelection? = nil,
        requestID: UUID = UUID()
    ) async throws -> NativeLivePrepareResult {
        let body = try JSONEncoder().encode(
            NativeLiveRetryBody(
                dispatchTarget: "claude_code",
                requestId: requestID.uuidString.lowercased(),
                operation: "retry",
                conversationId: conversationID.uuidString.lowercased(),
                targetUserMessageId: targetUserMessageID,
                execution: execution
            )
        )
        let envelope: NativeLivePrepareEnvelope = try await request(
            path: "/api/v1/native-live/prepare",
            method: "POST",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func prepareNativeLiveEdit(
        conversationID: UUID,
        targetUserMessageID: String,
        text: String,
        attachmentIDs: [String]? = nil,
        execution: NativeLiveExecutionSelection? = nil,
        requestID: UUID = UUID()
    ) async throws -> NativeLivePrepareResult {
        let body = try JSONEncoder().encode(
            NativeLiveEditBody(
                dispatchTarget: "claude_code",
                requestId: requestID.uuidString.lowercased(),
                operation: "edit",
                conversationId: conversationID.uuidString.lowercased(),
                targetUserMessageId: targetUserMessageID,
                text: text,
                attachmentIds: attachmentIDs,
                execution: execution
            )
        )
        let envelope: NativeLivePrepareEnvelope = try await request(
            path: "/api/v1/native-live/prepare",
            method: "POST",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func nativeLiveActiveTurn(
        conversationID: UUID
    ) async throws -> NativeLiveTurnSnapshot? {
        let envelope: NativeLiveActiveTurnEnvelope = try await request(
            path:
                "/api/v1/native-live/conversations/"
                + conversationID.uuidString.lowercased()
                + "/active-turn",
            authenticated: true
        )
        return envelope.data.turn
    }

    func waitNativeLiveTurn(
        prepareID: String
    ) async throws -> NativeLiveTurnWaitResult {
        let envelope: NativeLiveTurnWaitEnvelope = try await request(
            path: "/api/v1/native-live/turns/\(prepareID)/wait",
            method: "POST",
            authenticated: true
        )

        switch envelope.data.outcome {
        case "terminal":
            guard let turn = envelope.data.turn else {
                throw LeileiAPIError.invalidResponse
            }
            return .terminal(turn)
        case "timeout":
            guard envelope.data.turn == nil else {
                throw LeileiAPIError.invalidResponse
            }
            return .timeout
        default:
            throw LeileiAPIError.invalidResponse
        }
    }

    func nativeLiveRuntimeEvents(
        prepareID: String,
        afterSequence: Int,
        limit: Int = 100
    ) async throws -> NativeLiveRuntimeEventPage {
        guard afterSequence >= 0,
              (1...200).contains(limit) else {
            throw LeileiAPIError.invalidResponse
        }

        let envelope: NativeLiveRuntimeEventsEnvelope = try await request(
            path:
                "/api/v1/native-live/turns/\(prepareID)/events"
                + "?after_sequence=\(afterSequence)&limit=\(limit)",
            authenticated: true
        )

        return NativeLiveRuntimeEventPage(
            prepareID: envelope.data.prepareID,
            events: envelope.data.events,
            nextAfterSequence: envelope.data.nextAfterSequence
        )
    }

    func nativeLiveRuntimeInteractions(
        prepareID: String,
        limit: Int = 50
    ) async throws -> [NativeLiveRuntimeInteractionSnapshot] {
        guard (1...100).contains(limit) else {
            throw LeileiAPIError.invalidResponse
        }

        let envelope: NativeLiveRuntimeInteractionsEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/turns/\(prepareID)/interactions"
                    + "?limit=\(limit)",
                authenticated: true
            )
        return envelope.data.interactions
    }

    func nativeLiveRuntimeControls(
        prepareID: String,
        limit: Int = 50
    ) async throws -> [NativeLiveRuntimeControlSnapshot] {
        guard (1...100).contains(limit) else {
            throw LeileiAPIError.invalidResponse
        }

        let envelope: NativeLiveRuntimeControlsEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/turns/\(prepareID)/controls"
                    + "?limit=\(limit)",
                authenticated: true
            )
        return envelope.data.controls
    }

    func resolveNativeLiveRuntimeInteraction(
        prepareID: String,
        interactionID: String,
        response: [String: NativeLiveJSONValue]
    ) async throws -> NativeLiveRuntimeInteractionSnapshot {
        let body = try JSONEncoder().encode(
            NativeLiveRuntimeInteractionResponseBody(
                response: response
            )
        )

        let envelope: NativeLiveRuntimeInteractionResolveEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/turns/\(prepareID)"
                    + "/interactions/\(interactionID)/respond",
                method: "POST",
                body: body,
                authenticated: true
            )
        return envelope.data.interaction
    }

    func createNativeLiveRuntimeControl(
        prepareID: String,
        controlID: UUID,
        kind: String,
        payload: [String: NativeLiveJSONValue]
    ) async throws -> NativeLiveRuntimeControlSnapshot {
        guard kind == "mid_turn_input"
                || kind == "interrupt" else {
            throw LeileiAPIError.invalidResponse
        }

        let body = try JSONEncoder().encode(
            NativeLiveRuntimeControlCreateBody(
                controlID:
                    controlID.uuidString.lowercased(),
                kind: kind,
                payload: payload
            )
        )

        let envelope: NativeLiveRuntimeControlCreateEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/turns/\(prepareID)/controls",
                method: "POST",
                body: body,
                authenticated: true
            )
        return envelope.data.control
    }

    func nativeLiveCurrentPath(
        conversationID: UUID,
        limit: Int = 100,
        beforeMessageID: String? = nil,
        afterMessageID: String? = nil,
        etag: String? = nil
    ) async throws -> NativeLiveCurrentPathFetchResult {
        guard (1...200).contains(limit),
              beforeMessageID == nil || afterMessageID == nil else {
            throw LeileiAPIError.invalidResponse
        }

        var components = URLComponents()
        components.path =
            "/api/v1/native-live/conversations/"
            + conversationID.uuidString.lowercased()
            + "/current-path"
        var queryItems = [
            URLQueryItem(name: "limit", value: String(limit))
        ]
        if let beforeMessageID {
            queryItems.append(
                URLQueryItem(
                    name: "before_message_id",
                    value: beforeMessageID
                )
            )
        }
        if let afterMessageID {
            queryItems.append(
                URLQueryItem(
                    name: "after_message_id",
                    value: afterMessageID
                )
            )
        }
        components.queryItems = queryItems
        guard let path = components.string,
              let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw LeileiAPIError.invalidResponse
        }

        var request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        if let etag {
            request.setValue(etag, forHTTPHeaderField: "If-None-Match")
        }

        guard
            let token = try await authSession.accessToken(),
            !token.isEmpty
        else {
            throw LeileiAPIError.missingAccessToken
        }
        request.setValue(
            "Bearer \(token)",
            forHTTPHeaderField: "Authorization"
        )

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw LeileiAPIError.invalidResponse
        }

        switch http.statusCode {
        case 304:
            return .notModified
        case 200:
            let envelope = try JSONDecoder().decode(
                NativeLiveCurrentPathEnvelope.self,
                from: data
            )
            return .modified(
                snapshot: envelope.data,
                etag: http.value(forHTTPHeaderField: "ETag")
            )
        case 401:
            throw LeileiAPIError.unauthorized
        case 403:
            throw LeileiAPIError.forbidden
        default:
            let failure = try? JSONDecoder().decode(ErrorEnvelope.self, from: data)
            throw LeileiAPIError.backend(
                status: http.statusCode,
                code: failure?.error.code,
                message: failure?.error.message
            )
        }
    }

    func waitNativeLiveConversationHead(
        conversationID: UUID,
        afterHeadMessageID: String?
    ) async throws -> NativeLiveConversationHeadWaitSnapshot {
        let body = try JSONEncoder().encode(
            NativeLiveConversationHeadWaitBody(
                afterHeadMessageID: afterHeadMessageID
            )
        )
        let envelope: NativeLiveConversationHeadWaitEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/conversations/"
                    + conversationID.uuidString.lowercased()
                    + "/head/wait",
                method: "POST",
                body: body,
                authenticated: true
            )
        guard envelope.data.outcome == "changed"
                || envelope.data.outcome == "timeout" else {
            throw LeileiAPIError.invalidResponse
        }
        return envelope.data
    }

    func nativeLiveConversationRuntimeMetadata(
        conversationID: UUID
    ) async throws -> NativeLiveConversationRuntimeMetadataSnapshot {
        let envelope: NativeLiveConversationRuntimeMetadataEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/conversations/"
                    + conversationID.uuidString.lowercased()
                    + "/runtime-metadata",
                authenticated: true
            )
        return envelope.data
    }

    func createNativeLiveExternalSessionRequest()
        async throws -> NativeLiveExternalSessionRequestSnapshot {
        let envelope: NativeLiveExternalSessionRequestEnvelope =
            try await request(
                path: "/api/v1/native-live/external-sessions/requests",
                method: "POST",
                authenticated: true
            )
        return envelope.data
    }

    func nativeLiveExternalSessionRequest(
        requestID: String
    ) async throws -> NativeLiveExternalSessionRequestSnapshot {
        guard UUID(uuidString: requestID) != nil else {
            throw LeileiAPIError.invalidResponse
        }
        let envelope: NativeLiveExternalSessionRequestEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/external-sessions/requests/"
                    + requestID.lowercased(),
                authenticated: true
            )
        return envelope.data
    }

    func createNativeLiveConversationFromClaudeSession(
        requestID: String,
        sourceSessionID: String,
        title: String? = nil,
        historySnapshot: NativeLiveConversationHistoryUpload? = nil
    ) async throws -> NativeLiveConversationSummary {
        guard UUID(uuidString: requestID) != nil,
              !sourceSessionID.trimmingCharacters(
                  in: .whitespacesAndNewlines
              ).isEmpty else {
            throw LeileiAPIError.invalidResponse
        }
        let body = try JSONEncoder().encode(
            CreateNativeLiveConversationFromClaudeSessionBody(
                requestID: requestID.lowercased(),
                sourceSessionID: sourceSessionID,
                title: title,
                historySnapshot: historySnapshot
            )
        )
        let envelope: NativeLiveConversationEnvelope = try await request(
            path:
                "/api/v1/native-live/conversations/from-claude-session",
            method: "POST",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func nativeLiveConversationHistorySnapshot(
        conversationID: UUID
    ) async throws -> NativeLiveConversationHistorySnapshot {
        let envelope: NativeLiveConversationHistoryEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/conversations/"
                    + conversationID.uuidString.lowercased()
                    + "/history-snapshot",
                authenticated: true
            )
        return envelope.data
    }

    func createNativeLiveManualCompact(
        conversationID: UUID
    ) async throws -> NativeLiveManualCompactSnapshot {
        let envelope: NativeLiveManualCompactEnvelope = try await request(
            path:
                "/api/v1/native-live/conversations/"
                + conversationID.uuidString.lowercased()
                + "/compact",
            method: "POST",
            authenticated: true
        )
        return envelope.data
    }

    func nativeLiveManualCompact(
        requestID: String
    ) async throws -> NativeLiveManualCompactSnapshot {
        guard UUID(uuidString: requestID) != nil else {
            throw LeileiAPIError.invalidResponse
        }
        let envelope: NativeLiveManualCompactEnvelope = try await request(
            path:
                "/api/v1/native-live/manual-compacts/"
                + requestID.lowercased(),
            authenticated: true
        )
        return envelope.data
    }
}
