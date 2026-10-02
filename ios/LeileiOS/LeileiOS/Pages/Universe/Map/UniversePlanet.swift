import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct UniversePlanet: View {
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
