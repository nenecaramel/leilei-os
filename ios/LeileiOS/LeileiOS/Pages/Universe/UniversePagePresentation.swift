import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension UniverseView {
    var universeLoading: some View {
        VStack(spacing: 14) {
            ProgressView()
            Text("Reading...")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    var universeFailure: some View {
        AppStateSurface(
            title: "Unable to read Universe",
            actionTitle: "Retry"
        ) {
            Task {
                await load()
            }
        }
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity
        )
    }

    var universeImport: some View {
        ScrollView {
            VStack(
                spacing: 18
            ) {
                Spacer(minLength: 100)

                Image(
                    systemName:
                        "sparkles.rectangle.stack"
                )
                .font(
                    .system(
                        size: 38,
                        weight: .light
                    )
                )
                .foregroundStyle(.secondary)

                Text("Universe is empty")
                    .font(.title3.weight(.medium))

                if let importFileName {
                    Text(importFileName)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if let importPreview {
                    VStack(spacing: 6) {
                        Text(
                            "Galaxies: \(importPreview.galaxies) · "
                                + "Nodes: \(importPreview.nodes) · "
                                + "Connections: \(importPreview.relations) · "
                                + "Revisions: \(importPreview.revisions)"
                        )

                        Text(
                            importPreview.conversions
                                .joined(separator: " · ")
                        )
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                }

                if let importError {
                    Text(importError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }

                if importCommitting {
                    ProgressView("Importing…")
                }

                VStack(spacing: 10) {
                    if importUncertain {
                        Button("Reload") {
                            Task {
                                await recheckImport()
                            }
                        }
                        .buttonStyle(.borderedProminent)
                    } else {
                        if importFileName == nil {
                            Button(
                                "Select Universe JSON"
                            ) {
                                importPresented = true
                            }
                            .buttonStyle(.borderedProminent)
                        }

                        if importPreview != nil {
                            Button("Confirm Import") {
                                Task {
                                    await confirmImport()
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(importCommitting)
                        }

                        if importFileName != nil {
                            Button("Choose Another File") {
                                importPresented = true
                            }
                            .buttonStyle(.bordered)
                            .disabled(importCommitting)

                            Button("Cancel") {
                                discardImportSelection()
                            }
                            .buttonStyle(.bordered)
                            .disabled(importCommitting)
                        }
                    }
                }
            }
            .padding(.horizontal, 24)
            .frame(
                maxWidth: 620
            )
            .frame(maxWidth: .infinity)
        }
    }

    func universeReady(
        _ result: UniverseReadResult
    ) -> some View {
        ZStack(alignment: .top) {
            UniverseMapView(
                nodes: result.snapshot.nodes,
                galaxies: result.snapshot.galaxies,
                relations: result.snapshot.relations,
                selectedNodeID: selectedNodeID,
                activeGalaxyID: activeGalaxyID,
                mode: mapMode,
                onSelectNode: { nodeID in
                    selectedNodeID = nodeID
                },
                onOpenNode: { nodeID in
                    selectedNodeID = nodeID
                    sheetSelection = .node(nodeID)
                },
                onPlaceNode: { position in
                    selectedNodeID = nil
                    sheetSelection = .create(position)
                },
                onMoveNode: {
                    nodeID,
                    position in
                    await moveNode(
                        nodeID,
                        to: position
                    )
                },
                onModeChange: {
                    mapMode = $0
                }
            )

            if let notice {
                Text(notice)
                    .font(.subheadline)
                    .foregroundStyle(
                        Color.white.opacity(0.82)
                    )
                    .padding(
                        .horizontal,
                        13
                    )
                    .padding(
                        .vertical,
                        8
                    )
                    .background(
                        .thinMaterial,
                        in: Capsule()
                    )
                    .padding(.top, 8)
                    .transition(
                        .opacity.combined(
                            with: .move(
                                edge: .top
                            )
                        )
                    )
            }
        }
    }

    @ToolbarContentBuilder
    func readyToolbar(
        _ result: UniverseReadResult
    ) -> some ToolbarContent {
        ToolbarItemGroup(
            placement: .topBarTrailing
        ) {
            Menu {
                Picker(
                    "",
                    selection: $activeGalaxyID
                ) {
                    Text("All Galaxies")
                        .tag(String?.none)

                    ForEach(
                        result.snapshot.galaxies
                            .sorted {
                                $0.order < $1.order
                            }
                    ) { galaxy in
                        Label {
                            Text(galaxy.title)
                        } icon: {
                            Image(
                                systemName:
                                    "circle.fill"
                            )
                            .foregroundStyle(
                                UniversePalette.color(
                                    hex: galaxy.color
                                )
                            )
                        }
                        .tag(
                            Optional(
                                galaxy.id
                            )
                        )
                    }
                }
                .labelsHidden()
                .pickerStyle(.inline)
            } label: {
                Image(systemName: "circle.grid.2x2")
            }
            .accessibilityLabel("Select Galaxy")
            .simultaneousGesture(
                TapGesture()
                    .onEnded {
                        cancelPlacementForToolbarMenu()
                    }
            )

            Button {
                notice = nil

                if case .placingNode = mapMode {
                    mapMode = .browse
                } else {
                    selectedNodeID = nil
                    mapMode = .placingNode
                }
            } label: {
                Image(
                    systemName:
                        mapMode == .placingNode
                            ? "xmark"
                            : "plus"
                )
            }
            .accessibilityLabel(
                mapMode == .placingNode
                    ? "Cancel Adding Node"
                    : "Add Node"
            )

            Menu {
                Button {
                    prepareExport(
                        result.snapshot
                    )
                } label: {
                    Label(
                        "Export Universe",
                        systemImage:
                            "square.and.arrow.up"
                    )
                }
            } label: {
                Image(systemName: "ellipsis")
            }
            .accessibilityLabel(
                "Universe actions"
            )
            .simultaneousGesture(
                TapGesture()
                    .onEnded {
                        cancelPlacementForToolbarMenu()
                    }
            )
        }
    }
}
