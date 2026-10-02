import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct UniverseMapCanvas: View {
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
