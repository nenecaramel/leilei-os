import SwiftUI

struct ProjectsView: View {
    @EnvironmentObject private var appModel: AppModel

    @State private var workspaces: [ProjectWorkspaceSummary] = []
    @State private var projects: [ProjectSummary] = []
    @State private var loading = false
    @State private var failed = false
    @State private var showingWorkspacePicker = false
    @State private var showingNewWorkspace = false
    @State private var showingNewProject = false
    @State private var reloadToken = UUID()

    var body: some View {
        Group {
            if loading && workspaces.isEmpty && projects.isEmpty {
                ProgressView()
                    .controlSize(.small)
                    .frame(
                        maxWidth: .infinity,
                        maxHeight: .infinity
                    )
            } else if failed && workspaces.isEmpty && projects.isEmpty {
                AppStateSurface(
                    title: "Unavailable",
                    actionTitle: "Retry"
                ) {
                    reloadToken = UUID()
                }
            } else {
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
                        if projects.isEmpty {
                            AppStateSurface(title: "Nothing here")
                                .frame(maxWidth: .infinity)
                                .listRowBackground(
                                    Color(.systemBackground)
                                )
                        } else {
                            ForEach(projects) { project in
                                NavigationLink {
                                    ProjectDetailView(
                                        project: project
                                    )
                                } label: {
                                    VStack(
                                        alignment: .leading,
                                        spacing: 4
                                    ) {
                                        Text(project.name)
                                            .foregroundStyle(.primary)

                                        if let description =
                                            normalizedProjectText(
                                                project.description
                                            ) {
                                            Text(description)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .lineLimit(1)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(Color(.systemBackground))
                .refreshable {
                    await reload()
                }
            }
        }
        .background(Color(.systemBackground))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("New Project") {
                        showingNewProject = true
                    }
                    .disabled(workspaces.isEmpty)

                    Button("New Workspace") {
                        showingNewWorkspace = true
                    }
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add")
            }
        }
        .sheet(isPresented: $showingWorkspacePicker) {
            WorkspacePickerSheet()
                .environmentObject(appModel)
        }
        .sheet(isPresented: $showingNewWorkspace) {
            WorkspaceCreateSheet {
                reloadToken = UUID()
            }
            .environmentObject(appModel)
        }
        .sheet(isPresented: $showingNewProject) {
            ProjectCreateSheet(
                workspaces: workspaces
            ) {
                reloadToken = UUID()
            }
            .environmentObject(appModel)
        }
        .task(id: reloadToken) {
            await reload()
        }
    }

    @MainActor
    private func reload() async {
        guard !loading else { return }
        loading = true
        failed = false
        defer { loading = false }

        do {
            async let loadedWorkspaces =
                appModel.api.projectWorkspaces()
            async let loadedProjects =
                appModel.api.projects()

            workspaces = try await loadedWorkspaces
            projects = try await loadedProjects
        } catch {
            failed = true
        }
    }
}

struct ProjectDetailView: View {
    let project: ProjectSummary

    var body: some View {
        List {
            Section {
                NavigationLink {
                    ProjectResourceListView(
                        project: project,
                        kind: .file,
                        title: "Files"
                    )
                } label: {
                    Label("Files", systemImage: "folder")
                }

                NavigationLink {
                    ProjectConversationsView(
                        project: project
                    )
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
                        ProjectResourceListView(
                            project: project,
                            kind: page.resourceKind,
                            title: page.title
                        )
                    } label: {
                        Label(
                            page.title,
                            systemImage: page.systemImage
                        )
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
        .navigationTitle(project.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private enum ProjectClaudePage:
    String,
    CaseIterable,
    Identifiable {
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
            return "Instructions"
        case .settings:
            return "Settings"
        case .skills:
            return "Skills"
        case .agents:
            return "Agents"
        case .mcp:
            return "MCP"
        case .hooks:
            return "Hooks"
        case .plugins:
            return "Plugins"
        }
    }

    var systemImage: String {
        switch self {
        case .instructions:
            return "doc.text"
        case .settings:
            return "slider.horizontal.3"
        case .skills:
            return "lightbulb"
        case .agents:
            return "person.2"
        case .mcp:
            return "network"
        case .hooks:
            return "link"
        case .plugins:
            return "puzzlepiece.extension"
        }
    }

    var resourceKind: ProjectResourceKind {
        switch self {
        case .instructions:
            return .instructions
        case .settings:
            return .settings
        case .skills:
            return .skill
        case .agents:
            return .agent
        case .mcp:
            return .mcp
        case .hooks:
            return .hook
        case .plugins:
            return .plugin
        }
    }
}

private struct ProjectResourceListView: View {
    @EnvironmentObject private var appModel: AppModel

    let project: ProjectSummary
    let kind: ProjectResourceKind
    let title: String

    @State private var resources: [ProjectResourceSummary] = []
    @State private var loading = false
    @State private var failed = false

    var body: some View {
        Group {
            if loading && resources.isEmpty {
                ProgressView()
                    .controlSize(.small)
                    .frame(
                        maxWidth: .infinity,
                        maxHeight: .infinity
                    )
            } else if failed && resources.isEmpty {
                AppStateSurface(
                    title: "Unavailable",
                    actionTitle: "Retry"
                ) {
                    Task {
                        await reload()
                    }
                }
            } else if resources.isEmpty {
                AppStateSurface(title: "Nothing here")
            } else {
                List(resources) { resource in
                    NavigationLink {
                        ProjectResourceDetailView(
                            project: project,
                            summary: resource
                        )
                    } label: {
                        VStack(
                            alignment: .leading,
                            spacing: 4
                        ) {
                            Text(
                                normalizedProjectText(
                                    resource.title
                                )
                                ?? resource.key
                            )
                            .foregroundStyle(.primary)
                            .lineLimit(1)

                            if resource.title != nil {
                                Text(resource.key)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .background(Color.settingsBackground)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await reload()
        }
        .refreshable {
            await reload()
        }
    }

    @MainActor
    private func reload() async {
        guard !loading else { return }
        loading = true
        failed = false
        defer { loading = false }

        do {
            resources = try await appModel.api.projectResources(
                projectID: project.id,
                kind: kind
            )
        } catch {
            failed = true
        }
    }
}

private struct ProjectResourceDetailView: View {
    @EnvironmentObject private var appModel: AppModel

    let project: ProjectSummary
    let summary: ProjectResourceSummary

    @State private var resource: ProjectResource?
    @State private var failed = false

    var body: some View {
        Form {
            if let resource {
                Section {
                    LabeledContent(
                        "Type",
                        value: resource.kind.rawValue.capitalized
                    )
                    LabeledContent(
                        "Key",
                        value: resource.key
                    )
                    if let title =
                        normalizedProjectText(resource.title) {
                        LabeledContent(
                            "Title",
                            value: title
                        )
                    }
                }

                if let content =
                    normalizedProjectText(resource.content) {
                    Section("Content") {
                        Text(content)
                            .textSelection(.enabled)
                    }
                }
            } else if failed {
                Section {
                    AppStateSurface(
                        title: "Unavailable",
                        actionTitle: "Retry"
                    ) {
                        Task {
                            await load()
                        }
                    }
                }
            } else {
                Section {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
        .navigationTitle(
            normalizedProjectText(summary.title)
                ?? summary.key
        )
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await load()
        }
    }

    @MainActor
    private func load() async {
        failed = false
        do {
            resource = try await appModel.api.projectResource(
                projectID: project.id,
                resourceID: summary.id
            )
        } catch {
            failed = true
        }
    }
}

private struct ProjectConversationsView: View {
    @EnvironmentObject private var appModel: AppModel

    let project: ProjectSummary

    @State private var conversations:
        [ProjectConversationSummary] = []
    @State private var loading = false
    @State private var failed = false

    var body: some View {
        Group {
            if loading && conversations.isEmpty {
                ProgressView()
                    .controlSize(.small)
                    .frame(
                        maxWidth: .infinity,
                        maxHeight: .infinity
                    )
            } else if failed && conversations.isEmpty {
                AppStateSurface(
                    title: "Unavailable",
                    actionTitle: "Retry"
                ) {
                    Task {
                        await reload()
                    }
                }
            } else if conversations.isEmpty {
                AppStateSurface(title: "Nothing here")
            } else {
                List {
                    ForEach(conversations) { conversation in
                        VStack(
                            alignment: .leading,
                            spacing: 4
                        ) {
                            Text(
                                normalizedProjectText(
                                    conversation.title
                                )
                                ?? "New Conversation"
                            )
                            .foregroundStyle(.primary)
                            .lineLimit(1)

                            HStack(spacing: 8) {
                                Text(
                                    conversation.lifecycleStatus
                                        .capitalized
                                )
                                if let date =
                                    projectDateText(
                                        conversation.lastMessageAt
                                    ) {
                                    Text(date)
                                }
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        .swipeActions {
                            Button(
                                "Remove",
                                role: .destructive
                            ) {
                                Task {
                                    await detach(conversation)
                                }
                            }
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .background(Color(.systemBackground))
        .navigationTitle("Conversations")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await reload()
        }
        .refreshable {
            await reload()
        }
    }

    @MainActor
    private func reload() async {
        guard !loading else { return }
        loading = true
        failed = false
        defer { loading = false }

        do {
            conversations =
                try await appModel.api.projectConversations(
                    projectID: project.id
                )
        } catch {
            failed = true
        }
    }

    @MainActor
    private func detach(
        _ conversation: ProjectConversationSummary
    ) async {
        guard let conversationID =
            UUID(uuidString: conversation.conversationId) else {
            return
        }

        do {
            _ = try await appModel.api.detachConversationFromProject(
                projectID: project.id,
                conversationID: conversationID
            )
            await reload()
        } catch {
            return
        }
    }
}

struct WorkspacePickerSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var workspaces: [ProjectWorkspaceSummary] = []
    @State private var projects: [ProjectSummary] = []
    @State private var loading = false
    @State private var failed = false

    var body: some View {
        NavigationStack {
            Group {
                if loading && workspaces.isEmpty {
                    ProgressView()
                } else if failed && workspaces.isEmpty {
                    AppStateSurface(
                        title: "Unavailable",
                        actionTitle: "Retry"
                    ) {
                        Task {
                            await reload()
                        }
                    }
                } else if workspaces.isEmpty {
                    AppStateSurface(title: "Nothing here")
                } else {
                    List {
                        ForEach(workspaces) { workspace in
                            Section(workspace.name) {
                                let matches = projects.filter {
                                    $0.workspaceId == workspace.id
                                }

                                if matches.isEmpty {
                                    AppStateSurface(
                                        title: "Nothing here"
                                    )
                                    .frame(maxWidth: .infinity)
                                } else {
                                    ForEach(matches) { project in
                                        NavigationLink {
                                            ProjectDetailView(
                                                project: project
                                            )
                                        } label: {
                                            Text(project.name)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                    .scrollContentBackground(.hidden)
                }
            }
            .background(Color.settingsBackground)
            .navigationTitle("Workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(
                    placement: .confirmationAction
                ) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .task {
                await reload()
            }
        }
        .background(Color.settingsBackground)
    }

    @MainActor
    private func reload() async {
        guard !loading else { return }
        loading = true
        failed = false
        defer { loading = false }

        do {
            async let loadedWorkspaces =
                appModel.api.projectWorkspaces()
            async let loadedProjects =
                appModel.api.projects()
            workspaces = try await loadedWorkspaces
            projects = try await loadedProjects
        } catch {
            failed = true
        }
    }
}

struct ProjectPickerSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    let title: String
    let conversationID: UUID?

    @State private var projects: [ProjectSummary] = []
    @State private var loading = false
    @State private var failed = false
    @State private var attachingProjectID: String?

    init(
        title: String,
        conversationID: UUID? = nil
    ) {
        self.title = title
        self.conversationID = conversationID
    }

    var body: some View {
        NavigationStack {
            Group {
                if loading && projects.isEmpty {
                    ProgressView()
                } else if failed && projects.isEmpty {
                    AppStateSurface(
                        title: "Unavailable",
                        actionTitle: "Retry"
                    ) {
                        Task {
                            await reload()
                        }
                    }
                } else if projects.isEmpty {
                    AppStateSurface(title: "Nothing here")
                } else {
                    List(projects) { project in
                        Button {
                            Task {
                                await select(project)
                            }
                        } label: {
                            HStack {
                                Text(project.name)
                                    .foregroundStyle(.primary)
                                Spacer()
                                if attachingProjectID == project.id {
                                    ProgressView()
                                        .controlSize(.small)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(attachingProjectID != nil)
                    }
                    .listStyle(.plain)
                }
            }
            .background(Color.settingsBackground)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(
                    placement: .cancellationAction
                ) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .task {
                await reload()
            }
        }
        .background(Color.settingsBackground)
    }

    @MainActor
    private func reload() async {
        guard !loading else { return }
        loading = true
        failed = false
        defer { loading = false }

        do {
            projects = try await appModel.api.projects()
        } catch {
            failed = true
        }
    }

    @MainActor
    private func select(_ project: ProjectSummary) async {
        guard let conversationID else {
            dismiss()
            return
        }

        attachingProjectID = project.id
        defer { attachingProjectID = nil }

        do {
            _ = try await appModel.api.attachConversationToProject(
                projectID: project.id,
                conversationID: conversationID
            )
            dismiss()
        } catch {
            failed = true
        }
    }
}

struct ProjectFilePickerSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var projects: [ProjectSummary] = []
    @State private var loading = false
    @State private var failed = false

    var body: some View {
        NavigationStack {
            Group {
                if loading && projects.isEmpty {
                    ProgressView()
                } else if failed && projects.isEmpty {
                    AppStateSurface(
                        title: "Unavailable",
                        actionTitle: "Retry"
                    ) {
                        Task {
                            await reload()
                        }
                    }
                } else if projects.isEmpty {
                    AppStateSurface(title: "Nothing here")
                } else {
                    List(projects) { project in
                        NavigationLink {
                            ProjectResourceListView(
                                project: project,
                                kind: .file,
                                title: project.name
                            )
                        } label: {
                            Text(project.name)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .background(Color.settingsBackground)
            .navigationTitle("Project File")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(
                    placement: .cancellationAction
                ) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .task {
                await reload()
            }
        }
        .background(Color.settingsBackground)
    }

    @MainActor
    private func reload() async {
        guard !loading else { return }
        loading = true
        failed = false
        defer { loading = false }

        do {
            projects = try await appModel.api.projects()
        } catch {
            failed = true
        }
    }
}

private struct WorkspaceCreateSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    let onCreated: () -> Void

    @State private var name = ""
    @State private var description = ""
    @State private var saving = false
    @State private var failed = false

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $name)

                TextField(
                    "Description",
                    text: $description,
                    axis: .vertical
                )
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Color.settingsBackground)
            .navigationTitle("New Workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(
                    placement: .cancellationAction
                ) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(saving)
                }

                ToolbarItem(
                    placement: .confirmationAction
                ) {
                    Button(saving ? "Creating…" : "Create") {
                        Task {
                            await create()
                        }
                    }
                    .disabled(!canCreate || saving)
                }
            }
            .alert("Failed", isPresented: $failed) {
                Button("OK", role: .cancel) {}
            }
        }
        .background(Color.settingsBackground)
    }

    private var canCreate: Bool {
        let value = name.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return !value.isEmpty && value.count <= 200
    }

    @MainActor
    private func create() async {
        guard canCreate, !saving else { return }
        saving = true
        defer { saving = false }

        let normalizedName = name.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        let normalizedDescription =
            description.trimmingCharacters(
                in: .whitespacesAndNewlines
            )

        do {
            _ = try await appModel.api.createProjectWorkspace(
                name: normalizedName,
                description:
                    normalizedDescription.isEmpty
                        ? nil
                        : normalizedDescription
            )
            onCreated()
            dismiss()
        } catch {
            failed = true
        }
    }
}

private struct ProjectCreateSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    let workspaces: [ProjectWorkspaceSummary]
    let onCreated: () -> Void

    @State private var workspaceID: String
    @State private var name = ""
    @State private var description = ""
    @State private var saving = false
    @State private var failed = false

    init(
        workspaces: [ProjectWorkspaceSummary],
        onCreated: @escaping () -> Void
    ) {
        self.workspaces = workspaces
        self.onCreated = onCreated
        _workspaceID = State(
            initialValue: workspaces.first?.id ?? ""
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Workspace", selection: $workspaceID) {
                    ForEach(workspaces) { workspace in
                        Text(workspace.name)
                            .tag(workspace.id)
                    }
                }

                TextField("Name", text: $name)

                TextField(
                    "Description",
                    text: $description,
                    axis: .vertical
                )
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Color.settingsBackground)
            .navigationTitle("New Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(
                    placement: .cancellationAction
                ) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(saving)
                }

                ToolbarItem(
                    placement: .confirmationAction
                ) {
                    Button(saving ? "Creating…" : "Create") {
                        Task {
                            await create()
                        }
                    }
                    .disabled(!canCreate || saving)
                }
            }
            .alert("Failed", isPresented: $failed) {
                Button("OK", role: .cancel) {}
            }
        }
        .background(Color.settingsBackground)
    }

    private var canCreate: Bool {
        let normalizedName = name.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return !workspaceID.isEmpty
            && !normalizedName.isEmpty
            && normalizedName.count <= 200
    }

    @MainActor
    private func create() async {
        guard canCreate, !saving else { return }
        saving = true
        defer { saving = false }

        let normalizedName = name.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        let normalizedDescription =
            description.trimmingCharacters(
                in: .whitespacesAndNewlines
            )

        do {
            _ = try await appModel.api.createProject(
                workspaceID: workspaceID,
                name: normalizedName,
                description:
                    normalizedDescription.isEmpty
                        ? nil
                        : normalizedDescription
            )
            onCreated()
            dismiss()
        } catch {
            failed = true
        }
    }
}

private func normalizedProjectText(
    _ value: String?
) -> String? {
    guard let value else { return nil }
    let normalized = value.trimmingCharacters(
        in: .whitespacesAndNewlines
    )
    return normalized.isEmpty ? nil : normalized
}

private func projectDateText(
    _ value: String?
) -> String? {
    guard let value else { return nil }

    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [
        .withInternetDateTime,
        .withFractionalSeconds
    ]

    let standard = ISO8601DateFormatter()
    standard.formatOptions = [.withInternetDateTime]

    guard let date =
        fractional.date(from: value)
        ?? standard.date(from: value) else {
        return nil
    }

    return date.formatted(
        date: .abbreviated,
        time: .omitted
    )
}


struct ContextOverviewSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        NavigationStack {
            Form {
                if metadata == nil {
                    Section {
                        AppStateSurface(title: "Nothing here")
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
        .task {
            await appModel.refreshActiveNativeLiveRuntimeMetadata()
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
