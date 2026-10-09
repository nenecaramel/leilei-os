import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct UniverseRelationSheet: View {
    let source: UniverseNode
    let nodes: [UniverseNode]
    let onSave:
        (UniverseRelationCreateInput) async throws -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var targetID = ""
    @State private var relationType:
        UniverseRelationType = .relatedTo
    @State private var strength = 0.7
    @State private var isSaving = false
    @State private var discardPresented = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent(
                        "Current Node",
                        value: source.title
                    )
                }

                Section {
                    Picker(
                        "Connect to",
                        selection: $targetID
                    ) {
                        Text("Select a node")
                            .tag("")

                        ForEach(nodes) { node in
                            Text(node.title)
                                .tag(node.id)
                        }
                    }

                    Picker(
                        "Relationship",
                        selection: $relationType
                    ) {
                        ForEach(
                            UniverseRelationType.allCases
                        ) { type in
                            Text(
                                type.standaloneLabel
                            )
                            .tag(type)
                        }
                    }
                }

                Section(
                    "Strength"
                ) {
                    Slider(
                        value: $strength,
                        in: 0...1,
                        step: 0.1
                    )

                    HStack {
                        Spacer()
                        Text(
                            "\(Int((strength * 100).rounded()))%"
                        )
                        .foregroundStyle(.secondary)
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }
            }
            .disabled(isSaving)
            .scrollContentBackground(.hidden)
            .background(
                UniversePalette.background
            )
            .navigationTitle(
                "Add Connection"
            )
            .navigationBarTitleDisplayMode(
                .inline
            )
            .toolbar {
                ToolbarItem(
                    placement: .cancellationAction
                ) {
                    Button("Cancel") {
                        cancel()
                    }
                    .disabled(isSaving)
                }

                ToolbarItem(
                    placement: .confirmationAction
                ) {
                    Button {
                        Task {
                            await save()
                        }
                    } label: {
                        if isSaving {
                            ProgressView()
                        } else {
                            Text("Add")
                        }
                    }
                    .disabled(
                        isSaving
                            || targetID.isEmpty
                    )
                }
            }
        }
        .interactiveDismissDisabled(isSaving || hasUnsavedChanges)
        .confirmationDialog(
            "Discard changes?",
            isPresented: $discardPresented,
            titleVisibility: .visible
        ) {
            Button("Discard changes", role: .destructive) {
                dismiss()
            }
            Button("Keep editing", role: .cancel) {}
        }
    }

    private var hasUnsavedChanges: Bool {
        !targetID.isEmpty || relationType != .relatedTo || strength != 0.7
    }

    private func cancel() {
        guard !isSaving else { return }
        if hasUnsavedChanges {
            discardPresented = true
        } else {
            dismiss()
        }
    }

    private func save() async {
        guard !isSaving, !targetID.isEmpty else {
            return
        }

        isSaving = true
        errorMessage = nil
        defer {
            isSaving = false
        }

        do {
            try await onSave(
                UniverseRelationCreateInput(
                    source: source.id,
                    target: targetID,
                    relationType: relationType,
                    strength: strength
                )
            )
            dismiss()
        } catch {
            errorMessage =
                UniverseAPIService.userMessage(
                    for: error
                )
        }
    }
}
