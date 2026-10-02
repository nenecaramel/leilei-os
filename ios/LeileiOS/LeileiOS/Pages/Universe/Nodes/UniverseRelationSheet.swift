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
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent(
                        "当前思想",
                        value: source.title
                    )
                }

                Section {
                    Picker(
                        "连接到",
                        selection: $targetID
                    ) {
                        Text("选择另一个思想")
                            .tag("")

                        ForEach(nodes) { node in
                            Text(node.title)
                                .tag(node.id)
                        }
                    }

                    Picker(
                        "关系",
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
                    "连接强度"
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
            .scrollContentBackground(.hidden)
            .background(
                UniversePalette.background
            )
            .navigationTitle(
                "连接另一个思想"
            )
            .navigationBarTitleDisplayMode(
                .inline
            )
            .toolbar {
                ToolbarItem(
                    placement: .cancellationAction
                ) {
                    Button("取消") {
                        dismiss()
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
                            Text("建立连接")
                        }
                    }
                    .disabled(
                        isSaving
                            || targetID.isEmpty
                    )
                }
            }
        }
    }

    private func save() async {
        guard !targetID.isEmpty else {
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
