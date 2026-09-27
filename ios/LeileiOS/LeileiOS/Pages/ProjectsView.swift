import SwiftUI

struct ProjectsView: View {
    @State private var showingWorkspacePicker = false

    var body: some View {
        List {
            Section("Workspace") {
                Button {
                    showingWorkspacePicker = true
                } label: {
                    Label(
                        "Workspace",
                        systemImage: "externaldrive"
                    )
                }
                .foregroundStyle(.primary)
            }

            Section("Projects") {
                AppStateSurface(title: "Nothing here")
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color(.systemBackground))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color(.systemBackground))
        .sheet(isPresented: $showingWorkspacePicker) {
            WorkspacePickerSheet()
        }

    }
}


struct ProjectDetailView: View {
    let name: String

    var body: some View {
        List {
            Section {
                NavigationLink {
                    ProjectFilesView()
                } label: {
                    Label("Files", systemImage: "folder")
                }

                NavigationLink {
                    ProjectConversationsView()
                } label: {
                    Label(
                        "Conversations",
                        systemImage: "bubble.left.and.bubble.right"
                    )
                }
            }

            Section("Claude") {
                ForEach(ProjectClaudePage.allCases) { page in
                    NavigationLink {
                        ProjectClaudePageView(page: page)
                    } label: {
                        Label(page.title, systemImage: page.systemImage)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
    }
}


private enum ProjectClaudePage: String, CaseIterable, Identifiable {
    case instructions
    case settings
    case skills
    case agents
    case mcp
    case hooks
    case plugins

    var id: String { rawValue }

    var title: String {
        switch self {
        case .instructions:
            "Instructions"
        case .settings:
            "Settings"
        case .skills:
            "Skills"
        case .agents:
            "Agents"
        case .mcp:
            "MCP"
        case .hooks:
            "Hooks"
        case .plugins:
            "Plugins"
        }
    }

    var systemImage: String {
        switch self {
        case .instructions:
            "doc.text"
        case .settings:
            "slider.horizontal.3"
        case .skills:
            "lightbulb"
        case .agents:
            "person.2"
        case .mcp:
            "network"
        case .hooks:
            "link"
        case .plugins:
            "puzzlepiece.extension"
        }
    }
}


private struct ProjectClaudePageView: View {
    let page: ProjectClaudePage

    var body: some View {
        AppStateSurface(title: "Nothing here")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.settingsBackground)
            .navigationTitle(page.title)
            .navigationBarTitleDisplayMode(.inline)
    }
}


private struct ProjectFilesView: View {
    var body: some View {
        AppStateSurface(title: "Nothing here")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemBackground))
            .navigationTitle("Files")
            .navigationBarTitleDisplayMode(.inline)
    }
}


private struct ProjectConversationsView: View {
    var body: some View {
        AppStateSurface(title: "Nothing here")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemBackground))
            .navigationTitle("Conversations")
            .navigationBarTitleDisplayMode(.inline)
    }
}


struct WorkspacePickerSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            AppStateSurface(title: "Nothing here")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.settingsBackground)
                .navigationTitle("Workspace")
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
    }
}


struct ProjectPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String

    var body: some View {
        NavigationStack {
            AppStateSurface(title: "Nothing here")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.settingsBackground)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            dismiss()
                        }
                    }
                }
        }
        .background(Color.settingsBackground)
    }
}


struct ProjectFilePickerSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            AppStateSurface(title: "Nothing here")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.settingsBackground)
                .navigationTitle("Project File")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            dismiss()
                        }
                    }
                }
        }
        .background(Color.settingsBackground)
    }
}


struct ContextOverviewSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        NavigationStack {
            Form {
                if metadata == nil {
                    Section {
                        VStack(spacing: 12) {
                            Image(systemName: "chart.bar")
                                .font(.system(
                                    size: 24,
                                    weight: .light
                                ))
                                .foregroundStyle(.secondary)

                            Text("No runtime context observed yet")
                                .font(.body)

                            Text(
                                "Context becomes available after this app observes a completed Native Live turn."
                            )
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        }
                        .frame(
                            maxWidth: .infinity,
                            minHeight: 150
                        )
                    }
                } else {
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
                    } footer: {
                        Text(
                            "Latest runtime metadata observed in this app session."
                        )
                    }

                    Section("Compaction") {
                        LabeledContent("Status") {
                            Label(
                                compactionStatusText,
                                systemImage: compactionStatusSymbol
                            )
                            .foregroundStyle(.secondary)
                        }

                        if let advisory = metadata?.compactionAdvisory {
                            VStack(alignment: .leading, spacing: 9) {
                                HStack {
                                    Text("Observed")
                                    Spacer()
                                    Text(
                                        advisory.observedPercent
                                            .map(percentText)
                                            ?? "—"
                                    )
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                                }

                                HStack {
                                    Text("Threshold")
                                    Spacer()
                                    Text(
                                        percentText(
                                            advisory.thresholdPercent
                                        )
                                    )
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                                }

                                if let observed =
                                    advisory.observedPercent {
                                    ProgressView(
                                        value:
                                            clampedProgress(
                                                observed
                                            )
                                    )
                                    .progressViewStyle(.linear)
                                }

                                Text(advisory.reason)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 2)
                        }

                        if let compaction = metadata?.compaction {
                            LabeledContent("Outcome") {
                                Text(
                                    compactionOutcomeTitle(
                                        compaction.outcome
                                    )
                                )
                                .foregroundStyle(.secondary)
                            }

                            LabeledContent("Source") {
                                Text(compaction.source)
                                    .foregroundStyle(.secondary)
                            }

                            if let summary =
                                normalized(compaction.summary) {
                                VStack(
                                    alignment: .leading,
                                    spacing: 5
                                ) {
                                    Text("Summary")
                                        .font(.subheadline)
                                    Text(summary)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                        .textSelection(.enabled)
                                }
                            }

                            if let failureCode =
                                normalized(
                                    compaction.failureCode
                                ) {
                                LabeledContent("Failure") {
                                    Text(failureCode)
                                        .foregroundStyle(.secondary)
                                        .textSelection(.enabled)
                                }
                            }
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

    private var compactionStatusText: String {
        if let compaction = metadata?.compaction,
           compaction.attempted {
            return compactionOutcomeTitle(
                compaction.outcome
            )
        }

        if let advisory =
            metadata?.compactionAdvisory {
            return advisory.due
                ? "Due"
                : "Not Due"
        }

        return "—"
    }

    private var compactionStatusSymbol: String {
        if metadata?.compactionAdvisory?.due == true {
            return "exclamationmark.circle"
        }

        if metadata?.compaction?.outcome == "failed" {
            return "exclamationmark.triangle"
        }

        if metadata?.compaction?.outcome == "succeeded" {
            return "checkmark.circle"
        }

        return "circle"
    }

    private func compactionOutcomeTitle(
        _ outcome: String
    ) -> String {
        switch outcome {
        case "not_due":
            return "Not Due"
        case "succeeded":
            return "Succeeded"
        case "failed":
            return "Failed"
        case "unsupported":
            return "Unsupported"
        default:
            return outcome
        }
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
