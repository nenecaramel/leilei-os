import SwiftUI
import Foundation

struct MindView: View {
    @EnvironmentObject private var appModel: AppModel
    @State private var addPresented = false

    var body: some View {
        List {
            Section {
                ForEach(MindProductKind.allCases) { kind in
                    NavigationLink {
                        MindKindDetailView(kind: kind)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: kind.systemImage)
                                .font(.system(
                                    size: 16,
                                    weight: .regular
                                ))
                                .frame(width: 22)
                                .foregroundStyle(.secondary)

                            Text(kind.displayName)
                                .foregroundStyle(.primary)

                            Spacer(minLength: 8)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color(.systemBackground))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    addPresented = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add Mind")
            }
        }
        .sheet(isPresented: $addPresented) {
            MindManualEntrySheet()
                .environmentObject(appModel)
        }
    }
}

private struct MindKindDetailView: View {
    @EnvironmentObject private var appModel: AppModel

    let kind: MindProductKind

    @State private var items: [MindProductItem] = []
    @State private var nextCursor: String?
    @State private var loading = false
    @State private var loadingMore = false
    @State private var failed = false
    @State private var reloadToken = UUID()

    var body: some View {
        Group {
            if loading && items.isEmpty {
                ProgressView()
                    .controlSize(.small)
                    .frame(
                        maxWidth: .infinity,
                        maxHeight: .infinity
                    )
            } else if failed && items.isEmpty {
                AppStateSurface(
                    title: "Unavailable",
                    actionTitle: "Retry"
                ) {
                    reloadToken = UUID()
                }
            } else if items.isEmpty {
                AppStateSurface(title: "Nothing here")
            } else {
                List {
                    ForEach(items) { item in
                        NavigationLink {
                            MindItemDetailView(
                                initialItem: item,
                                onDeleted: {
                                    reloadToken = UUID()
                                }
                            )
                        } label: {
                            MindItemRow(item: item)
                        }
                    }

                    if nextCursor != nil {
                        Section {
                            Button("More") {
                                Task {
                                    await loadMore()
                                }
                            }
                            .disabled(loadingMore)
                            .frame(
                                maxWidth: .infinity,
                                alignment: .center
                            )
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .background(Color(.systemBackground))
                .refreshable {
                    await reload()
                }
            }
        }
        .background(Color(.systemBackground))
        .navigationTitle(kind.displayName)
        .navigationBarTitleDisplayMode(.inline)
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
            let page = try await appModel.api.mindPage(
                kind: kind
            )
            items = page.items
            nextCursor = page.nextCursor
        } catch {
            failed = true
        }
    }

    @MainActor
    private func loadMore() async {
        guard !loadingMore,
              let nextCursor else {
            return
        }
        loadingMore = true
        defer { loadingMore = false }

        do {
            let page = try await appModel.api.mindPage(
                kind: kind,
                cursor: nextCursor
            )
            let existing = Set(items.map(\.id))
            items.append(
                contentsOf: page.items.filter {
                    !existing.contains($0.id)
                }
            )
            self.nextCursor = page.nextCursor
        } catch {
            return
        }
    }
}

private struct MindItemRow: View {
    let item: MindProductItem

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(displayText)
                .foregroundStyle(.primary)
                .lineLimit(2)

            HStack(spacing: 8) {
                Text(sourceText)
                if let state = normalized(item.lifecycle.state) {
                    Text(state.replacingOccurrences(
                        of: "_",
                        with: " "
                    ))
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }

    private var displayText: String {
        normalized(item.text) ?? item.kind.displayName
    }

    private var sourceText: String {
        item.source == "manual"
            ? "Manual"
            : "Runtime"
    }
}

private struct MindItemDetailView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    let initialItem: MindProductItem
    let onDeleted: () -> Void

    @State private var item: MindProductItem
    @State private var showingDelete = false
    @State private var deleting = false
    @State private var failed = false

    init(
        initialItem: MindProductItem,
        onDeleted: @escaping () -> Void
    ) {
        self.initialItem = initialItem
        self.onDeleted = onDeleted
        _item = State(initialValue: initialItem)
    }

    var body: some View {
        Form {
            if let text = normalized(item.text) {
                Section {
                    Text(text)
                        .textSelection(.enabled)
                }
            }

            Section {
                LabeledContent("Kind", value: item.kind.displayName)
                LabeledContent("Source", value: sourceText)

                if let occurredAt = dateText(item.occurredAt) {
                    LabeledContent("Occurred", value: occurredAt)
                }

                LabeledContent(
                    "Created",
                    value: dateText(item.createdAt) ?? item.createdAt
                )
                LabeledContent(
                    "Updated",
                    value: dateText(item.updatedAt) ?? item.updatedAt
                )
            }

            if hasLifecycle {
                Section("Lifecycle") {
                    if let state = normalized(item.lifecycle.state) {
                        LabeledContent(
                            "State",
                            value: titleCase(state)
                        )
                    }
                    if let role = normalized(item.lifecycle.role) {
                        LabeledContent(
                            "Role",
                            value: titleCase(role)
                        )
                    }
                    if let salience = item.lifecycle.salience {
                        LabeledContent(
                            "Salience",
                            value: decimalText(salience)
                        )
                    }
                    if let pressure = item.lifecycle.pressure {
                        LabeledContent(
                            "Pressure",
                            value: decimalText(pressure)
                        )
                    }
                    if let strength = item.lifecycle.strength {
                        LabeledContent(
                            "Strength",
                            value: decimalText(strength)
                        )
                    }
                    if let count = item.lifecycle.reinforcementCount {
                        LabeledContent(
                            "Reinforcement",
                            value: integerLikeText(count)
                        )
                    }
                    if let total = item.lifecycle.satisfactionTotal {
                        LabeledContent(
                            "Satisfaction",
                            value: decimalText(total)
                        )
                    }
                    if let protected = item.lifecycle.protected {
                        LabeledContent(
                            "Protected",
                            value: protected ? "Yes" : "No"
                        )
                    }
                    if let value = dateText(
                        item.lifecycle.lastRecalledAt
                    ) {
                        LabeledContent(
                            "Last Recalled",
                            value: value
                        )
                    }
                    if let value = dateText(
                        item.lifecycle.resolvedAt
                    ) {
                        LabeledContent(
                            "Resolved",
                            value: value
                        )
                    }
                    if let value = dateText(
                        item.lifecycle.dormantAt
                    ) {
                        LabeledContent(
                            "Dormant",
                            value: value
                        )
                    }
                }
            }

            if let note = normalized(item.note) {
                Section("Note") {
                    Text(note)
                        .textSelection(.enabled)
                }
            }

            if item.provenance.sourceCount > 0 {
                Section("Provenance") {
                    LabeledContent(
                        "Sources",
                        value: String(item.provenance.sourceCount)
                    )

                    if !item.provenance.sourceKinds.isEmpty {
                        Text(
                            item.provenance.sourceKinds
                                .map(titleCase)
                                .joined(separator: ", ")
                        )
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
        .navigationTitle(item.kind.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(role: .destructive) {
                    showingDelete = true
                } label: {
                    Image(systemName: "trash")
                }
                .disabled(deleting)
                .accessibilityLabel("Delete Mind")
            }
        }
        .task {
            await refreshDetail()
        }
        .appConfirmationAlert(
            title: "Delete Mind?",
            message: "This Mind state will be deleted.",
            actionTitle: "Delete",
            actionRole: .destructive,
            isPresented: $showingDelete
        ) {
            Task {
                await delete()
            }
        }
        .alert(
            "Failed",
            isPresented: $failed
        ) {
            Button("OK", role: .cancel) {}
        }
    }

    private var sourceText: String {
        item.source == "manual"
            ? "Manual"
            : "Runtime"
    }

    private var hasLifecycle: Bool {
        item.lifecycle.state != nil
            || item.lifecycle.role != nil
            || item.lifecycle.salience != nil
            || item.lifecycle.pressure != nil
            || item.lifecycle.strength != nil
            || item.lifecycle.reinforcementCount != nil
            || item.lifecycle.satisfactionTotal != nil
            || item.lifecycle.protected != nil
            || item.lifecycle.lastRecalledAt != nil
            || item.lifecycle.resolvedAt != nil
            || item.lifecycle.dormantAt != nil
    }

    @MainActor
    private func refreshDetail() async {
        do {
            item = try await appModel.api.mindItem(
                stateID: item.id
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
            try await appModel.api.deleteMind(
                stateID: item.id
            )
            onDeleted()
            dismiss()
        } catch {
            failed = true
        }
    }
}

private struct MindManualEntrySheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var kind: MindProductKind = .memory
    @State private var text = ""
    @State private var note = ""
    @State private var hasOccurredAt = false
    @State private var occurredAt = Date.now
    @State private var saving = false
    @State private var failed = false
    @State private var createRequestID = UUID()

    var body: some View {
        NavigationStack {
            Form {
                Section("Mind") {
                    Picker("Kind", selection: $kind) {
                        ForEach(MindProductKind.allCases) { kind in
                            Text(kind.displayName)
                                .tag(kind)
                        }
                    }

                    TextEditor(text: $text)
                        .frame(minHeight: 120)
                }

                Section("Time") {
                    Toggle(
                        "Occurred at",
                        isOn: $hasOccurredAt
                    )

                    if hasOccurredAt {
                        DatePicker(
                            "Date",
                            selection: $occurredAt
                        )
                    }
                }

                Section("Note") {
                    TextEditor(text: $note)
                        .frame(minHeight: 80)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Color.settingsBackground)
            .navigationTitle("Add Mind")
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
                    Button(saving ? "Adding…" : "Add") {
                        Task {
                            await save()
                        }
                    }
                    .disabled(!canSave || saving)
                }
            }
            .alert(
                "Failed",
                isPresented: $failed
            ) {
                Button("OK", role: .cancel) {}
            }
        }
        .background(Color.settingsBackground)
    }

    private var canSave: Bool {
        let value = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return !value.isEmpty && value.count <= 20_000
    }

    @MainActor
    private func save() async {
        guard canSave, !saving else { return }

        saving = true
        defer { saving = false }

        let normalizedText = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        let normalizedNote = note.trimmingCharacters(
            in: .whitespacesAndNewlines
        )

        do {
            _ = try await appModel.api.createManualMind(
                kind: kind,
                text: normalizedText,
                occurredAt:
                    hasOccurredAt
                        ? occurredAt
                        : nil,
                note:
                    normalizedNote.isEmpty
                        ? nil
                        : normalizedNote,
                requestID: createRequestID
            )
            dismiss()
        } catch {
            failed = true
        }
    }
}

private extension MindProductKind {
    var systemImage: String {
        switch self {
        case .feel:
            return "heart"
        case .memory:
            return "clock.arrow.circlepath"
        case .drive:
            return "arrow.up.forward"
        case .thought:
            return "bubble.left"
        case .curiosity:
            return "questionmark.circle"
        case .topic:
            return "tag"
        }
    }
}

private func normalized(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(
        in: .whitespacesAndNewlines
    )
    return trimmed.isEmpty ? nil : trimmed
}

private func titleCase(_ value: String) -> String {
    value
        .replacingOccurrences(of: "_", with: " ")
        .capitalized
}

private func decimalText(_ value: Double) -> String {
    value.formatted(
        .number.precision(.fractionLength(0...2))
    )
}

private func integerLikeText(_ value: Double) -> String {
    if value.rounded() == value {
        return Int(value).formatted()
    }
    return decimalText(value)
}

private func dateText(_ value: String?) -> String? {
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
        time: .shortened
    )
}
