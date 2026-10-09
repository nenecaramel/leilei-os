import SwiftUI

struct ContextEnvironmentSection: View {
    let metadata: NativeLiveRuntimeMetadata?
    let hasLoadedRuntimeMetadata: Bool

    var body: some View {
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
                                                ContextOverviewFormat.normalized(server.name),
                                                ContextOverviewFormat.normalized(server.status),
                                                ContextOverviewFormat.normalized(server.source)
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
                                            ContextOverviewFormat.normalized(plugin.name)
                                                ?? ContextOverviewFormat.normalized(plugin.path)
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
                                                ContextOverviewFormat.normalized(error.plugin)
                                                    ?? ContextOverviewFormat.normalized(error.path),
                                                ContextOverviewFormat.normalized(error.type),
                                                ContextOverviewFormat.normalized(error.message)
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
    }

    @ViewBuilder
    private func environmentRow(
        _ label: String,
        _ value: String?
    ) -> some View {
        if let value = ContextOverviewFormat.normalized(value) {
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
        if let value = ContextOverviewFormat.normalized(value) {
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
            values.compactMap(ContextOverviewFormat.normalized)
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
        let state = ContextOverviewFormat.normalized(fastMode.state)
        let disabledReason =
            ContextOverviewFormat.normalized(fastMode.disabledReason)
        if let state, let disabledReason {
            return "\(state) · \(disabledReason)"
        }
        return state ?? disabledReason
    }

}
