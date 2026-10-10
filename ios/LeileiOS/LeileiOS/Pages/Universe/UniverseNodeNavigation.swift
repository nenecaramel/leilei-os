import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension UniverseView {
    var nodeDetailSelection: Binding<UniverseSheetSelection?> {
        Binding(
            get: {
                guard case .node = sheetSelection else { return nil }
                return sheetSelection
            },
            set: { selection in
                if let selection {
                    sheetSelection = selection
                } else if case .node = sheetSelection {
                    sheetSelection = nil
                }
            }
        )
    }

    var nodeCreateSelection: Binding<UniverseSheetSelection?> {
        Binding(
            get: {
                guard case .create = sheetSelection else { return nil }
                return sheetSelection
            },
            set: { selection in
                if let selection {
                    sheetSelection = selection
                } else if case .create = sheetSelection {
                    sheetSelection = nil
                }
            }
        )
    }

    @ViewBuilder
    func nodeSheet(
        _ selection: UniverseSheetSelection
    ) -> some View {
        if case .ready(let result) = state {
            let context =
                nodeSheetContext(
                    selection,
                    in: result
                )
            let selectedNode = context.node
            let mode = context.mode
            let nodeID = selectedNode?.id
            let nodeConnections =
                nodeID.map {
                    connections(
                        for: $0,
                        in: result
                    )
                } ?? []
            let nodeSources =
                nodeID.map {
                    sources(
                        for: $0,
                        in: result
                    )
                } ?? []
            let revisionsAvailable =
                nodeID.map { id in
                    result.snapshot.revisions
                        .contains {
                            $0.nodeId == id
                        }
                } ?? false

            UniverseNodeSheet(
                mode: mode,
                node: selectedNode,
                galaxies: result.snapshot.galaxies,
                allNodes: result.snapshot.nodes,
                connections: nodeConnections,
                sources: nodeSources,
                revisionsAvailable: revisionsAvailable,
                onSearchDiarySources: {
                    query in
                    try await UniverseAPIService(
                        api: appModel.api
                    )
                    .searchDiarySources(
                        query: query
                    )
                },
                onSave: {
                    draft,
                    position in
                    try await saveNode(
                        existing: selectedNode,
                        draft: draft,
                        position: position
                    )
                },
                onDelete: {
                    node in
                    try await deleteNode(node)
                },
                onRestore: {
                    node in
                    try await restoreNode(node)
                },
                onCreateRelation: {
                    relation in
                    try await createRelation(
                        relation
                    )
                },
                onDeleteRelation: {
                    relation in
                    try await deleteRelation(
                        relation
                    )
                },
                onOpenRelatedNode: {
                    nodeID in
                    openRelatedNode(nodeID)
                },
                onDiarySourceChanged: {
                    await refreshReadyState()
                },
                onClose: {
                    sheetSelection = nil
                }
            )
        } else {
            ProgressView()
                .frame(
                    maxWidth: .infinity,
                    maxHeight: .infinity
                )
                .background(
                    UniversePalette.background
                )
        }
    }

    private func nodeSheetContext(
        _ selection: UniverseSheetSelection,
        in result: UniverseReadResult
    ) -> (
        node: UniverseNode?,
        mode: UniverseNodeSheet.Mode
    ) {
        switch selection {
        case .node(let id):
            return (
                node:
                    result.snapshot.nodes.first {
                        $0.id == id
                    },
                mode: .detail
            )

        case .create(let position):
            return (
                node: nil,
                mode: .create(position)
            )
        }
    }

    func connections(
        for nodeID: String,
        in result: UniverseReadResult
    ) -> [UniverseNodeConnection] {
        let nodes = Dictionary(
            uniqueKeysWithValues:
                result.snapshot.nodes.map {
                    ($0.id, $0)
                }
        )

        return result.snapshot.relations
            .compactMap { relation in
                let relatedID: String

                if relation.source == nodeID {
                    relatedID = relation.target
                } else if relation.target
                    == nodeID {
                    relatedID = relation.source
                } else {
                    return nil
                }

                guard let node =
                    nodes[relatedID]
                else {
                    return nil
                }

                return UniverseNodeConnection(
                    relation: relation,
                    node: node
                )
            }
    }

    func sources(
        for nodeID: String,
        in result: UniverseReadResult
    ) -> [UniverseDiarySourceSummary] {
        (result.sources ?? [])
            .filter {
                $0.nodeId == nodeID
            }
    }

    func openRelatedNode(
        _ nodeID: String
    ) {
        sheetSelection = nil
        selectedNodeID = nodeID
    }

    func openTargetIfPossible() async {
        guard let targetNodeID,
              case .ready(let result) = state
        else {
            return
        }

        onTargetConsumed()

        guard result.snapshot.nodes
            .contains(
                where: {
                    $0.id == targetNodeID
                }
            )
        else {
            showNotice(
                "This node is no longer available in Universe"
            )
            return
        }

        selectedNodeID = targetNodeID
        sheetSelection = .node(
            targetNodeID
        )
    }
}
