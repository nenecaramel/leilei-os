import SwiftUI
import Foundation

struct MindManualEntrySheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var kind: MindProductKind = .memory
    @State private var text = ""
    @State private var note = ""
    @State private var hasOccurredAt = false
    @State private var occurredAt = Date.now
    @State private var saving = false
    @State private var failed = false
    @State private var pendingRequestID: UUID?
    @State private var pendingRequestSignature: String?

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

        let desiredOccurredAt =
            hasOccurredAt ? occurredAt : nil
        let desiredNote =
            normalizedNote.isEmpty ? nil : normalizedNote
        let signature = [
            kind.rawValue,
            normalizedText,
            desiredOccurredAt.map {
                String($0.timeIntervalSince1970)
            } ?? "",
            desiredNote ?? ""
        ].joined(separator: "\u{0}")
        let requestID = requestID(for: signature)

        do {
            _ = try await appModel.api.createManualMind(
                kind: kind,
                text: normalizedText,
                occurredAt: desiredOccurredAt,
                note: desiredNote,
                requestID: requestID
            )
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
