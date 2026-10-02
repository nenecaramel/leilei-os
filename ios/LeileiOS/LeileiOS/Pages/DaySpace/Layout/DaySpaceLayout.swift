import SwiftUI
import UIKit

enum DaySpacePaperSize {
    case small
    case medium
    case large
}

struct DaySpaceLayoutItem {
    let id: String
    let left: CGFloat
    let top: CGFloat
    let width: CGFloat
    let height: CGFloat
    let rotation: Double
    let zIndex: Int
    let size: DaySpacePaperSize
}

struct DaySpaceLayout {
    let items: [DaySpaceLayoutItem]
    let stageHeight: CGFloat

    var itemsByID: [String: DaySpaceLayoutItem] {
        Dictionary(
            uniqueKeysWithValues: items.map {
                ($0.id, $0)
            }
        )
    }

    static func layout(
        dateKey: String,
        papers: [DaySpacePaperSelection],
        rawStageWidth: CGFloat
    ) -> DaySpaceLayout {
        let stageWidth = max(280, rawStageWidth)
        let ordered = papers.sorted {
            DaySpaceHash.hash("\(dateKey):\($0.id):order")
                < DaySpaceHash.hash("\(dateKey):\($1.id):order")
        }

        var placed: [DaySpaceLayoutItem] = []
        let laneRatios: [CGFloat] = [0, 0.5, 1]

        for (index, paper) in ordered.enumerated() {
            let seed = "\(dateKey):\(paper.id)"
            let density = max(1, paper.density)
            let size = chooseSize(
                seed: seed,
                density: density
            )
            let dimensions = dimensions(
                size: size,
                stageWidth: stageWidth
            )
            let width = dimensions.width
            let height = dimensions.height
            let maxLeft = max(0, stageWidth - width)

            var lane = Int(
                DaySpaceHash.hash("\(seed):lane")
                    % UInt32(laneRatios.count)
            )

            if index > 0 {
                let previous = placed[index - 1]
                let previousCenter = previous.left
                    + previous.width / 2
                let candidateCenter = maxLeft
                    * laneRatios[lane]
                    + width / 2

                if abs(previousCenter - candidateCenter) < 62 {
                    lane = (
                        lane
                        + 1
                        + Int(
                            DaySpaceHash.hash(
                                "\(seed):lane-shift"
                            ) % 2
                        )
                    ) % 3
                }
            }

            let horizontalJitter = CGFloat(
                DaySpaceHash.seededUnit("\(seed):x") - 0.5
            ) * min(26, maxLeft * 0.14)

            var left = clamp(
                maxLeft * laneRatios[lane]
                    + horizontalJitter,
                min: 0,
                max: maxLeft
            )

            let bandStep = 103
                + DaySpaceHash.seededUnit(
                    "\(dateKey):\(index):band-step"
                ) * 31

            var top = 10
                + Double(index) * bandStep
                + (
                    DaySpaceHash.seededUnit(
                        "\(seed):y"
                    ) - 0.5
                ) * 34

            let rotation = -3.4
                + DaySpaceHash.seededUnit(
                    "\(seed):rotation"
                ) * 6.8

            for attempt in 0..<12 {
                let candidate = DaySpaceLayoutCandidate(
                    left: left,
                    top: CGFloat(top),
                    width: width,
                    height: height
                )

                let worst = placed.reduce(
                    CGFloat.zero
                ) { value, existing in
                    max(
                        value,
                        overlapFraction(
                            existing,
                            candidate
                        )
                    )
                }

                if worst <= 0.15 {
                    break
                }

                let alternateLane = (
                    lane + 1 + attempt
                ) % 3

                left = clamp(
                    maxLeft * laneRatios[alternateLane]
                        + CGFloat(
                            DaySpaceHash.seededUnit(
                                "\(seed):retry-x:\(attempt)"
                            ) - 0.5
                        ) * 20,
                    min: 0,
                    max: maxLeft
                )

                top += 16 + Double(attempt) * 4
            }

            placed.append(
                DaySpaceLayoutItem(
                    id: paper.id,
                    left: left,
                    top: max(0, CGFloat(top)),
                    width: width,
                    height: height,
                    rotation: rotation,
                    zIndex: 2 + Int(
                        DaySpaceHash.hash(
                            "\(seed):z"
                        ) % 7
                    ),
                    size: size
                )
            )
        }

        let finalBottom = placed.reduce(
            CGFloat.zero
        ) {
            max(
                $0,
                $1.top + $1.height
            )
        }

        return DaySpaceLayout(
            items: placed,
            stageHeight: max(
                260,
                finalBottom + 52
            )
        )
    }

    private static func chooseSize(
        seed: String,
        density: Int
    ) -> DaySpacePaperSize {
        if density >= 5 {
            return .large
        }

        if density <= 1 {
            return DaySpaceHash.seededUnit(
                "\(seed):size"
            ) < 0.74
                ? .small
                : .medium
        }

        if density >= 4 {
            return DaySpaceHash.seededUnit(
                "\(seed):size"
            ) < 0.64
                ? .large
                : .medium
        }

        return DaySpaceHash.seededUnit(
            "\(seed):size"
        ) < 0.58
            ? .medium
            : .large
    }

    private static func dimensions(
        size: DaySpacePaperSize,
        stageWidth: CGFloat
    ) -> (width: CGFloat, height: CGFloat) {
        switch size {
        case .small:
            return (
                min(158, stageWidth * 0.46),
                112
            )

        case .medium:
            return (
                min(186, stageWidth * 0.55),
                134
            )

        case .large:
            return (
                min(218, stageWidth * 0.64),
                158
            )
        }
    }

    private static func overlapFraction(
        _ left: DaySpaceLayoutItem,
        _ right: DaySpaceLayoutCandidate
    ) -> CGFloat {
        let width = max(
            0,
            min(
                left.left + left.width,
                right.left + right.width
            ) - max(left.left, right.left)
        )

        let height = max(
            0,
            min(
                left.top + left.height,
                right.top + right.height
            ) - max(left.top, right.top)
        )

        guard width > 0,
              height > 0
        else {
            return 0
        }

        let overlapArea = width * height
        let smallerArea = min(
            left.width * left.height,
            right.width * right.height
        )

        return overlapArea / smallerArea
    }

    private static func clamp(
        _ value: CGFloat,
        min minimum: CGFloat,
        max maximum: CGFloat
    ) -> CGFloat {
        Swift.max(
            minimum,
            Swift.min(
                maximum,
                value
            )
        )
    }
}

private struct DaySpaceLayoutCandidate {
    let left: CGFloat
    let top: CGFloat
    let width: CGFloat
    let height: CGFloat
}
