import Foundation
import SwiftUI

struct UniverseMapView: View {
    let nodes: [UniverseNode]
    let galaxies: [UniverseGalaxy]
    let relations: [UniverseRelation]
    let selectedNodeID: String?
    let activeGalaxyID: String?
    let mode: UniverseMapMode
    let onSelectNode: (String?) -> Void
    let onOpenNode: (String) -> Void
    let onPlaceNode: (UniversePosition) -> Void
    let onMoveNode: (String, UniversePosition) async -> Void
    let onModeChange: (UniverseMapMode) -> Void

    @State var viewport = UniverseViewport(x: 0, y: 0, scale: 1)
    @State var dragOrigin: UniverseViewport?
    @State var magnifyOrigin: UniverseViewport?
    @State var suppressMapDragCompletion = false
    @State var draftPositions: [String: UniversePosition] = [:]
    @State var hasInitializedViewport = false

    let viewportStorageKey = "universe.native.viewport.v1"

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size

            ZStack {
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(mapDragGesture(size: size))

                UniverseMapCanvas(
                    nodes: nodes,
                    relations: relations,
                    selectedNodeID: selectedNodeID,
                    viewport: viewport,
                    draftPositions: draftPositions
                )
                .allowsHitTesting(false)

                ForEach(nodes) { node in
                    planet(node, size: size)
                }

                VStack {
                    HStack {
                        if mode != .browse {
                            modeHint
                        }

                        Spacer()

                        Button {
                            fitAll(in: size)
                        } label: {
                            Text("View All")
                                .font(.subheadline)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }

                    Spacer()
                }
                .padding(16)
            }
            .coordinateSpace(name: "UniverseNativeMap")
            .simultaneousGesture(
                magnificationGesture(size: size)
            )
            .task(id: viewportInitializationKey(size: size)) {
                initializeViewportIfNeeded(size: size)

                if let selectedNodeID,
                   let node = nodes.first(where: { $0.id == selectedNodeID }) {
                    reveal(
                        node.position,
                        in: size
                    )
                }
            }
            .onChange(of: selectedNodeID) { _, nodeID in
                guard let nodeID,
                      let node = nodes.first(where: { $0.id == nodeID })
                else {
                    return
                }

                reveal(
                    node.position,
                    in: size
                )
            }
        }
        .background(UniversePalette.background)
        .clipped()
    }
}
