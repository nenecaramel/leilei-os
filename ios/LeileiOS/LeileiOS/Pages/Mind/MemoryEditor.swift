import SwiftUI

struct MemoryEditorSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var item: MindProductItem
    @State private var text: String
    @State private var hasDate: Bool
    @State private var date: Date
    @State private var saving = false
    @State private var message: String?
    @State private var conflict: MindProductItem?
    @State private var conflictUnresolved = false
    @State private var confirmDiscard = false

    let onSaved: (MindProductItem) -> Void

    init(initialItem: MindProductItem, onSaved: @escaping (MindProductItem) -> Void) {
        _item = State(initialValue: initialItem)
        _text = State(initialValue: initialItem.text ?? "")
        _hasDate = State(initialValue: initialItem.occurredAt != nil)
        _date = State(initialValue: MemoryDate.parse(initialItem.occurredAt) ?? .now)
        self.onSaved = onSaved
    }

    private var isDirty: Bool {
        text != (item.text ?? "")
            || (hasDate ? date : nil) != MemoryDate.parse(item.occurredAt)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    TextEditor(text: $text)
                        .font(.body)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 240)
                        .padding(12)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(Color(.secondarySystemGroupedBackground))
                        )
                        .disabled(saving)
                        .accessibilityLabel("Memory text")

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Occurred")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        if hasDate {
                            DatePicker(
                                "Beijing time",
                                selection: $date,
                                displayedComponents: [.date, .hourAndMinute]
                            )
                            .environment(
                                \.timeZone,
                                TimeZone(identifier: "Asia/Shanghai")!
                            )
                            .datePickerStyle(.compact)
                            .disabled(saving)
                        } else {
                            Button("Set occurred time") {
                                hasDate = true
                            }
                            .disabled(saving)
                        }
                    }

                    if let message {
                        Text(message)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    if let conflict {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("Latest version")
                                .font(.headline)
                            Text(conflict.text ?? "")
                                .textSelection(.enabled)
                            Text(MindPresentation.dateText(conflict.occurredAt) ?? "No date")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Button("Use latest version") {
                                item = conflict
                                text = conflict.text ?? ""
                                hasDate = conflict.occurredAt != nil
                                date = MemoryDate.parse(conflict.occurredAt) ?? .now
                                self.conflict = nil
                                conflictUnresolved = false
                                message = nil
                            }
                            .disabled(saving)
                            Button("Keep my draft") {
                                item = conflict
                                self.conflict = nil
                                conflictUnresolved = false
                                message = "Review your draft before saving again."
                            }
                            .disabled(saving)
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(Color(.secondarySystemGroupedBackground))
                        )
                    } else if conflictUnresolved {
                        Button("Read latest version") {
                            Task { await readConflict() }
                        }
                        .disabled(saving)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 20)
            }
            .background(Color(.systemBackground))
            .navigationTitle("Edit Memory")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if isDirty {
                            confirmDiscard = true
                        } else {
                            dismiss()
                        }
                    }
                    .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Done") {
                        Task { await save() }
                    }
                    .disabled(
                        saving || !isDirty || conflictUnresolved
                            || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || text.count > 20_000
                    )
                }
            }
            .confirmationDialog(
                "Discard changes?",
                isPresented: $confirmDiscard,
                titleVisibility: .visible
            ) {
                Button("Discard changes", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            }
            .interactiveDismissDisabled()
        }
    }

    @MainActor
    private func readConflict() async {
        saving = true
        defer { saving = false }
        do {
            conflict = try await appModel.api.mindItem(stateID: item.id)
            message = "Memory changed. Your draft is preserved; choose how to continue."
        } catch {
            message = "Unable to read the latest version. Your draft is preserved."
        }
    }

    @MainActor
    private func save() async {
        guard !saving, !conflictUnresolved else { return }
        saving = true
        message = nil
        do {
            let updated = try await appModel.api.updateMemory(
                item: item,
                text: text,
                occurredAt: hasDate ? date : nil
            )
            onSaved(updated)
            dismiss()
        } catch LeileiAPIError.backend(let status, _, _) where status == 409 {
            conflictUnresolved = true
            await readConflict()
        } catch {
            message = "Unable to save. Try again."
        }
        saving = false
    }
}
