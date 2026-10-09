import SwiftUI
import Foundation

struct MindItemDetailView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    let initialItem: MindProductItem
    let onDeleted: () -> Void

    @State private var item: MindProductItem
    @State private var editing = false
    @State private var showingDelete = false
    @State private var deleting = false
    @State private var deleteFailed = false

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
            if let text = MindPresentation.normalized(item.text) {
                Section {
                    Text(text)
                        .textSelection(.enabled)
                }
            }

            Section {
                LabeledContent(
                    "Source",
                    value: MindPresentation.sourceLabel(item.source)
                )

                if let occurredAt = MindPresentation.dateText(
                    item.occurredAt
                ) {
                    LabeledContent("Occurred", value: occurredAt)
                }

                LabeledContent(
                    "Created",
                    value: MindPresentation.dateText(item.createdAt)
                        ?? item.createdAt
                )
                LabeledContent(
                    "Updated",
                    value: MindPresentation.dateText(item.updatedAt)
                        ?? item.updatedAt
                )
            }

            if hasLifecycle {
                Section("Lifecycle") {
                    if let state = MindPresentation.normalized(item.lifecycle.state) {
                        LabeledContent(
                            "State",
                            value: titleCase(state)
                        )
                    }
                    if let role = MindPresentation.normalized(item.lifecycle.role) {
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
                    if let value = MindPresentation.dateText(
                        item.lifecycle.lastRecalledAt
                    ) {
                        LabeledContent(
                            "Last Recalled",
                            value: value
                        )
                    }
                    if let value = MindPresentation.dateText(
                        item.lifecycle.resolvedAt
                    ) {
                        LabeledContent(
                            "Resolved",
                            value: value
                        )
                    }
                    if let value = MindPresentation.dateText(
                        item.lifecycle.dormantAt
                    ) {
                        LabeledContent(
                            "Dormant",
                            value: value
                        )
                    }
                }
            }

            if let note = MindPresentation.normalized(item.note) {
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
                        LabeledContent(
                            "Types",
                            value: item.provenance.sourceKinds
                                .map(titleCase)
                                .joined(separator: ", ")
                        )
                    }
                }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
        .navigationTitle(item.kind.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $editing) {
            MemoryEditorSheet(initialItem: item) { updated in
                item = updated
                onDeleted()
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Edit") {
                        editing = true
                    }
                    .disabled(deleting || item.contentVersion == nil)

                    Button("Delete", role: .destructive) {
                        showingDelete = true
                    }
                    .disabled(deleting)
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 18, weight: .medium))
                }
                .accessibilityLabel("Memory actions")
                .disabled(deleting)
            }
        }
        .task {
            await refreshDetail()
        }
        .appConfirmationAlert(
            title: "Delete Memory?",
            message: "This memory will be deleted.",
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
            isPresented: $deleteFailed
        ) {
            Button("OK", role: .cancel) {}
        }
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
            deleteFailed = true
        }
    }
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

