import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension UniverseMapView {
    var galaxyMenu: some View {
        Menu {
            Picker("", selection: $activeGalaxyID) {
                Text("All Galaxies")
                    .tag(String?.none)

                ForEach(galaxies.sorted { $0.order < $1.order }) { galaxy in
                    Label {
                        Text(galaxy.title)
                    } icon: {
                        Image(systemName: "circle.fill")
                            .foregroundStyle(UniversePalette.color(hex: galaxy.color))
                    }
                    .tag(Optional(galaxy.id))
                }
            }
            .labelsHidden()
            .pickerStyle(.inline)
        } label: {
            Text(galaxies.first { $0.id == activeGalaxyID }?.title ?? "All Galaxies")
                .font(.subheadline)
                .lineLimit(1)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .accessibilityLabel("Select Galaxy")
        .simultaneousGesture(
            TapGesture().onEnded { onOpenGalaxyMenu() }
        )
    }

    @ViewBuilder
    var modeHint: some View {
        switch mode {
        case .placingNode:
            Label("Tap the map to place a node", systemImage: "plus.circle")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(.thinMaterial, in: Capsule())

        case .movingNode:
            HStack(spacing: 8) {
                Text("Drag to move the node")
                    .font(.subheadline)

                Button("Cancel") {
                    draftPositions.removeAll()
                    onModeChange(.browse)
                }
                .font(.subheadline.weight(.medium))
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(.thinMaterial, in: Capsule())

        case .browse:
            EmptyView()
        }
    }

    func planet(
        _ node: UniverseNode,
        size: CGSize
    ) -> some View {
        let position = draftPositions[node.id] ?? node.position
        let point = screenPoint(for: position, viewport: viewport)
        let neighborIDs = directNeighborIDs
        let isSelected = selectedNodeID == node.id
        let isNeighbor = neighborIDs.contains(node.id)
        let inGalaxy = activeGalaxyID == nil
            || node.galaxies.contains { $0.id == activeGalaxyID }
        let faded = !isSelected
            && !isNeighbor
            && (selectedNodeID != nil || !inGalaxy)
        let memberships = sortedMemberships(node.galaxies)
        let primary = memberships.first
            .flatMap { membership in
                galaxies.first { $0.id == membership.id }
            }
        let radius = planetRadius(node.importance)
        let showTitle = shouldShowTitle(
            importance: node.importance,
            scale: viewport.scale
        )

        return UniversePlanet(
            node: node,
            memberships: memberships,
            galaxies: galaxies,
            primaryHex: primary?.color,
            radius: radius,
            showTitle: showTitle,
            isSelected: isSelected
        )
        .opacity(faded ? 0.28 : 1)
        .position(
            x: CGFloat(point.x),
            y: CGFloat(point.y)
        )
        .onTapGesture {
            guard mode == .browse else { return }

            if selectedNodeID == node.id {
                onOpenNode(node.id)
            } else {
                onSelectNode(node.id)
            }
        }
        .simultaneousGesture(
            moveGesture(for: node, size: size)
        )
        .accessibilityLabel(node.title)
        .accessibilityHint(
            isSelected
                ? "Tap again for details. Long press to move."
                : "Tap to select. Long press to move."
        )
    }

    func sortedMemberships(
        _ memberships: [UniverseGalaxyMembership]
    ) -> [UniverseGalaxyMembership] {
        let order = Dictionary(
            uniqueKeysWithValues: galaxies.map {
                ($0.id, $0.order)
            }
        )

        return memberships.sorted {
            if $0.weight != $1.weight {
                return $0.weight > $1.weight
            }

            let left = order[$0.id] ?? .greatestFiniteMagnitude
            let right = order[$1.id] ?? .greatestFiniteMagnitude
            if left != right {
                return left < right
            }

            return $0.id < $1.id
        }
    }

    func planetRadius(_ importance: String?) -> CGFloat {
        switch importance {
        case "anchor":
            return 18
        case "major":
            return 15
        default:
            return 12
        }
    }

    func shouldShowTitle(
        importance: String?,
        scale: Double
    ) -> Bool {
        switch importance {
        case "anchor":
            return scale >= 0.35
        case "major":
            return scale >= 0.55
        default:
            return scale >= 0.8
        }
    }
}
