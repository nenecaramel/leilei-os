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
            Form {
                Section("Mind") {
                    TextEditor(text: $text)
                        .frame(minHeight: 120)
                        .disabled(saving)
                }

                Section("Time") {
                    Toggle("Occurred at", isOn: $hasDate)
                        .disabled(saving)

                    if hasDate {
                        DatePicker(
                            "Date",
                            selection: $date
                        )
                        .environment(
                            \.timeZone,
                            TimeZone(identifier: "Asia/Shanghai")!
                        )
                        .disabled(saving)
                    }
                }

                if let note = MindPresentation.normalized(item.note) {
                    Section("Note") {
                        Text(note)
                            .textSelection(.enabled)
                    }
                }

                if let message {
                    Section {
                        Text(message)
                            .foregroundStyle(.secondary)
                    }
                }

                if let conflict {
                    Section("Latest content") {
                        Text(conflict.text ?? "")
                            .textSelection(.enabled)
                        Text(MindPresentation.dateText(conflict.occurredAt) ?? "No date")
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
                        .buttonStyle(.borderless)
                        .disabled(saving)

                        Button("Keep my draft") {
                            item = conflict
                            self.conflict = nil
                            conflictUnresolved = false
                            message = "Review your draft before saving again."
                        }
                        .buttonStyle(.borderless)
                        .disabled(saving)
                    }
                } else if conflictUnresolved {
                    Section {
                        Button("Read latest version") {
                            Task { await readConflict() }
                        }
                        .disabled(saving)
                    }
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Color.settingsBackground)
            .navigationTitle("Edit Mind")
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
                Button("Discard changes", role: .destructive) {
                    dismiss()
                }
                Button("Keep editing", role: .cancel) {}
            }
            .interactiveDismissDisabled()
        }
        .background(Color.settingsBackground)
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
