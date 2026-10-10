import Foundation
import SwiftUI

struct UniverseNodeSheet: View {
    enum Mode: Equatable {
        case detail
        case create(UniversePosition)
    }

    enum Confirmation: Equatable {
        case discardChanges
        case deleteNode
        case restoreVersion
        case removeConnection(UniverseRelation)
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
    @State var originalDraft: UniverseNodeDraft
    @State var sourceMetadata:
        [String: UniverseDiarySourceOption]
    @State var sourcePickerPresented = false
    @State var relationPresented = false
    @State var diarySourceSelection: UniverseDiarySourceSummary?
    @State var confirmation: Confirmation?
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
        let initialDraft = UniverseNodeDraft(
            node: node,
            sourceDiaryIDs: sources.map(\.diaryId)
        )
        _draft = State(initialValue: initialDraft)
        _originalDraft = State(initialValue: initialDraft)
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
        Group {
            if isCreate {
                nodePresentation(editing: true)
            } else {
                nodePresentation(editing: false)
                    .sheet(isPresented: $isEditing) {
                        nodePresentation(editing: true)
                            .presentationDetents([.large])
                            .presentationDragIndicator(.visible)
                            .presentationBackground(UniversePalette.background)
                    }
            }
        }
        .onChange(of: node) { _, updated in
            guard !isEditing,
                  updated != nil
            else {
                return
            }

            resetDraft()
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
                resetDraft()
            }
        }
    }

    private func nodePresentation(editing: Bool) -> some View {
        NavigationStack {
            Group {
                if editing {
                    editor
                        .disabled(isSaving)
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
                    : editing
                        ? "Edit Node"
                        : "Universe"
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                toolbarContent(editing: editing)
            }
        }
        .environment(\.colorScheme, .dark)
        .interactiveDismissDisabled(isEditing || isSaving)
        .sheet(isPresented: Binding(
            get: { editing && sourcePickerPresented },
            set: { if editing { sourcePickerPresented = $0 } }
        )) {
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
        .sheet(isPresented: Binding(
            get: { !editing && relationPresented },
            set: { if !editing { relationPresented = $0 } }
        )) {
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
        .sheet(item: Binding(
            get: { editing ? nil : diarySourceSelection },
            set: { if !editing { diarySourceSelection = $0 } }
        )) { source in
            UniverseDiarySourceSheet(
                source: source,
                onChanged: {
                    await onDiarySourceChanged()
                }
            )
            .environment(\.colorScheme, .dark)
        }
        .alert(
            confirmationTitle,
            isPresented: Binding(
                get: { editing == isEditing && confirmation != nil },
                set: { if editing == isEditing && !$0 { confirmation = nil } }
            )
        ) {
            Button(confirmationCancelTitle, role: .cancel) {}
            switch confirmation {
            case .discardChanges:
                Button("Discard", role: .destructive) {
                    discardChanges()
                }
            case .deleteNode:
                Button("Delete", role: .destructive) {
                    if let node { Task { await delete(node) } }
                }
            case .restoreVersion:
                Button("Restore", role: .destructive) {
                    if let node { Task { await restore(node) } }
                }
            case .removeConnection(let relation):
                Button("Remove", role: .destructive) {
                    Task { await deleteRelation(relation) }
                }
            case nil:
                EmptyView()
            }
        } message: {
            Text(confirmationMessage)
        }
    }
}
