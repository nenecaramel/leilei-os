import SwiftUI

struct ProjectsView: View {
    @State private var query = ""
    @State private var showingWorkspacePicker = false

    var body: some View {
        List {
            Section("Workspace") {
                Button {
                    showingWorkspacePicker = true
                } label: {
                    LabeledContent {
                        Text("Not connected")
                            .foregroundStyle(.secondary)
                    } label: {
                        Label(
                            "Workspace",
                            systemImage: "externaldrive"
                        )
                    }
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
        .searchable(text: $query, prompt: "Search")
        .sheet(isPresented: $showingWorkspacePicker) {
            WorkspacePickerSheet()
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Projects")
                    .font(.headline)
            }

            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        showingWorkspacePicker = true
                    } label: {
                        Label(
                            "Workspace",
                            systemImage: "externaldrive"
                        )
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 18, weight: .medium))
                }
                .accessibilityLabel("Project options")
            }

            if #available(iOS 26.0, *) {
                DefaultToolbarItem(
                    kind: .search,
                    placement: .bottomBar
                )
            }
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
                Section("Context") {
                    LabeledContent("Usage") {
                        Text(usageText)
                            .foregroundStyle(.secondary)
                    }

                    LabeledContent("Tokens") {
                        Text(tokensText)
                            .foregroundStyle(.secondary)
                    }

                    LabeledContent("Model") {
                        Text(modelText)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Compaction") {
                    LabeledContent("Status") {
                        Text(compactionStatusText)
                            .foregroundStyle(.secondary)
                    }

                    LabeledContent("Threshold") {
                        Text(compactionThresholdText)
                            .foregroundStyle(.secondary)
                    }

                    LabeledContent("Last Event") {
                        Text(lastCompactionEventText)
                            .foregroundStyle(.secondary)
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

    private var usageText: String {
        guard let percentage = metadata?.contextUsage?.percentage else {
            return "—"
        }
        return percentText(percentage)
    }

    private var tokensText: String {
        guard let total = metadata?.contextUsage?.totalTokens else {
            return "—"
        }
        let totalText = integerText(total)
        guard let maximum = metadata?.contextUsage?.maxTokens else {
            return totalText
        }
        return "\(totalText) / \(integerText(maximum))"
    }

    private var modelText: String {
        let raw =
            metadata?.contextUsage?.model
            ?? metadata?.execution?.readback.applied.model
        guard let raw, !raw.isEmpty else { return "—" }
        return NativeLiveClaudeModel(rawValue: raw)?.displayName ?? raw
    }

    private var compactionStatusText: String {
        if let compaction = metadata?.compaction, compaction.attempted {
            return compactionOutcomeTitle(compaction.outcome)
        }
        if let advisory = metadata?.compactionAdvisory {
            return advisory.due ? "Due" : "Not Due"
        }
        return "—"
    }

    private var compactionThresholdText: String {
        guard let threshold = metadata?.compactionAdvisory?.thresholdPercent else {
            return "—"
        }
        return percentText(threshold)
    }

    private var lastCompactionEventText: String {
        guard let compaction = metadata?.compaction else {
            return "—"
        }
        if let summary = compaction.summary?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !summary.isEmpty {
            return summary
        }
        return compactionOutcomeTitle(compaction.outcome)
    }

    private func compactionOutcomeTitle(_ outcome: String) -> String {
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

    private func percentText(_ value: Double) -> String {
        "\(Int(value.rounded()))%"
    }

    private func integerText(_ value: Double) -> String {
        Int(value.rounded()).formatted()
    }
}
