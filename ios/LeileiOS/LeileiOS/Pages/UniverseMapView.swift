import Foundation
import SwiftUI

enum UniverseMapMode: Equatable {
    case browse
    case placingNode
    case movingNode(String)
}

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

    @State private var viewport = UniverseViewport(x: 0, y: 0, scale: 1)
    @State private var dragOrigin: UniverseViewport?
    @State private var magnifyOrigin: UniverseViewport?
    @State private var draftPositions: [String: UniversePosition] = [:]
    @State private var hasInitializedViewport = false

    private let viewportStorageKey = "universe.native.viewport.v1"

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
                            Text("查看全部")
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

    @ViewBuilder
    private var modeHint: some View {
        switch mode {
        case .placingNode:
            Label("点击星图放置新星球", systemImage: "plus.circle")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(.thinMaterial, in: Capsule())

        case .movingNode:
            HStack(spacing: 8) {
                Text("拖动星球调整位置")
                    .font(.subheadline)

                Button("取消") {
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

    private func planet(
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
        .highPriorityGesture(
            moveGesture(for: node, size: size)
        )
        .accessibilityLabel(node.title)
        .accessibilityHint(
            isSelected
                ? "再次轻点打开详情，长按拖动位置"
                : "轻点选择，长按拖动位置"
        )
    }

    private func mapDragGesture(
        size: CGSize
    ) -> some Gesture {
        DragGesture(
            minimumDistance: 0,
            coordinateSpace: .named("UniverseNativeMap")
        )
        .onChanged { value in
            let distance = hypot(
                value.translation.width,
                value.translation.height
            )

            if dragOrigin == nil {
                dragOrigin = viewport
            }

            guard distance > 8,
                  let origin = dragOrigin
            else {
                return
            }

            if case .movingNode = mode {
                return
            }

            viewport = UniverseViewport(
                x: origin.x + Double(value.translation.width),
                y: origin.y + Double(value.translation.height),
                scale: origin.scale
            )
        }
        .onEnded { value in
            defer {
                dragOrigin = nil
            }

            let distance = hypot(
                value.translation.width,
                value.translation.height
            )

            if distance <= 8 {
                if case .placingNode = mode {
                    let canonical = canonicalPosition(
                        fromScreen: value.location,
                        viewport: viewport
                    )
                    onPlaceNode(canonical)
                    onModeChange(.browse)
                } else if case .browse = mode {
                    onSelectNode(nil)
                }
                return
            }

            persistViewport()
        }
    }

    private func magnificationGesture(
        size: CGSize
    ) -> some Gesture {
        MagnificationGesture()
            .onChanged { magnification in
                if magnifyOrigin == nil {
                    magnifyOrigin = viewport
                }

                guard let origin = magnifyOrigin else {
                    return
                }

                viewport = zoomed(
                    origin,
                    around: CGPoint(
                        x: size.width / 2,
                        y: size.height / 2
                    ),
                    requestedScale:
                        origin.scale * Double(magnification)
                )
            }
            .onEnded { _ in
                magnifyOrigin = nil
                persistViewport()
            }
    }

    private func moveGesture(
        for node: UniverseNode,
        size: CGSize
    ) -> some Gesture {
        LongPressGesture(
            minimumDuration: 0.45,
            maximumDistance: 8
        )
            .sequenced(
                before: DragGesture(
                    minimumDistance: 0,
                    coordinateSpace: .named("UniverseNativeMap")
                )
            )
            .onChanged { value in
                switch value {
                case .first(true):
                    guard mode == .browse else { return }
                    onSelectNode(node.id)
                    onModeChange(.movingNode(node.id))

                case .second(true, let drag?):
                    guard case .movingNode(let nodeID) = mode,
                          nodeID == node.id
                    else {
                        return
                    }

                    draftPositions[node.id] = canonicalPosition(
                        fromScreen: drag.location,
                        viewport: viewport
                    )

                default:
                    break
                }
            }
            .onEnded { value in
                guard case .second(true, let drag?) = value else {
                    draftPositions.removeValue(forKey: node.id)
                    if case .movingNode(let nodeID) = mode,
                       nodeID == node.id {
                        onModeChange(.browse)
                    }
                    return
                }

                let distance = hypot(
                    drag.translation.width,
                    drag.translation.height
                )
                guard distance > 8 else {
                    draftPositions.removeValue(forKey: node.id)
                    onModeChange(.browse)
                    return
                }

                let position = canonicalPosition(
                    fromScreen: drag.location,
                    viewport: viewport
                )
                draftPositions[node.id] = position
                onModeChange(.browse)

                Task {
                    await onMoveNode(node.id, position)
                    await MainActor.run {
                        draftPositions.removeValue(forKey: node.id)
                    }
                }
            }
    }

    private var directNeighborIDs: Set<String> {
        guard let selectedNodeID else {
            return []
        }

        var result = Set<String>()
        for relation in relations {
            if relation.source == selectedNodeID {
                result.insert(relation.target)
            }
            if relation.target == selectedNodeID {
                result.insert(relation.source)
            }
        }
        return result
    }

    private func sortedMemberships(
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

    private func planetRadius(_ importance: String?) -> CGFloat {
        switch importance {
        case "anchor":
            return 18
        case "major":
            return 15
        default:
            return 12
        }
    }

    private func shouldShowTitle(
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

    private func initializeViewportIfNeeded(
        size: CGSize
    ) {
        guard !hasInitializedViewport,
              size.width > 0,
              size.height > 0
        else {
            return
        }

        hasInitializedViewport = true

        if let data = UserDefaults.standard.data(
            forKey: viewportStorageKey
        ),
           let stored = try? JSONDecoder().decode(
                UniverseViewport.self,
                from: data
           ) {
            viewport = stored.clamped()
        } else {
            viewport = fitViewport(in: size)
        }
    }

    private func viewportInitializationKey(
        size: CGSize
    ) -> String {
        "\(Int(size.width))x\(Int(size.height))"
    }

    private func fitAll(
        in size: CGSize
    ) {
        viewport = fitViewport(in: size)
        persistViewport()
    }

    private func fitViewport(
        in size: CGSize
    ) -> UniverseViewport {
        let points = nodes.map {
            worldPoint(for: $0.position)
        }

        guard !points.isEmpty,
              size.width > 0,
              size.height > 0
        else {
            return UniverseViewport(
                x: Double(size.width / 2),
                y: Double(size.height / 2),
                scale: 1
            )
        }

        let xs = points.map(\.x)
        let ys = points.map(\.y)
        guard let minX = xs.min(),
              let maxX = xs.max(),
              let minY = ys.min(),
              let maxY = ys.max()
        else {
            return viewport
        }

        let padding = 24.0
        let availableWidth = max(
            1,
            Double(size.width) - padding * 2
        )
        let availableHeight = max(
            1,
            Double(size.height) - padding * 2
        )
        let requestedScale = min(
            availableWidth / max(1, maxX - minX),
            availableHeight / max(1, maxY - minY)
        )
        let scale = min(
            UniverseViewport.maximumScale,
            max(
                UniverseViewport.minimumScale,
                requestedScale
            )
        )
        let centerX = (minX + maxX) / 2
        let centerY = (minY + maxY) / 2

        return UniverseViewport(
            x: Double(size.width) / 2 - centerX * scale,
            y: Double(size.height) / 2 - centerY * scale,
            scale: scale
        )
    }

    private func reveal(
        _ position: UniversePosition,
        in size: CGSize,
        padding: Double = 48
    ) {
        guard size.width > 0,
              size.height > 0
        else {
            return
        }

        let point = screenPoint(
            for: position,
            viewport: viewport
        )
        var next = viewport

        if point.x < padding {
            next.x += padding - point.x
        } else if point.x > Double(size.width) - padding {
            next.x -= point.x - (Double(size.width) - padding)
        }

        if point.y < padding {
            next.y += padding - point.y
        } else if point.y > Double(size.height) - padding {
            next.y -= point.y - (Double(size.height) - padding)
        }

        guard next != viewport else {
            return
        }

        withAnimation(.snappy) {
            viewport = next
        }
        persistViewport(next)
    }

    private func persistViewport(
        _ value: UniverseViewport? = nil
    ) {
        let value = (value ?? viewport).clamped()

        guard let data = try? JSONEncoder().encode(value) else {
            return
        }

        UserDefaults.standard.set(
            data,
            forKey: viewportStorageKey
        )
    }

    private func worldPoint(
        for position: UniversePosition
    ) -> UniversePosition {
        UniversePosition(
            x: position.x * 10,
            y: position.y * 10
        )
    }

    private func screenPoint(
        for position: UniversePosition,
        viewport: UniverseViewport
    ) -> UniversePosition {
        let world = worldPoint(for: position)
        return UniversePosition(
            x: world.x * viewport.scale + viewport.x,
            y: world.y * viewport.scale + viewport.y
        )
    }

    private func canonicalPosition(
        fromScreen point: CGPoint,
        viewport: UniverseViewport
    ) -> UniversePosition {
        let scale = min(
            UniverseViewport.maximumScale,
            max(UniverseViewport.minimumScale, viewport.scale)
        )
        return UniversePosition(
            x:
                ((Double(point.x) - viewport.x) / scale)
                / 10,
            y:
                ((Double(point.y) - viewport.y) / scale)
                / 10
        )
        .clamped()
    }

    private func zoomed(
        _ source: UniverseViewport,
        around point: CGPoint,
        requestedScale: Double
    ) -> UniverseViewport {
        let sourceScale = min(
            UniverseViewport.maximumScale,
            max(UniverseViewport.minimumScale, source.scale)
        )
        let worldX =
            (Double(point.x) - source.x)
            / sourceScale
        let worldY =
            (Double(point.y) - source.y)
            / sourceScale
        let scale = min(
            UniverseViewport.maximumScale,
            max(
                UniverseViewport.minimumScale,
                requestedScale
            )
        )

        return UniverseViewport(
            x: Double(point.x) - worldX * scale,
            y: Double(point.y) - worldY * scale,
            scale: scale
        )
    }
}

private struct UniverseMapCanvas: View {
    let nodes: [UniverseNode]
    let relations: [UniverseRelation]
    let selectedNodeID: String?
    let viewport: UniverseViewport
    let draftPositions: [String: UniversePosition]

    var body: some View {
        Canvas { context, size in
            drawReferenceStars(
                context: &context,
                size: size
            )
            drawRelations(context: &context)
        }
    }

    private func drawReferenceStars(
        context: inout GraphicsContext,
        size: CGSize
    ) {
        let spacing: CGFloat = 42
        var x: CGFloat = 20
        var column = 0

        while x < size.width {
            var y: CGFloat = 22
            var row = 0

            while y < size.height {
                let variation = (row * 7 + column * 11) % 5
                let radius: CGFloat = variation == 0 ? 1.25 : 0.8
                let rect = CGRect(
                    x: x - radius,
                    y: y - radius,
                    width: radius * 2,
                    height: radius * 2
                )
                context.fill(
                    Path(ellipseIn: rect),
                    with: .color(
                        UniversePalette.color(
                            hex:
                                variation == 0
                                    ? "#31323b"
                                    : "#292a32"
                        )
                    )
                )

                row += 1
                y += spacing
            }

            column += 1
            x += spacing
        }
    }

    private func drawRelations(
        context: inout GraphicsContext
    ) {
        let nodeMap = Dictionary(
            uniqueKeysWithValues: nodes.map { ($0.id, $0) }
        )

        for relation in relations {
            guard let source = nodeMap[relation.source],
                  let target = nodeMap[relation.target]
            else {
                continue
            }

            let start = screenPoint(
                draftPositions[source.id] ?? source.position
            )
            let end = screenPoint(
                draftPositions[target.id] ?? target.position
            )
            let emphasized = selectedNodeID != nil
                && (
                    relation.source == selectedNodeID
                    || relation.target == selectedNodeID
                )
            let strength = min(
                1,
                max(0, relation.strength)
            )
            let opacity = emphasized
                ? 0.52 + strength * 0.28
                : selectedNodeID == nil
                    ? 0.18 + strength * 0.22
                    : 0.10
            let width = CGFloat(
                0.75
                    + strength
                        * (emphasized ? 1.15 : 0.85)
            )

            var path = Path()
            path.move(
                to: CGPoint(
                    x: start.x,
                    y: start.y
                )
            )
            path.addLine(
                to: CGPoint(
                    x: end.x,
                    y: end.y
                )
            )
            let relationColor =
                UniversePalette.color(
                    hex:
                        emphasized
                            ? "#676974"
                            : "#343640"
                )

            context.stroke(
                path,
                with: .color(
                    relationColor.opacity(opacity)
                ),
                lineWidth: width
            )

            let midpoint = CGPoint(
                x: (start.x + end.x) / 2,
                y: (start.y + end.y) / 2
            )

            context.draw(
                Text(relation.relationType.label)
                    .font(.caption2)
                    .foregroundStyle(
                        UniversePalette.color(
                            hex:
                                emphasized
                                    ? "#aaaab3"
                                    : "#70727d"
                        )
                        .opacity(opacity)
                    ),
                at: midpoint,
                anchor: .center
            )

            let angle = atan2(
                end.y - start.y,
                end.x - start.x
            )
            let arrowLength: CGFloat = 7
            let arrowAngle: CGFloat = .pi / 7
            var arrow = Path()
            arrow.move(to: end)
            arrow.addLine(
                to: CGPoint(
                    x:
                        end.x
                        - arrowLength
                            * cos(angle - arrowAngle),
                    y:
                        end.y
                        - arrowLength
                            * sin(angle - arrowAngle)
                )
            )
            arrow.move(to: end)
            arrow.addLine(
                to: CGPoint(
                    x:
                        end.x
                        - arrowLength
                            * cos(angle + arrowAngle),
                    y:
                        end.y
                        - arrowLength
                            * sin(angle + arrowAngle)
                )
            )
            context.stroke(
                arrow,
                with: .color(
                    relationColor.opacity(opacity)
                ),
                lineWidth: width
            )
        }
    }

    private func screenPoint(
        _ position: UniversePosition
    ) -> CGPoint {
        CGPoint(
            x: CGFloat(
                position.x * 10 * viewport.scale
                    + viewport.x
            ),
            y: CGFloat(
                position.y * 10 * viewport.scale
                    + viewport.y
            )
        )
    }
}

private struct UniversePlanet: View {
    let node: UniverseNode
    let memberships: [UniverseGalaxyMembership]
    let galaxies: [UniverseGalaxy]
    let primaryHex: String?
    let radius: CGFloat
    let showTitle: Bool
    let isSelected: Bool

    private var sourceColor: Color {
        UniversePalette.color(
            hex: primaryHex
        )
    }

    private var coreColor: Color {
        UniversePalette.blendedColor(
            hex: primaryHex,
            toward:
                isSelected
                    ? "#dedde4"
                    : "#c6c5cd",
            fraction:
                isSelected
                    ? 0.24
                    : 0.32
        )
    }

    var body: some View {
        ZStack {
            ForEach(
                Array(memberships.dropFirst().enumerated()),
                id: \.element.id
            ) { index, membership in
                let color = UniversePalette.color(
                    hex:
                        galaxies.first {
                            $0.id == membership.id
                        }?.color
                )

                Circle()
                    .stroke(
                        color.opacity(
                            min(
                                0.34,
                                0.10
                                    + max(
                                        0,
                                        membership.weight
                                    ) * 0.18
                            )
                        ),
                        lineWidth: 1
                    )
                    .frame(
                        width:
                            (radius + 5 + CGFloat(index) * 4)
                                * 2,
                        height:
                            (radius + 5 + CGFloat(index) * 4)
                                * 2
                    )
            }

            Circle()
                .fill(coreColor)
                .overlay {
                    Circle()
                        .stroke(
                            Color.white.opacity(
                                isSelected ? 0.88 : 0.18
                            ),
                            lineWidth: 1
                        )
                }
                .shadow(
                    color:
                        sourceColor.opacity(
                            isSelected ? 0.32 : 0.13
                        ),
                    radius: isSelected ? 10 : 4
                )
                .frame(
                    width: radius * 2,
                    height: radius * 2
                )

            if showTitle {
                Text(node.title)
                    .font(
                        .system(
                            size: 12,
                            weight:
                                isSelected
                                    ? .medium
                                    : .regular
                        )
                    )
                    .foregroundStyle(
                        Color.white.opacity(
                            isSelected ? 0.9 : 0.72
                        )
                    )
                    .lineLimit(1)
                    .fixedSize()
                    .offset(
                        y: radius + 15
                    )
            }
        }
        .frame(
            width: max(54, radius * 2 + 32),
            height: max(54, radius * 2 + 40)
        )
        .contentShape(Circle())
    }
}

enum UniversePalette {
    static let background = Color(
        red: 11.0 / 255.0,
        green: 12.0 / 255.0,
        blue: 18.0 / 255.0
    )

    static let surface = Color(
        red: 23.0 / 255.0,
        green: 24.0 / 255.0,
        blue: 32.0 / 255.0
    )

    static let border = Color(
        red: 52.0 / 255.0,
        green: 54.0 / 255.0,
        blue: 64.0 / 255.0
    )

    static func blendedColor(
        hex: String?,
        toward targetHex: String,
        fraction: Double
    ) -> Color {
        let source =
            rgb(hex: hex)
                ?? (154, 154, 154)
        let target =
            rgb(hex: targetHex)
                ?? (198, 197, 205)
        let amount = min(
            1,
            max(0, fraction)
        )

        return Color(
            red:
                (source.0
                    + (target.0 - source.0) * amount)
                    / 255,
            green:
                (source.1
                    + (target.1 - source.1) * amount)
                    / 255,
            blue:
                (source.2
                    + (target.2 - source.2) * amount)
                    / 255
        )
    }

    private static func rgb(
        hex: String?
    ) -> (Double, Double, Double)? {
        guard let hex else {
            return nil
        }

        let normalized = hex
            .trimmingCharacters(
                in: CharacterSet(
                    charactersIn: "#"
                )
            )

        guard normalized.count == 6,
              let value = Int(
                normalized,
                radix: 16
              )
        else {
            return nil
        }

        return (
            Double((value >> 16) & 0xff),
            Double((value >> 8) & 0xff),
            Double(value & 0xff)
        )
    }

    static func color(
        hex: String?
    ) -> Color {
        guard let hex else {
            return Color(
                red: 154.0 / 255.0,
                green: 154.0 / 255.0,
                blue: 154.0 / 255.0
            )
        }

        let normalized = hex
            .trimmingCharacters(
                in: CharacterSet(
                    charactersIn: "#"
                )
            )

        guard normalized.count == 6,
              let value = Int(
                normalized,
                radix: 16
              )
        else {
            return Color(
                red: 154.0 / 255.0,
                green: 154.0 / 255.0,
                blue: 154.0 / 255.0
            )
        }

        return Color(
            red:
                Double(
                    (value >> 16) & 0xff
                ) / 255,
            green:
                Double(
                    (value >> 8) & 0xff
                ) / 255,
            blue:
                Double(value & 0xff) / 255
        )
    }
}
