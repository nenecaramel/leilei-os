import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension UniverseMapView {
    func mapDragGesture(
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

            guard magnifyOrigin == nil else {
                return
            }

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

            guard !suppressMapDragCompletion else {
                return
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

    func magnificationGesture(
        size: CGSize
    ) -> some Gesture {
        MagnifyGesture()
            .onChanged { value in
                if magnifyOrigin == nil {
                    magnifyOrigin = viewport
                    suppressMapDragCompletion = true
                    dragOrigin = nil
                }

                guard let origin = magnifyOrigin else {
                    return
                }

                viewport = zoomed(
                    origin,
                    around: value.startLocation,
                    requestedScale:
                        origin.scale
                        * Double(value.magnification)
                )
            }
            .onEnded { _ in
                magnifyOrigin = nil
                persistViewport()

                Task { @MainActor in
                    try? await Task.sleep(
                        for: .milliseconds(120)
                    )
                    suppressMapDragCompletion = false
                }
            }
    }

    func moveGesture(
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
                guard case .second(true, let drag?) = value else {
                    return
                }

                let distance = hypot(
                    drag.translation.width,
                    drag.translation.height
                )
                guard distance > 8 else {
                    return
                }

                if case .browse = mode {
                    onSelectNode(node.id)
                    onModeChange(.movingNode(node.id))
                }

                guard case .movingNode(let nodeID) = mode,
                      nodeID == node.id
                else {
                    return
                }

                draftPositions[node.id] = canonicalPosition(
                    fromScreen: drag.location,
                    viewport: viewport
                )
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
                        _ = draftPositions.removeValue(forKey: node.id)
                    }
                }
            }
    }
}
