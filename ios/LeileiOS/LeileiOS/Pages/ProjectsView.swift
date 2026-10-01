import SwiftUI
import Foundation

struct WorkspacesView: View {
    @EnvironmentObject private var appModel: AppModel

    let onOpenConversation: (UUID) -> Void

    init(
        onOpenConversation: @escaping (UUID) -> Void = { _ in }
    ) {
        self.onOpenConversation = onOpenConversation
    }

    @State private var workspaces: [WorkspaceSummary] = []
    @State private var loading = false
    @State private var failed = false
    @State private var showingCreate = false
    @State private var reloadToken = UUID()

    var body: some View {
        Group {
            if loading && workspaces.isEmpty {
                ProgressView()
                    .controlSize(.small)
                    .frame(
                        maxWidth: .infinity,
                        maxHeight: .infinity
                    )
            } else if failed && workspaces.isEmpty {
                AppStateSurface(
                    title: "Unavailable",
                    actionTitle: "Retry"
                ) {
                    reloadToken = UUID()
                }
            } else if workspaces.isEmpty {
                AppStateSurface(title: "Nothing here")
            } else {
                List(workspaces) { workspace in
                    NavigationLink {
                        WorkspaceDetailView(
                            workspace: workspace,
                            onOpenConversation: onOpenConversation
                        ) {
                            reloadToken = UUID()
                        }
                    } label: {
                        WorkspaceSummaryRow(workspace: workspace)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .background(Color(.systemBackground))
        .navigationTitle("Workspaces")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingCreate = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New Workspace")
            }
        }
        .sheet(isPresented: $showingCreate) {
            WorkspaceCreateSheet {
                reloadToken = UUID()
            }
            .environmentObject(appModel)
        }
        .refreshable {
            await reload()
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
            workspaces = try await appModel.api.workspaces()
        } catch {
            failed = true
        }
    }
}

private struct WorkspaceSummaryRow: View {
    let workspace: WorkspaceSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(workspace.name)
                .foregroundStyle(.primary)

            if let description =
                normalizedWorkspaceText(workspace.description) {
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

private struct WorkspaceDetailView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    let initialWorkspace: WorkspaceSummary
    let onOpenConversation: (UUID) -> Void
    let onChanged: () -> Void

    @State private var workspace: WorkspaceSummary
    @State private var showingEdit = false
    @State private var showingDelete = false
    @State private var deleting = false
    @State private var failed = false

    init(
        workspace: WorkspaceSummary,
        onOpenConversation: @escaping (UUID) -> Void,
        onChanged: @escaping () -> Void
    ) {
        initialWorkspace = workspace
        self.onOpenConversation = onOpenConversation
        self.onChanged = onChanged
        _workspace = State(initialValue: workspace)
    }

    var body: some View {
        List {
            if let description =
                normalizedWorkspaceText(workspace.description) {
                Section {
                    Text(description)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                NavigationLink {
                    WorkspaceResourceListView(
                        workspace: workspace,
                        kind: .file,
                        title: "Files"
                    )
                } label: {
                    Label("Files", systemImage: "folder")
                }

                NavigationLink {
                    WorkspaceConversationsView(
                        workspace: workspace,
                        onOpenConversation: onOpenConversation
                    )
                } label: {
                    Label(
                        "Conversations",
                        systemImage: "bubble.left.and.bubble.right"
                    )
                }
            }

            Section("Claude Workspace environment") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Uses the bound local Workspace directory.")
                        .foregroundStyle(.primary)

                    Text(
                        "CLAUDE.md, .claude settings/rules/skills/agents, "
                        + ".mcp.json, hooks and plugins are read from that "
                        + "same directory by Claude Code and LeileiOS. "
                        + "LeileiOS does not keep a shadow copy."
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .padding(.vertical, 2)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
        .navigationTitle(workspace.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Edit") {
                        showingEdit = true
                    }

                    Button(
                        "Delete",
                        role: .destructive
                    ) {
                        showingDelete = true
                    }
                    .disabled(deleting)
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("Workspace actions")
            }
        }
        .sheet(isPresented: $showingEdit) {
            WorkspaceEditSheet(
                workspace: workspace
            ) { updated in
                workspace = updated
                onChanged()
            }
            .environmentObject(appModel)
        }
        .appConfirmationAlert(
            title: "Delete workspace?",
            message:
                "This deletes the Workspace and its Workspace resources. "
                + "Canonical conversations are not deleted. A Workspace "
                + "still required by provider continuation cannot be deleted.",
            actionTitle: "Delete",
            actionRole: .destructive,
            isPresented: $showingDelete
        ) {
            Task {
                await delete()
            }
        }
        .alert("Failed", isPresented: $failed) {
            Button("OK", role: .cancel) {}
        }
        .task {
            await refresh()
        }
    }

    @MainActor
    private func refresh() async {
        do {
            workspace = try await appModel.api.workspace(
                workspaceID: workspace.id
            )
        } catch {
            return
        }
    }

    @MainActor
    private func delete() async {
        guard !deleting else { return }
        deleting = true
        defer { deleting = false }

        do {
            try await appModel.api.deleteWorkspace(
                workspaceID: workspace.id,
                expectedVersion: workspace.version
            )
            onChanged()
            dismiss()
        } catch {
            do {
                workspace = try await appModel.api.workspace(
                    workspaceID: workspace.id
                )
                failed = true
            } catch LeileiAPIError.backend(
                let status,
                _,
                _
            ) where status == 404 {
                onChanged()
                dismiss()
            } catch {
                failed = true
            }
        }
    }
}

private struct WorkspaceResourceListView: View {
    @EnvironmentObject private var appModel: AppModel

    let workspace: WorkspaceSummary
    let kind: WorkspaceResourceKind
    let title: String

    @State private var resources: [WorkspaceResourceSummary] = []
    @State private var loading = false
    @State private var failed = false
    @State private var showingCreate = false
    @State private var reloadToken = UUID()

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
                    reloadToken = UUID()
                }
            } else if resources.isEmpty {
                AppStateSurface(title: "Nothing here")
            } else {
                List(resources) { resource in
                    NavigationLink {
                        WorkspaceResourceDetailView(
                            workspace: workspace,
                            summary: resource
                        ) {
                            reloadToken = UUID()
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(
                                normalizedWorkspaceText(resource.title)
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
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingCreate = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New Workspace file")
            }
        }
        .sheet(isPresented: $showingCreate) {
            WorkspaceResourceCreateSheet(
                workspace: workspace,
                kind: kind
            ) {
                reloadToken = UUID()
            }
            .environmentObject(appModel)
        }
        .task(id: reloadToken) {
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
            resources = try await appModel.api.workspaceResources(
                workspaceID: workspace.id,
                kind: kind
            )
        } catch {
            failed = true
        }
    }
}

private struct WorkspaceResourceDetailView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    let workspace: WorkspaceSummary
    let summary: WorkspaceResourceSummary
    let onChanged: () -> Void

    @State private var resource: WorkspaceResource?
    @State private var failed = false
    @State private var showingEdit = false
    @State private var showingDelete = false
    @State private var deleting = false

    var body: some View {
        Form {
            if let resource {
                Section {
                    LabeledContent(
                        "Type",
                        value: resource.kind.rawValue.capitalized
                    )
                    LabeledContent("Key", value: resource.key)

                    if let title =
                        normalizedWorkspaceText(resource.title) {
                        LabeledContent("Title", value: title)
                    }
                }

                if let content =
                    normalizedWorkspaceText(resource.content) {
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
            normalizedWorkspaceText(resource?.title)
                ?? normalizedWorkspaceText(summary.title)
                ?? summary.key
        )
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if resource != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Edit") {
                            showingEdit = true
                        }

                        Button(
                            "Delete",
                            role: .destructive
                        ) {
                            showingDelete = true
                        }
                        .disabled(deleting)
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                    .accessibilityLabel("Resource actions")
                }
            }
        }
        .sheet(isPresented: $showingEdit) {
            if let resource {
                WorkspaceResourceEditSheet(
                    workspace: workspace,
                    resource: resource
                ) { updated in
                    self.resource = updated
                    onChanged()
                }
                .environmentObject(appModel)
            }
        }
        .appConfirmationAlert(
            title: "Delete resource?",
            message: "This Workspace resource will be deleted.",
            actionTitle: "Delete",
            actionRole: .destructive,
            isPresented: $showingDelete
        ) {
            Task {
                await delete()
            }
        }
        .task {
            await load()
        }
    }

    @MainActor
    private func load() async {
        failed = false
        do {
            resource = try await appModel.api.workspaceResource(
                workspaceID: workspace.id,
                resourceID: summary.id
            )
        } catch {
            failed = true
        }
    }

    @MainActor
    private func delete() async {
        guard !deleting,
              let resource else {
            return
        }

        deleting = true
        defer { deleting = false }

        do {
            try await appModel.api.deleteWorkspaceResource(
                workspaceID: workspace.id,
                resourceID: resource.id,
                expectedVersion: resource.version
            )
            onChanged()
            dismiss()
        } catch {
            do {
                self.resource =
                    try await appModel.api.workspaceResource(
                        workspaceID: workspace.id,
                        resourceID: resource.id
                    )
                failed = true
            } catch LeileiAPIError.backend(
                let status,
                _,
                _
            ) where status == 404 {
                onChanged()
                dismiss()
            } catch {
                failed = true
            }
        }
    }
}

private struct WorkspaceConversationsView: View {
    @EnvironmentObject private var appModel: AppModel

    let workspace: WorkspaceSummary
    let onOpenConversation: (UUID) -> Void

    @State private var conversations:
        [WorkspaceConversationSummary] = []
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
                        Group {
                            if conversation.lifecycleStatus
                                .lowercased() == "active",
                               let conversationID =
                                UUID(
                                    uuidString:
                                        conversation.conversationId
                                ) {
                                Button {
                                    onOpenConversation(conversationID)
                                } label: {
                                    conversationRow(conversation)
                                }
                                .buttonStyle(.plain)
                            } else {
                                conversationRow(conversation)
                            }
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

    private func conversationRow(
        _ conversation: WorkspaceConversationSummary
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(
                normalizedWorkspaceText(conversation.title)
                    ?? "New Conversation"
            )
            .foregroundStyle(.primary)
            .lineLimit(1)

            HStack(spacing: 8) {
                Text(conversation.lifecycleStatus.capitalized)

                if let date =
                    workspaceDateText(conversation.lastMessageAt) {
                    Text(date)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
    }

    @MainActor
    private func reload() async {
        guard !loading else { return }
        loading = true
        failed = false
        defer { loading = false }

        do {
            conversations =
                try await appModel.api.workspaceConversations(
                    workspaceID: workspace.id
                )
        } catch {
            failed = true
        }
    }

    @MainActor
    private func detach(
        _ conversation: WorkspaceConversationSummary
    ) async {
        guard let conversationID =
            UUID(uuidString: conversation.conversationId) else {
            return
        }

        do {
            _ = try await appModel.api.detachConversationFromWorkspace(
                workspaceID: workspace.id,
                conversationID: conversationID
            )
            await reload()
        } catch {
            return
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
    @State private var pendingRequestID: UUID?
    @State private var pendingRequestSignature: String?

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
        let normalizedName = name.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return !normalizedName.isEmpty
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

        let desiredDescription =
            normalizedDescription.isEmpty
                ? nil
                : normalizedDescription
        let signature =
            normalizedName + "\u{0}" + (desiredDescription ?? "")
        let requestID = requestID(for: signature)

        do {
            _ = try await appModel.api.createWorkspace(
                name: normalizedName,
                description: desiredDescription,
                requestID: requestID
            )
            onCreated()
            dismiss()
        } catch {
            failed = true
        }
    }

    private func requestID(for signature: String) -> UUID {
        if pendingRequestSignature == signature,
           let pendingRequestID {
            return pendingRequestID
        }
        let requestID = UUID()
        pendingRequestSignature = signature
        pendingRequestID = requestID
        return requestID
    }
}

private struct WorkspaceEditSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    let onSaved: (WorkspaceSummary) -> Void

    @State private var workspace: WorkspaceSummary
    @State private var name: String
    @State private var description: String
    @State private var saving = false
    @State private var failed = false

    init(
        workspace: WorkspaceSummary,
        onSaved: @escaping (WorkspaceSummary) -> Void
    ) {
        self.onSaved = onSaved
        _workspace = State(initialValue: workspace)
        _name = State(initialValue: workspace.name)
        _description = State(
            initialValue: workspace.description ?? ""
        )
    }

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
            .navigationTitle("Edit Workspace")
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
                    Button(saving ? "Saving…" : "Save") {
                        Task {
                            await save()
                        }
                    }
                    .disabled(!canSave || saving)
                }
            }
            .alert("Failed", isPresented: $failed) {
                Button("OK", role: .cancel) {}
            }
        }
        .background(Color.settingsBackground)
    }

    private var canSave: Bool {
        let value = name.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return !value.isEmpty && value.count <= 200
    }

    @MainActor
    private func save() async {
        guard canSave, !saving else { return }
        saving = true
        defer { saving = false }

        let normalizedName = name.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        let normalizedDescription =
            description.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
        let desiredDescription =
            normalizedDescription.isEmpty
                ? nil
                : normalizedDescription

        do {
            let updated = try await appModel.api.updateWorkspace(
                workspaceID: workspace.id,
                expectedVersion: workspace.version,
                name: normalizedName,
                description: desiredDescription
            )
            onSaved(updated)
            dismiss()
        } catch {
            do {
                let authoritative = try await appModel.api.workspace(
                    workspaceID: workspace.id
                )
                workspace = authoritative
                name = authoritative.name
                description = authoritative.description ?? ""

                if authoritative.name == normalizedName
                    && authoritative.description
                        == desiredDescription {
                    onSaved(authoritative)
                    dismiss()
                } else {
                    failed = true
                }
            } catch {
                failed = true
            }
        }
    }
}

private struct WorkspaceResourceCreateSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    let workspace: WorkspaceSummary
    let kind: WorkspaceResourceKind
    let onCreated: () -> Void

    @State private var key = ""
    @State private var title = ""
    @State private var content = ""
    @State private var saving = false
    @State private var failed = false
    @State private var pendingRequestID: UUID?
    @State private var pendingRequestSignature: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Key", text: $key)
                    TextField("Title", text: $title)
                }

                Section("Content") {
                    TextEditor(text: $content)
                        .frame(minHeight: 180)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Color.settingsBackground)
            .navigationTitle("New Workspace File")
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
        let normalizedKey = key.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return !normalizedKey.isEmpty
            && normalizedKey.count <= 1_000
            && title.count <= 500
            && content.count <= 1_000_000
    }

    @MainActor
    private func create() async {
        guard canCreate, !saving else { return }
        saving = true
        defer { saving = false }

        let normalizedKey = key.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        let normalizedTitle = title.trimmingCharacters(
            in: .whitespacesAndNewlines
        )

        let desiredTitle =
            normalizedTitle.isEmpty ? nil : normalizedTitle
        let desiredContent =
            content.isEmpty ? nil : content
        let signature = [
            workspace.id,
            kind.rawValue,
            normalizedKey,
            desiredTitle ?? "",
            desiredContent ?? ""
        ].joined(separator: "\u{0}")
        let requestID = requestID(for: signature)

        do {
            _ = try await appModel.api.createWorkspaceResource(
                workspaceID: workspace.id,
                kind: kind,
                key: normalizedKey,
                title: desiredTitle,
                content: desiredContent,
                requestID: requestID
            )
            onCreated()
            dismiss()
        } catch {
            failed = true
        }
    }

    private func requestID(for signature: String) -> UUID {
        if pendingRequestSignature == signature,
           let pendingRequestID {
            return pendingRequestID
        }
        let requestID = UUID()
        pendingRequestSignature = signature
        pendingRequestID = requestID
        return requestID
    }
}

private struct WorkspaceResourceEditSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    let workspace: WorkspaceSummary
    let onSaved: (WorkspaceResource) -> Void

    @State private var resource: WorkspaceResource
    @State private var title: String
    @State private var content: String
    @State private var saving = false
    @State private var failed = false

    init(
        workspace: WorkspaceSummary,
        resource: WorkspaceResource,
        onSaved: @escaping (WorkspaceResource) -> Void
    ) {
        self.workspace = workspace
        self.onSaved = onSaved
        _resource = State(initialValue: resource)
        _title = State(initialValue: resource.title ?? "")
        _content = State(initialValue: resource.content ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $title)

                Section("Content") {
                    TextEditor(text: $content)
                        .frame(minHeight: 180)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Color.settingsBackground)
            .navigationTitle("Edit Workspace File")
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
                    Button(saving ? "Saving…" : "Save") {
                        Task {
                            await save()
                        }
                    }
                    .disabled(saving)
                }
            }
            .alert("Failed", isPresented: $failed) {
                Button("OK", role: .cancel) {}
            }
        }
        .background(Color.settingsBackground)
    }

    @MainActor
    private func save() async {
        guard !saving else { return }
        saving = true
        defer { saving = false }

        let normalizedTitle = title.trimmingCharacters(
            in: .whitespacesAndNewlines
        )

        do {
            let updated =
                try await appModel.api.updateWorkspaceResource(
                    workspaceID: workspace.id,
                    resourceID: resource.id,
                    expectedVersion: resource.version,
                    title:
                        normalizedTitle.isEmpty
                            ? nil
                            : normalizedTitle,
                    content:
                        content.isEmpty
                            ? nil
                            : content,
                    metadata: resource.metadata
                )
            onSaved(updated)
            dismiss()
        } catch {
            do {
                let authoritative =
                    try await appModel.api.workspaceResource(
                        workspaceID: workspace.id,
                        resourceID: resource.id
                    )
                resource = authoritative
                title = authoritative.title ?? ""
                content = authoritative.content ?? ""
                failed = true
            } catch {
                failed = true
            }
        }
    }
}

private func normalizedWorkspaceText(
    _ value: String?
) -> String? {
    guard let value else { return nil }
    let normalized = value.trimmingCharacters(
        in: .whitespacesAndNewlines
    )
    return normalized.isEmpty ? nil : normalized
}

private func workspaceDateText(
    _ value: String?
) -> String? {
    guard let value,
          let date = ISO8601DateFormatter().date(from: value) else {
        return nil
    }

    let formatter = DateFormatter()
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    return formatter.string(from: date)
}

struct ContextOverviewSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appModel: AppModel
    @State private var isCompacting = false
    @State private var compactError: String?

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


                    if let environment =
                        metadata?.environment {
                        Section("Session Environment") {
                            environmentRow(
                                "Runtime Model",
                                environment.model
                            )
                            environmentRow(
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
                                environmentRow(
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
                                environmentRow(
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
                                environmentRow(
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
    private func environmentListRow(
        _ label: String,
        _ values: [String]
    ) -> some View {
        let normalizedValues =
            values.compactMap(normalized)
        if !normalizedValues.isEmpty {
            environmentRow(
                label,
                normalizedValues.joined(separator: "\n")
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
