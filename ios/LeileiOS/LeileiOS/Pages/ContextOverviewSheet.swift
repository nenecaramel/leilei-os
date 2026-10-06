import SwiftUI

struct ContextOverviewSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appModel: AppModel
    @State private var isCompacting = false
    @State private var compactError: String?
    @State private var hasLoadedRuntimeMetadata = false

    var body: some View {
        NavigationStack {
            Form {
                    Section {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text("Usage")
                                Spacer()
                                Text(usageText)
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                            }

                            ProgressView(value: usageProgress)
                                .progressViewStyle(.linear)

                            HStack {
                                Text(tokensText)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()

                                Spacer()

                                if let remainingText {
                                    Text(remainingText)
                                        .font(.footnote)
                                        .foregroundStyle(.tertiary)
                                        .monospacedDigit()
                                }
                            }
                        }
                        .padding(.vertical, 4)

                        LabeledContent("Model") {
                            Text(modelText)
                                .foregroundStyle(.secondary)
                        }

                        LabeledContent("Effort") {
                            Text(effortText)
                                .foregroundStyle(.secondary)
                        }

                        if let rawLimitText {
                            LabeledContent("Provider Limit") {
                                Text(rawLimitText)
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                            }
                        }
                    } header: {
                        Text("Context")
                    }


                    Section("Manual Compact") {
                        Button {
                            Task {
                                await compactContext()
                            }
                        } label: {
                            HStack(spacing: 10) {
                                if isCompacting {
                                    ProgressView()
                                        .controlSize(.small)
                                }
                                Text(
                                    isCompacting
                                        ? "Compacting…"
                                        : "Compact Context"
                                )
                            }
                        }
                        .disabled(
                            isCompacting
                            || appModel.chatSendState != .idle
                            || appModel.activeNativeLiveConversationID == nil
                        )

                        Text(
                            "Compresses the current Claude context without changing canonical chat history."
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                        if let compactError {
                            Text(compactError)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }

                    if let environment =
                        metadata?.environment {
                        Section("Session Environment") {
                            environmentRow(
                                "Runtime Model",
                                environment.model
                            )
                            environmentBlockRow(
                                "Working Directory",
                                environment.cwd
                            )
                            environmentRow(
                                "Permission",
                                environment.permissionMode
                            )
                            environmentRow(
                                "Claude Code",
                                environment.claudeCodeVersion
                            )
                            environmentRow(
                                "Agent SDK",
                                environment.sdkVersion
                            )
                            environmentRow(
                                "Auth Source",
                                environment.apiKeySource
                            )
                            environmentRow(
                                "Output Style",
                                environment.outputStyle
                            )

                            if !environment.mcpServers.isEmpty {
                                environmentBlockRow(
                                    "MCP",
                                    environment.mcpServers
                                        .map { server in
                                            [
                                                normalized(server.name),
                                                normalized(server.status),
                                                normalized(server.source)
                                            ]
                                            .compactMap { $0 }
                                            .joined(separator: " · ")
                                        }
                                        .filter { !$0.isEmpty }
                                        .joined(separator: "\n")
                                )
                            }

                            environmentListRow(
                                "Tools",
                                environment.tools
                            )
                            environmentListRow(
                                "Skills",
                                environment.skills
                            )
                            environmentListRow(
                                "Agents",
                                environment.agents
                            )
                            environmentListRow(
                                "Commands",
                                environment.slashCommands
                                    + environment.terminalSlashCommands
                            )
                            environmentListRow(
                                "Betas",
                                environment.betas
                            )
                            environmentListRow(
                                "Capabilities",
                                environment.capabilities
                            )
                            environmentRow(
                                "Init Effort",
                                environment.effort
                            )

                            if !environment.plugins.isEmpty {
                                environmentBlockRow(
                                    "Plugins",
                                    environment.plugins
                                        .map { plugin in
                                            normalized(plugin.name)
                                                ?? normalized(plugin.path)
                                                ?? "Unknown"
                                        }
                                        .joined(separator: "\n")
                                )
                            }

                            if !environment.pluginErrors.isEmpty {
                                environmentBlockRow(
                                    "Plugin Errors",
                                    environment.pluginErrors
                                        .map { error in
                                            [
                                                normalized(error.plugin)
                                                    ?? normalized(error.path),
                                                normalized(error.type),
                                                normalized(error.message)
                                            ]
                                            .compactMap { $0 }
                                            .joined(separator: " · ")
                                        }
                                        .filter { !$0.isEmpty }
                                        .joined(separator: "\n")
                                )
                            }

                            if let fastModeText =
                                fastModeText(environment.fastMode) {
                                environmentRow(
                                    "Fast Mode",
                                    fastModeText
                                )
                            }
                        }
                    } else if !hasLoadedRuntimeMetadata {
                        Section("Session Environment") {
                            environmentRow(
                                "Runtime Model",
                                "—"
                            )
                            environmentBlockRow(
                                "Working Directory",
                                "—"
                            )
                            environmentRow(
                                "Permission",
                                "—"
                            )
                            environmentRow(
                                "Claude Code",
                                "—"
                            )
                            environmentRow(
                                "Agent SDK",
                                "—"
                            )
                        }
                    }


                    if let readbackError =
                        normalized(
                            metadata?.execution?.readbackError
                        ) {
                        Section("Execution Readback") {
                            Text(readbackError)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Color.settingsBackground)
            .navigationTitle("Context")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .background(Color.settingsBackground)
        .task {
            hasLoadedRuntimeMetadata =
                await appModel.refreshActiveNativeLiveRuntimeMetadata()
        }
    }

    @MainActor
    private func compactContext() async {
        guard !isCompacting,
              let conversationID =
                appModel.activeNativeLiveConversationID else {
            return
        }

        isCompacting = true
        compactError = nil
        defer {
            isCompacting = false
        }

        do {
            var request =
                try await appModel.api.createNativeLiveManualCompact(
                    conversationID: conversationID
                )

            for _ in 0..<80 {
                switch request.status {
                case .completed:
                    await appModel
                        .refreshActiveNativeLiveRuntimeMetadata()
                    return

                case .failed, .stale, .expired:
                    compactError =
                        request.failureCode
                        ?? manualCompactStatusText(request.status)
                    return

                case .pending, .reserved:
                    try await Task.sleep(
                        for: .milliseconds(500)
                    )
                    request =
                        try await appModel.api.nativeLiveManualCompact(
                            requestID: request.id
                        )
                }
            }

            compactError = "Manual compact timed out."
        } catch {
            compactError = error.localizedDescription
        }
    }

    private func manualCompactStatusText(
        _ status: NativeLiveManualCompactStatus
    ) -> String {
        switch status {
        case .failed:
            return "Manual compact failed."
        case .stale:
            return "Conversation changed before compact could be saved."
        case .expired:
            return "Manual compact expired before the Mac runtime reserved it."
        case .pending, .reserved, .completed:
            return "Manual compact did not complete."
        }
    }

    private var metadata: NativeLiveRuntimeMetadata? {
        appModel.nativeLiveRuntimeMetadata
    }

    private var usageProgress: Double {
        clampedProgress(
            metadata?.contextUsage?.percentage ?? 0
        )
    }

    private var usageText: String {
        guard let percentage =
            metadata?.contextUsage?.percentage else {
            return "—"
        }
        return percentText(percentage)
    }

    private var tokensText: String {
        guard let total =
            metadata?.contextUsage?.totalTokens else {
            return "—"
        }

        let totalText = integerText(total)
        guard let maximum =
            metadata?.contextUsage?.maxTokens else {
            return totalText
        }

        return "\(totalText) / \(integerText(maximum)) tokens"
    }

    private var remainingText: String? {
        guard let total =
                metadata?.contextUsage?.totalTokens,
              let maximum =
                metadata?.contextUsage?.maxTokens,
              maximum >= total else {
            return nil
        }

        return "\(integerText(maximum - total)) left"
    }

    private var rawLimitText: String? {
        guard let raw =
                metadata?.contextUsage?.rawMaxTokens,
              raw > 0 else {
            return nil
        }

        if let effective =
            metadata?.contextUsage?.maxTokens,
           abs(raw - effective) < 0.5 {
            return nil
        }

        return "\(integerText(raw)) tokens"
    }

    private var modelText: String {
        let raw =
            metadata?.contextUsage?.model
            ?? metadata?.execution?.readback.applied.model

        guard let raw,
              !raw.isEmpty else {
            return "—"
        }

        return NativeLiveClaudeModel(
            rawValue: raw
        )?.displayName ?? raw
    }

    private var effortText: String {
        guard let raw =
            metadata?.execution?.readback.applied.effort,
              !raw.isEmpty else {
            return "—"
        }

        return NativeLiveEffortLevel(
            rawValue: raw
        )?.displayName ?? raw
    }

    @ViewBuilder
    private func environmentRow(
        _ label: String,
        _ value: String?
    ) -> some View {
        if let value = normalized(value) {
            LabeledContent(label) {
                Text(value)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.trailing)
                    .textSelection(.enabled)
            }
        }
    }

    @ViewBuilder
    private func environmentBlockRow(
        _ label: String,
        _ value: String?
    ) -> some View {
        if let value = normalized(value) {
            VStack(alignment: .leading, spacing: 6) {
                Text(label)

                Text(value)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
                    .textSelection(.enabled)
                    .frame(
                        maxWidth: .infinity,
                        alignment: .leading
                    )
            }
            .padding(.vertical, 2)
        }
    }

    @ViewBuilder
    private func environmentListRow(
        _ label: String,
        _ values: [String]
    ) -> some View {
        let normalizedValues =
            values.compactMap(normalized)
        if !normalizedValues.isEmpty {
            environmentBlockRow(
                label,
                normalizedValues.joined(separator: " · ")
            )
        }
    }

    private func fastModeText(
        _ fastMode: NativeLiveRuntimeEnvironmentFastMode?
    ) -> String? {
        guard let fastMode else { return nil }
        let state = normalized(fastMode.state)
        let disabledReason =
            normalized(fastMode.disabledReason)
        if let state, let disabledReason {
            return "\(state) · \(disabledReason)"
        }
        return state ?? disabledReason
    }

    private func clampedProgress(
        _ percentage: Double
    ) -> Double {
        min(
            max(
                percentage / 100,
                0
            ),
            1
        )
    }

    private func percentText(
        _ value: Double
    ) -> String {
        "\(Int(value.rounded()))%"
    }

    private func integerText(
        _ value: Double
    ) -> String {
        Int(value.rounded()).formatted()
    }

    private func normalized(
        _ value: String?
    ) -> String? {
        guard let value else {
            return nil
        }

        let trimmed = value.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return trimmed.isEmpty
            ? nil
            : trimmed
    }
}
