import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension UniverseView {
    func saveNode(
        existing: UniverseNode?,
        draft: UniverseNodeDraft,
        position: UniversePosition?
    ) async throws {
        guard let memberships =
            draft.canonicalMemberships
        else {
            throw LeileiAPIError.invalidResponse
        }

        let title =
            draft.title.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
        guard !title.isEmpty else {
            throw LeileiAPIError.invalidResponse
        }

        if let existing {
            try await mutate { service, version in
                try await service.updateNode(
                    id: existing.id,
                    patch: UniverseNodePatch(
                        title: title,
                        summary:
                            draft.summary
                                .trimmingCharacters(
                                    in:
                                        .whitespacesAndNewlines
                                ),
                        content:
                            draft.content
                                .trimmingCharacters(
                                    in:
                                        .whitespacesAndNewlines
                                ),
                        type: draft.type,
                        tags: draft.tags,
                        galaxies: memberships,
                        position: nil,
                        importance:
                            draft.importance
                    ),
                    sourceDiaryIDs:
                        draft.sourceDiaryIDs,
                    reason:
                        "Edited in Universe on iOS",
                    expectedVersion: version
                )
            }

            selectedNodeID = existing.id
            sheetSelection = .node(existing.id)
            showNotice("Node updated")
        } else {
            guard let position else {
                throw LeileiAPIError.invalidResponse
            }

            try await mutate { service, version in
                try await service.createNode(
                    UniverseNodeCreateInput(
                        title: title,
                        summary:
                            draft.summary
                                .trimmingCharacters(
                                    in:
                                        .whitespacesAndNewlines
                                ),
                        content:
                            draft.content
                                .trimmingCharacters(
                                    in:
                                        .whitespacesAndNewlines
                                ),
                        type: draft.type,
                        tags: draft.tags,
                        galaxies: memberships,
                        position:
                            position.clamped(),
                        importance:
                            draft.importance
                    ),
                    sourceDiaryIDs:
                        draft.sourceDiaryIDs,
                    expectedVersion: version
                )
            }

            mapMode = .browse
            showNotice(
                "Node added"
            )
        }
    }

    func deleteNode(
        _ node: UniverseNode
    ) async throws {
        try await mutate { service, version in
            try await service.deleteNode(
                id: node.id,
                expectedVersion: version
            )
        }

        if selectedNodeID == node.id {
            selectedNodeID = nil
        }
        showNotice(
            "Node deleted"
        )
    }

    func restoreNode(
        _ node: UniverseNode
    ) async throws {
        try await mutate { service, version in
            try await service.restoreLatestRevision(
                nodeID: node.id,
                expectedVersion: version
            )
        }

        selectedNodeID = node.id
        sheetSelection = .node(node.id)
        showNotice(
            "Previous version restored"
        )
    }

    func createRelation(
        _ relation: UniverseRelationCreateInput
    ) async throws {
        try await mutate { service, version in
            try await service.createRelation(
                relation,
                expectedVersion: version
            )
        }

        showNotice(
            "Connection added"
        )
    }

    func deleteRelation(
        _ relation: UniverseRelation
    ) async throws {
        try await mutate { service, version in
            try await service.deleteRelation(
                id: relation.id,
                expectedVersion: version
            )
        }

        showNotice(
            "Connection removed"
        )
    }

    func moveNode(
        _ nodeID: String,
        to position: UniversePosition
    ) async {
        do {
            try await mutate {
                service,
                version in
                try await service.updateNode(
                    id: nodeID,
                    patch: UniverseNodePatch(
                        title: nil,
                        summary: nil,
                        content: nil,
                        type: nil,
                        tags: nil,
                        galaxies: nil,
                        position:
                            position.clamped(),
                        importance: nil
                    ),
                    sourceDiaryIDs: nil,
                    reason:
                        "Moved node in Universe on iOS",
                    expectedVersion: version
                )
            }

            selectedNodeID = nodeID
            showNotice(
                "Node position updated"
            )
        } catch {
            showNotice(
                UniverseAPIService.userMessage(
                    for: error
                )
            )
        }
    }

    private func mutate(
        operation:
            (
                UniverseAPIService,
                Int
            ) async throws -> UniverseReadResult
    ) async throws {
        guard case .ready(let current) = state else {
            throw LeileiAPIError.invalidResponse
        }

        let service =
            UniverseAPIService(
                api: appModel.api
            )

        do {
            let mutation =
                try await operation(
                    service,
                    current.version
                )

            do {
                let authoritative =
                    try await service.load()
                state = .ready(
                    authoritative
                )
            } catch {
                let preservedSources =
                    mutation.sources
                    ?? current.sources
                state = .ready(
                    UniverseReadResult(
                        snapshot:
                            mutation.snapshot,
                        version:
                            mutation.version,
                        sources:
                            preservedSources
                    )
                )
            }
        } catch {
            if let fresh =
                try? await service.load() {
                state = .ready(fresh)
            } else {
                state = .ready(current)
            }
            throw error
        }
    }
}
