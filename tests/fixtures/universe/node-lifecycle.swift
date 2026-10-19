@MainActor final class UniverseNodeSheet {
    enum Mode { case detail, create(UniversePosition) }
    enum Confirmation: Equatable { case discardChanges, deleteNode, restoreVersion, removeConnection(UniverseRelation) }
    let mode: Mode
    let node: UniverseNode?
    let allNodes: [UniverseNode] = []
    let sources: [UniverseDiarySourceSummary] = []
    var draft: UniverseNodeDraft
    var originalDraft: UniverseNodeDraft
    var isEditing = true, isSaving = false
    var confirmation: Confirmation?
    var errorMessage: String?
    var closed = 0
    var submitted: [(UniverseNodeDraft, UniversePosition?, CheckedContinuation<Void, Error>)] = []
    init(create: Bool = false) {
        mode = create ? .create(UniversePosition(x: 17, y: 29)) : .detail
        node = create ? nil : UniverseNode(id: "n1", title: "Original", summary: "summary", content: "body", type: "concept", tags: [], galaxies: [], position: UniversePosition(x: 20, y: 30), createdAt: "now", updatedAt: "now", importance: nil, migration: nil)
        draft = UniverseNodeDraft(node: node, sourceDiaryIDs: [])
        originalDraft = draft
    }
    func onSave(_ draft: UniverseNodeDraft, _ position: UniversePosition?) async throws {
        try await withCheckedThrowingContinuation { submitted.append((draft, position, $0)) }
    }
    func onClose() { closed += 1 }
    func onDelete(_ node: UniverseNode) async throws {}
    func onRestore(_ node: UniverseNode) async throws {}
    func onDeleteRelation(_ relation: UniverseRelation) async throws {}
}
// COORDINATION
Task { @MainActor in
    switch CommandLine.arguments[1] {
    case "cancel-discard":
        let h = UniverseNodeSheet(); h.draft.title = "Draft"
        h.cancel()
        precondition(h.confirmation == .discardChanges && h.closed == 0 && h.isEditing && h.draft.title == "Draft")
        h.discardChanges()
        precondition(h.draft == h.originalDraft && h.draft.title == "Original" && !h.isEditing && h.closed == 0 && h.confirmation == nil)
        let create = UniverseNodeSheet(create: true); create.draft.title = "New"
        create.cancel(); precondition(create.confirmation == .discardChanges && create.closed == 0)
        create.discardChanges(); precondition(create.closed == 1 && create.draft.title.isEmpty)
    case "save-single-flight":
        let h = UniverseNodeSheet(); h.draft.title = "Saved draft"
        let first = Task { await h.save() }
        while h.submitted.isEmpty { await Task.yield() }
        let repeated = Task { await h.save() }; await repeated.value
        h.cancel(); h.discardChanges()
        precondition(h.submitted.count == 1 && h.isSaving && h.isEditing && h.closed == 0 && h.draft.title == "Saved draft")
        precondition(h.submitted[0].0.title == "Saved draft" && h.submitted[0].1 == nil)
        h.submitted[0].2.resume(); await first.value
        precondition(!h.isSaving && !h.isEditing && h.originalDraft.title == "Saved draft" && h.closed == 0)
    case "failure-retry-create":
        let h = UniverseNodeSheet(); h.draft.title = "Retained draft"
        let failed = Task { await h.save() }; while h.submitted.isEmpty { await Task.yield() }
        h.submitted[0].2.resume(throwing: LeileiAPIError.backend(status: 409, code: "VERSION_CONFLICT", message: nil)); await failed.value
        precondition(!h.isSaving && h.isEditing && h.draft.title == "Retained draft" && h.originalDraft.title == "Original" && h.closed == 0)
        precondition(h.errorMessage?.contains("another device") == true)
        let retry = Task { await h.save() }; while h.submitted.count < 2 { await Task.yield() }
        precondition(h.submitted[1].0 == h.submitted[0].0)
        h.submitted[1].2.resume(); await retry.value
        precondition(h.errorMessage == nil && !h.isEditing)
        let create = UniverseNodeSheet(create: true); create.draft.title = "Created"
        let save = Task { await create.save() }; while create.submitted.isEmpty { await Task.yield() }
        precondition(create.submitted[0].1 == UniversePosition(x: 17, y: 29))
        create.submitted[0].2.resume(); await save.value
        precondition(create.closed == 1 && !create.isSaving)
    default: preconditionFailure("unknown scenario")
    }
    print("PASS \(CommandLine.arguments[1])"); exit(0)
}
dispatchMain()
