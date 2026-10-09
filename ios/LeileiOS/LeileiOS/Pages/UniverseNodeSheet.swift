import Foundation
import SwiftUI

struct UniverseNodeSheet: View {
    enum Mode: Equatable {
        case detail
        case create(UniversePosition)
    }

    let mode: Mode
    let node: UniverseNode?
    let galaxies: [UniverseGalaxy]
    let allNodes: [UniverseNode]
    let connections: [UniverseNodeConnection]
    let sources: [UniverseDiarySourceSummary]
    let revisionsAvailable: Bool

    let onSearchDiarySources:
        (String) async throws -> [UniverseDiarySourceOption]
    let onSave:
        (UniverseNodeDraft, UniversePosition?) async throws -> Void
    let onDelete: (UniverseNode) async throws -> Void
    let onRestore: (UniverseNode) async throws -> Void
    let onCreateRelation:
        (UniverseRelationCreateInput) async throws -> Void
    let onDeleteRelation:
        (UniverseRelation) async throws -> Void
    let onOpenRelatedNode: (String) -> Void
    let onDiarySourceChanged: () async -> Void
    let onClose: () -> Void

    @State var isEditing: Bool
    @State var draft: UniverseNodeDraft
    @State var sourceMetadata:
        [String: UniverseDiarySourceOption]
    @State var sourcePickerPresented = false
    @State var relationPresented = false
    @State var diarySourceSelection: UniverseDiarySourceSummary?
    @State var deletePresented = false
    @State var isSaving = false
    @State var errorMessage: String?

    init(
        mode: Mode,
        node: UniverseNode?,
        galaxies: [UniverseGalaxy],
        allNodes: [UniverseNode],
        connections: [UniverseNodeConnection],
        sources: [UniverseDiarySourceSummary],
        revisionsAvailable: Bool,
        onSearchDiarySources:
            @escaping (String) async throws
                -> [UniverseDiarySourceOption],
        onSave:
            @escaping (
                UniverseNodeDraft,
                UniversePosition?
            ) async throws -> Void,
        onDelete:
            @escaping (UniverseNode) async throws -> Void,
        onRestore:
            @escaping (UniverseNode) async throws -> Void,
        onCreateRelation:
            @escaping (
                UniverseRelationCreateInput
            ) async throws -> Void,
        onDeleteRelation:
            @escaping (UniverseRelation) async throws -> Void,
        onOpenRelatedNode:
            @escaping (String) -> Void,
        onDiarySourceChanged:
            @escaping () async -> Void,
        onClose:
            @escaping () -> Void
    ) {
        self.mode = mode
        self.node = node
        self.galaxies = galaxies
        self.allNodes = allNodes
        self.connections = connections
        self.sources = sources
        self.revisionsAvailable = revisionsAvailable
        self.onSearchDiarySources = onSearchDiarySources
        self.onSave = onSave
        self.onDelete = onDelete
        self.onRestore = onRestore
        self.onCreateRelation = onCreateRelation
        self.onDeleteRelation = onDeleteRelation
        self.onOpenRelatedNode = onOpenRelatedNode
        self.onDiarySourceChanged = onDiarySourceChanged
        self.onClose = onClose

        let creating: Bool
        switch mode {
        case .create:
            creating = true
        case .detail:
            creating = false
        }

        _isEditing = State(initialValue: creating)
        _draft = State(
            initialValue: UniverseNodeDraft(
                node: node,
                sourceDiaryIDs: sources.map(\.diaryId)
            )
        )
        _sourceMetadata = State(
            initialValue: Dictionary(
                uniqueKeysWithValues: sources.map {
                    (
                        $0.diaryId,
                        UniverseDiarySourceOption(
                            id: $0.diaryId,
                            title: $0.title,
                            date: $0.date,
                            status: $0.status
                        )
                    )
                }
            )
        )
    }

    var body: some View {
        NavigationStack {
            Group {
                if isEditing {
                    editor
                } else if let node {
                    detail(node)
                } else {
                    ProgressView()
                }
            }
            .background(
                UniversePalette.background
                    .ignoresSafeArea()
            )
            .navigationTitle(
                isCreate
                    ? "Add Node"
                    : isEditing
                        ? "Edit Node"
                        : "Universe"
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                toolbarContent
            }
        }
        .environment(\.colorScheme, .dark)
        .interactiveDismissDisabled(
            isSaving
        )
        .sheet(isPresented: $sourcePickerPresented) {
            UniverseDiarySourcePicker(
                initialSelection: draft.sourceDiaryIDs,
                initialMetadata: sourceMetadata,
                search: onSearchDiarySources
            ) { ids, metadata in
                draft.sourceDiaryIDs = ids
                sourceMetadata.merge(
                    metadata,
                    uniquingKeysWith: { _, new in new }
                )
            }
            .environment(\.colorScheme, .dark)
        }
        .sheet(isPresented: $relationPresented) {
            if let node {
                UniverseRelationSheet(
                    source: node,
                    nodes: relationCandidates,
                    onSave: { relation in
                        try await onCreateRelation(relation)
                    }
                )
                .environment(\.colorScheme, .dark)
            }
        }
        .sheet(item: $diarySourceSelection) { source in
            UniverseDiarySourceSheet(
                source: source,
                onChanged: {
                    await onDiarySourceChanged()
                }
            )
            .environment(\.colorScheme, .dark)
        }
        .confirmationDialog(
            "Delete Node?",
            isPresented: $deletePresented,
            titleVisibility: .visible
        ) {
            Button(
                "Delete",
                role: .destructive
            ) {
                guard let node else {
                    return
                }

                Task {
                    await delete(node)
                }
            }

            Button(
                "Cancel",
                role: .cancel
            ) {
            }
        }
        .onChange(of: node) { _, updated in
            guard !isEditing,
                  let updated
            else {
                return
            }

            draft = UniverseNodeDraft(
                node: updated,
                sourceDiaryIDs: sources.map(\.diaryId)
            )
        }
        .onChange(of: sources) { _, updatedSources in
            for source in updatedSources {
                sourceMetadata[source.diaryId] =
                    UniverseDiarySourceOption(
                        id: source.diaryId,
                        title: source.title,
                        date: source.date,
                        status: source.status
                    )
            }

            if !isEditing {
                draft.sourceDiaryIDs =
                    updatedSources.map(\.diaryId)
            }
        }
    }
}
