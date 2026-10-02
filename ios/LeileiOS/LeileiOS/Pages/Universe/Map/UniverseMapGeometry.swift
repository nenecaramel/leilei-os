import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension UniverseMapView {
    var directNeighborIDs: Set<String> {
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

    func initializeViewportIfNeeded(
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

    func viewportInitializationKey(
        size: CGSize
    ) -> String {
        "\(Int(size.width))x\(Int(size.height))"
    }

    func fitAll(
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

    func reveal(
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

    func persistViewport(
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

    func screenPoint(
        for position: UniversePosition,
        viewport: UniverseViewport
    ) -> UniversePosition {
        let world = worldPoint(for: position)
        return UniversePosition(
            x: world.x * viewport.scale + viewport.x,
            y: world.y * viewport.scale + viewport.y
        )
    }

    func canonicalPosition(
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

    func zoomed(
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
