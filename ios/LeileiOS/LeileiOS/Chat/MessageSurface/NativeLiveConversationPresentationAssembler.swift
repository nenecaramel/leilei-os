import Foundation

// Stateful reconciliation is owned by AppModel, never run independently by row Views.
struct NativeLiveConversationPresentationAssembler {
    private var previous: [String: NativeLiveAssistantTurnPresentation] = [:]
    private var generationOwners: [String:String] = [:]
    private var retainedUsers: [String:NativeLiveConversationRowPresentation] = [:]
    private var visibleAssistantIDsByUser: [String:String] = [:]
    private var canonicalIDs: [String:String] = [:]
    func pendingIDs(_ operation: NativeLivePendingOperation, snapshot: NativeLiveCurrentPathSnapshot?, identities: NativeLiveTurnIdentityCoordinator) -> (user:String,assistant:String) {
        let ids = identities.pendingIDs(operation,snapshot:snapshot)
        if identities.bindings[operation.id] == nil, let target = operation.targetUserMessageID,
           let stable = visibleAssistantIDsByUser[target] { return (ids.user,stable) }
        guard identities.bindings[operation.id] == nil, let target = operation.targetUserMessageID,
              let assistant = snapshot?.messages.first(where:{ $0.role == "assistant" && $0.parentMessageId == target }),
              let stable = canonicalIDs[assistant.id] else { return ids }
        return (ids.user,stable)
    }
    mutating func project(snapshot: NativeLiveCurrentPathSnapshot?, historySnapshot: NativeLiveConversationHistorySnapshot? = nil, pendingOperation: NativeLivePendingOperation?,
        runtimeSurface: NativeLiveRuntimeSurfaceState?, backgroundRuntimeSurfaces: [String:NativeLiveRuntimeSurfaceState],
        identities: NativeLiveTurnIdentityCoordinator, now: Date) -> [NativeLiveConversationRowPresentation] {
        var messages = pendingOperation?.isDraftConversation == true ? [] : snapshot?.messages ?? []
        let binding = pendingOperation.flatMap { identities.bindings[$0.id] }
        let conversationID = snapshot?.conversationId
        let failure = snapshot?.failedTurn.flatMap { evidence in
            evidence.anchorHeadMessageId == snapshot?.currentHeadMessageId ? evidence.runtimeSurface : nil
        }
        // Teardown stops observation before the caller clears pending. The same preparation's
        // durable failure must own both frames; a different pending generation cannot adopt it.
        let ownedFailure = pendingOperation == nil || binding?.prepareID == failure?.prepareID ? failure : nil
        let runtime = (runtimeSurface ?? ownedFailure).flatMap { surface -> NativeLiveRuntimeSurfaceState? in
            guard conversationID == nil || surface.conversationID.uuidString.caseInsensitiveCompare(conversationID!) == .orderedSame else { return nil }
            if let pendingOperation { guard binding?.prepareID == surface.prepareID else { return nil }; _ = pendingOperation }
            return surface
        }
        if let target = pendingOperation?.targetUserMessageID,
           let index = messages.firstIndex(where: { $0.id == target || $0.id == binding?.userMessageID }) {
            messages = Array(messages.prefix(index+1))
            // Canonical arrival may already have replaced the user; include only this preparation's answer.
            if let prepare = binding?.prepareID, let canonical = snapshot?.messages.first(where: { $0.role == "assistant" && $0.activity?.prepareId == prepare }) { messages.append(canonical) }
        }
        if pendingOperation == nil, let runtime,
           !messages.contains(where:{ $0.activity?.prepareId == runtime.prepareID }),
           let user = runtime.userMessageID, let index = messages.firstIndex(where:{ $0.role == "user" && $0.id == user }) {
            messages = Array(messages.prefix(index+1))
        }
        // A prepared Send/Edit user is durable but intentionally detached from the current head.
        // Hydrate only the backend's exact user and replacement lineage; never infer by text/time.
        if pendingOperation == nil, let runtime,
           !messages.contains(where:{ $0.activity?.prepareId == runtime.prepareID }),
           let user = runtime.preparedUserMessage, user.id == runtime.userMessageID,
           user.role == "user", user.conversationId.caseInsensitiveCompare(runtime.conversationID.uuidString) == .orderedSame,
           !messages.contains(where:{ $0.id == user.id }) {
            if let target = runtime.replacementTargetUserMessageID,
               let index = messages.firstIndex(where:{ $0.id == target && $0.role == "user" }) {
                messages = Array(messages.prefix(index))
            } else if let parent = user.parentMessageId,
                      let index = messages.firstIndex(where:{ $0.id == parent }) {
                messages = Array(messages.prefix(index+1))
            } else {
                // The current page may contain only descendants of an older replacement.
                // An absent exact target/parent is not permission to keep those stale siblings.
                messages = []
            }
            messages.append(user)
        }
        let recoveredBinding = runtime.flatMap { identities.binding(prepareID:$0.prepareID) }
        if pendingOperation == nil, let runtime, !messages.contains(where:{ $0.id == runtime.userMessageID }),
           let target = recoveredBinding?.targetUserMessageID,
           let index = messages.firstIndex(where:{ $0.role == "user" && $0.id == target }) {
            messages = Array(messages.prefix(index))
        }
        let pendingIDs = pendingOperation.map { self.pendingIDs($0,snapshot:snapshot,identities:identities) }
        var rows: [NativeLiveConversationRowPresentation] = []
        if pendingOperation?.isDraftConversation != true, let history = historySnapshot,
           conversationID == nil || history.conversationId == conversationID {
            rows = history.messages.map { message in
                var row = NativeLiveConversationRowPresentation(id:"history:\(history.conversationId):\(message.ordinal)",user:nil,userBacking:nil,assistant:nil)
                row.historyMessage = message; row.historyTimeZone = history.timeZone
                return row
            }
            var divider = NativeLiveConversationRowPresentation(id:"history:\(history.conversationId):fork",user:nil,userBacking:nil,assistant:nil)
            divider.isHistoryDivider = true; rows.append(divider)
        }
        let canonicalUserMessageIDs = Set(
            messages.filter { $0.role == "user" }.map(\.id)
        )
        var consumedPrepare = Set<String>()
        // Receipt identity is stable across reopen, delta fetches and lost-ACK
        // replay. Interleave deliveries by their server timestamps without
        // manufacturing canonical messages or changing provider lineage.
        let backgroundResults = (pendingOperation?.isDraftConversation == true
            ? [] : snapshot?.backgroundResults ?? [])
            .sorted { left, right in
                left.createdAt == right.createdAt
                    ? left.id < right.id
                    : left.createdAt < right.createdAt
            }
        var backgroundIndex = 0
        for message in messages {
            while backgroundIndex < backgroundResults.count,
                  backgroundResults[backgroundIndex].createdAt <= message.createdAt {
                let result = backgroundResults[backgroundIndex]
                var row = NativeLiveConversationRowPresentation(
                    id: "background:\(result.id)", user: nil,
                    userBacking: nil, assistant: nil
                )
                row.backgroundResult = result
                rows.append(row)
                backgroundIndex += 1
            }
            if message.role == "user" {
                var source = NativeLiveMessagePresentationSource.canonical(message)
                var stable = identities.userID(message.id)
                if let operation = pendingOperation, let target = operation.targetUserMessageID,
                   message.id == target || message.id == binding?.userMessageID {
                    stable = pendingIDs!.user
                    if let text = operation.editedText { source = .edit(message,text:text,attachments:operation.presentationAttachments) }
                }
                let presentation = NativeLiveMessagePresentationProjector.project(source,presentationNamespace:stable)
                rows.append(.init(id:stable,user:presentation,userBacking:message,assistant:nil))
            } else {
                let prepare = message.activity?.prepareId
                let foreground = prepare == runtime?.prepareID ? runtime : nil
                let background = prepare.flatMap { backgroundRuntimeSurfaces[$0] }
                let surface = foreground ?? background
                var stable = canonicalIDs[message.id] ?? identities.assistantID(message)
                if let prepare, previous["turn:prepare:\(prepare)"] != nil { stable = "turn:prepare:\(prepare)" }
                if let prepare, let pendingIDs, prepare == binding?.prepareID { stable = pendingIDs.assistant }
                canonicalIDs[message.id] = stable
                let turn = makeTurn(id:stable,message:message,runtime:surface,background:foreground != nil ? background : nil,pending:nil,identities:identities,canonicalUserMessageIDs:canonicalUserMessageIDs,now:now)
                rows.append(.init(id:stable,user:nil,userBacking:nil,assistant:turn))
                if let prepare { consumedPrepare.insert(prepare) }
            }
        }
        while backgroundIndex < backgroundResults.count {
            let result = backgroundResults[backgroundIndex]
            var row = NativeLiveConversationRowPresentation(
                id: "background:\(result.id)", user: nil,
                userBacking: nil, assistant: nil
            )
            row.backgroundResult = result
            rows.append(row)
            backgroundIndex += 1
        }
        if let operation = pendingOperation {
            let ids = pendingIDs!
            if operation.isSend && !rows.contains(where: { $0.id == ids.user }) {
                rows.append(.init(id:ids.user,user:NativeLiveMessagePresentationProjector.project(.send(messageID:ids.user,text:operation.sendText ?? "",attachments:operation.presentationAttachments,inputMode:operation.inputMode),presentationNamespace:ids.user),userBacking:nil,assistant:nil))
            }
            if !rows.contains(where: { $0.id == ids.assistant }) {
                let turn = makeTurn(id:ids.assistant,message:nil,runtime:runtime,pending:operation,identities:identities,canonicalUserMessageIDs:canonicalUserMessageIDs,now:now)
                rows.append(.init(id:ids.assistant,user:nil,userBacking:nil,assistant:turn))
            }
        } else if let runtime, !consumedPrepare.contains(runtime.prepareID), let user = runtime.userMessageID,
                  messages.contains(where: { $0.role == "user" && $0.id == user }) || recoveredBinding.flatMap({ retainedUsers[$0.stableUserID] }) != nil {
            if !rows.contains(where:{ $0.id == identities.userID(user) }),
               let binding = recoveredBinding, let retained = retainedUsers[binding.stableUserID] { rows.append(retained) }
            let stable = identities.binding(prepareID:runtime.prepareID)?.stableAssistantID ?? "turn:prepare:\(runtime.prepareID)"
            // An active retry/edit owns its parent slot. Old siblings belong only to history.
            rows.removeAll { $0.assistant?.parentUserMessageID == user }
            var turn = makeTurn(id:stable,message:nil,runtime:runtime,pending:nil,identities:identities,canonicalUserMessageIDs:canonicalUserMessageIDs,now:now)
            turn.hasCanonicalRetryTarget = snapshot?.messages.contains(where:{ $0.id == user && $0.role == "user" }) == true
            rows.append(.init(id:stable,user:nil,userBacking:nil,assistant:turn))
        }
        for row in rows {
            if let turn = row.assistant, let user = turn.parentUserMessageID { visibleAssistantIDsByUser[user] = row.id }
        }
        for row in rows where row.user != nil { retainedUsers[row.id] = row }
        if previous.count > 2000 || retainedUsers.count > 2000 {
            let live = Set(rows.map(\.id))
            previous = previous.filter { live.contains($0.key) }
            retainedUsers = retainedUsers.filter { live.contains($0.key) }
            generationOwners = generationOwners.filter { live.contains($0.key) }
            visibleAssistantIDsByUser = visibleAssistantIDsByUser.filter { live.contains($0.value) }
            canonicalIDs = canonicalIDs.filter { live.contains($0.value) }
        }
        return rows
    }

    private mutating func makeTurn(id: String,message: NativeLiveCurrentPathMessage?,runtime: NativeLiveRuntimeSurfaceState?,
        background: NativeLiveRuntimeSurfaceState? = nil,pending: NativeLivePendingOperation?,identities: NativeLiveTurnIdentityCoordinator,
        canonicalUserMessageIDs: Set<String>,now: Date) -> NativeLiveAssistantTurnPresentation {
        let prepare = runtime?.prepareID ?? message?.activity?.prepareId
        let binding = prepare.flatMap { identities.binding(prepareID:$0) } ?? pending.flatMap { identities.bindings[$0.id] }
        let owner = binding?.operationID.uuidString ?? pending?.id.uuidString ?? prepare ?? message?.id ?? generationOwners[id] ?? id
        let last = generationOwners[id] == owner ? previous[id] : nil
        generationOwners[id] = owner
        // Display timestamp keeps its lifecycle semantics; it never anchors elapsed time.
        let timestamp = last?.timestamp ?? runtime?.startedAt ?? binding?.authoritativeStartedAt
            ?? message?.activity?.startedAt ?? earliest(message:message,runtime:runtime) ?? message?.createdAt
        let canonicalTerminal = message.map { ["completed","error"].contains($0.status) } ?? false
        let terminal = canonicalTerminal || runtime?.foregroundTurnCompleted == true || runtime?.events.contains { ["result","error"].contains($0.event.type) } == true
        let active = runtime != nil ? !terminal : (pending != nil && message == nil)
        let timingEvents = (message?.activity?.events ?? []) + (runtime?.events ?? []) + (background?.events ?? [])
        let providerStart = last?.providerMessageStartedAt ?? timingEvents.filter {
            $0.event.type == "runtime" && $0.event.payload?["kind"]?.stringValue == "provider_message_start"
        }.min { $0.sequence < $1.sequence }?.createdAt
        let terminalAt = timingEvents.filter { ["result","error"].contains($0.event.type) }
            .min { $0.sequence < $1.sequence }?.createdAt
        let frozen = last.flatMap { $0.hasAuthoritativeDuration ? $0.duration : nil }
        let duration: Int?
        let authoritativeDuration: Bool
        if let providerStart {
            if let frozen {
                duration = frozen
                authoritativeDuration = true
            } else if active {
                duration = parse(providerStart).map { max(0,Int(now.timeIntervalSince($0))) }
                authoritativeDuration = false
            } else if let end = terminalAt.flatMap(parse) {
                duration = parse(providerStart).map { max(0,Int(end.timeIntervalSince($0))) }
                authoritativeDuration = duration != nil
            } else {
                // Completion can be observed one frame before its terminal event read.
                // Keep the prior value from the same provider-start clock without freezing it.
                duration = last?.duration
                authoritativeDuration = false
            }
        } else {
            // Only canonical terminal legacy data may use provider telemetry.
            duration = !active && canonicalTerminal ? message?.activity?.durationMs.flatMap(seconds) : nil
            authoritativeDuration = duration != nil
        }
        let foregroundActivity = runtime.map { NativeLiveTurnActivityProjection(runtimeSurface:$0,elapsed:duration) }
        let backgroundActivity = background.map { NativeLiveTurnActivityProjection(runtimeSurface:$0,elapsed:duration) }
        let durable = message.map { NativeLiveTurnActivityProjection(message:$0,elapsed:duration) }
        let knownActivity = NativeLiveTurnActivityProjection(durable:last?.activityProjection,overlay:durable,active:active,elapsed:duration)
        let foregroundOverlay = NativeLiveTurnActivityProjection(durable:knownActivity,overlay:foregroundActivity,active:active,elapsed:duration)
        let eventSources = [message?.activity?.events ?? [],runtime?.events ?? [],background?.events ?? []]
        let rawTasks = eventSources.flatMap { NativeLiveTurnActivityProjection.tasks(from:$0) }
        let rawTools = NativeLiveTurnActivityProjection.tools(from:message?.blocks ?? [])
            + eventSources.flatMap { NativeLiveTurnActivityProjection.tools(from:$0) }
        let hiddenTasks = rawTasks.filter { $0.hiddenFromTranscript || $0.isAmbient }
        var hiddenTools = Set(rawTools.filter { $0.hiddenFromTranscript || $0.hiddenFromActivity }.map(\.id) + hiddenTasks.compactMap(\.toolUseID))
        var changed = true
        while changed {
            let before = hiddenTools.count
            for tool in rawTools where hiddenTools.contains(tool.parentToolUseID ?? "") { hiddenTools.insert(tool.id) }
            changed = before != hiddenTools.count
        }
        let activity = NativeLiveTurnActivityProjection(durable:foregroundOverlay,overlay:backgroundActivity,active:active,elapsed:duration,
            suppressedTools:hiddenTools.union(rawTasks.compactMap(\.toolUseID)),suppressedTasks:Set(hiddenTasks.map(\.id)),suppressedQuestions:hiddenTools)
        let phase: NativeLiveAssistantTurnPresentation.Phase
        if activity.turnFailed || runtime?.terminalFailure != nil { phase = .failed }
        else if active && providerStart == nil { phase = .starting }
        else if activity.hasPendingInteraction { phase = .needsInput }
        else if !active && activity.hasActiveBackgroundTask { phase = .background }
        else if !active { phase = .completed }
        else if runtime == nil { phase = .starting }
        else { phase = activity.activityCount > 0 ? .working : .thinking }
        let body: NativeLiveMessagePresentation
        let canonicalBody = message.map { NativeLiveMessagePresentationProjector.project(.canonical($0),presentationNamespace:id) }
        if let canonicalBody, !canonicalBody.nodes.isEmpty { body = canonicalBody }
        else if let text = logicalRuntimeText(runtime,terminal:terminal), !text.isEmpty { body = NativeLiveMessagePresentationProjector.project(.streaming(text),presentationNamespace:id) }
        else if let last { body = last.bodyPresentation }
        else { body = NativeLiveMessagePresentationProjector.project(.streaming(""),presentationNamespace:id) }
        let header = header(phase:phase,duration:duration,count:activity.activityCount)
        let canonicalParentUserMessageID = message?.parentMessageId.flatMap {
            canonicalUserMessageIDs.contains($0) ? $0 : nil
        }
        var turn = NativeLiveAssistantTurnPresentation(stableID:id,canonicalMessageID:message?.id,prepareID:prepare,requestID:runtime?.requestID ?? binding?.requestID,
            parentUserMessageID:canonicalParentUserMessageID ?? runtime?.userMessageID ?? binding?.userMessageID,
            phase:phase,timestamp:timestamp,bodyPresentation:body,activityProjection:activity,duration:duration,header:header,failure:phase == .failed ? "Failed" : nil)
        turn.murmurText = message?.blocks
            .first(where: { $0.kind == "murmur" })?
            .text?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if turn.murmurText?.isEmpty == true {
            turn.murmurText = nil
        }
        turn.visibleThinking = NativeLiveVisibleThinkingProjector.project(
            eventSources: eventSources, previous: last?.visibleThinking ?? [])
        turn.providerMessageStartedAt = providerStart
        turn.hasAuthoritativeDuration = authoritativeDuration
        previous[id] = turn
        return turn
    }
    private func logicalRuntimeText(_ runtime: NativeLiveRuntimeSurfaceState?,terminal: Bool) -> String? {
        guard let runtime else { return nil }
        if terminal {
            let final = runtime.events.filter { $0.event.type == "text" }
                .compactMap { $0.event.payload?["text"]?.stringValue }
                .joined(separator:"\n\n")
            let visible = murmurStrippedRuntimeText(final)
            if !visible.isEmpty { return visible }
        }
        return murmurStrippedRuntimeText(runtime.streamingText)
    }

    private func murmurStrippedRuntimeText(_ value: String) -> String {
        var result = value
        while let open = result.range(
            of: "<murmur>",
            options: .caseInsensitive
        ) {
            guard let close = result.range(
                of: "</murmur>",
                options: .caseInsensitive,
                range: open.upperBound..<result.endIndex
            ) else {
                result.removeSubrange(open.lowerBound..<result.endIndex)
                break
            }
            result.removeSubrange(open.lowerBound..<close.upperBound)
        }
        while let close = result.range(
            of: "</murmur>",
            options: .caseInsensitive
        ) {
            result.removeSubrange(close)
        }
        if let marker = result.lastIndex(of: "<") {
            let suffix = String(result[marker...]).lowercased()
            if "<murmur>".hasPrefix(suffix)
                || "</murmur>".hasPrefix(suffix) {
                result.removeSubrange(marker..<result.endIndex)
            }
        }
        return result.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
    }
    private func header(phase: NativeLiveAssistantTurnPresentation.Phase,duration: Int?,count: Int) -> String {
        if phase == .starting { return "Thinking…" }
        let base: String
        switch phase {
        case .thinking: base = "Thinking"
        case .working,.needsInput: base = "Working"
        case .completed: base = count == 0 ? "Thought" : "Worked"
        case .failed: base = "Worked"
        case .background: base = "Working in background"
        case .starting: base = "Thinking…"
        }
        if phase == .completed && count == 0 && duration == nil { return "" }
        var parts = [base + (phase != .background ? duration.map { " for \($0)s" } ?? "" : "")]
        if count > 0 { parts.append(count == 1 ? "1 step" : "\(count) steps") }
        if phase == .needsInput { parts.append("Needs input") }
        if phase == .failed { parts.append("Failed") }
        return parts.joined(separator:" · ")
    }
    private func earliest(message: NativeLiveCurrentPathMessage?,runtime: NativeLiveRuntimeSurfaceState?) -> String? {
        let dates = (runtime?.events ?? message?.activity?.events ?? []).map(\.createdAt)
            + (runtime?.interactions ?? message?.activity?.interactions ?? []).map(\.createdAt)
        return dates.compactMap { value in parse(value).map { (value,$0) } }.min { $0.1 < $1.1 }?.0
    }
    private func seconds(_ value: Double) -> Int? { guard value.isFinite,value >= 0,value/1000 < Double(Int.max) else { return nil }; return max(1,Int((value/1000).rounded())) }
    private func parse(_ value: String) -> Date? { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime,.withFractionalSeconds]; return f.date(from:value) ?? ISO8601DateFormatter().date(from:value) }
}
