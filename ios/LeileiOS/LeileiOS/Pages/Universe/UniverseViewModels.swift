import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct UniverseNodeDraft: Equatable {
    struct MembershipDraft: Identifiable, Equatable {
        let id: String
        var weightText: String

        var percentText: String {
            guard let value = Double(weightText) else {
                return ""
            }
            return UniverseNodeDraft.roundedText(
                value * 100,
                maximumFractionDigits: 3
            )
        }
    }

    var title: String
    var summary: String
    var content: String
    var type: String
    var importance: String
    var tagsText: String
    var memberships: [MembershipDraft]
    var sourceDiaryIDs: [String]

    init(
        node: UniverseNode?,
        sourceDiaryIDs: [String]
    ) {
        title = node?.title ?? ""
        summary = node?.summary ?? ""
        content = node?.content ?? ""
        type = node?.type ?? "concept"
        importance = node?.importance ?? "normal"
        tagsText = (node?.tags ?? []).joined(separator: ", ")
        memberships = (node?.galaxies ?? []).map {
            MembershipDraft(
                id: $0.id,
                weightText: UniverseNodeDraft.numberText(
                    $0.weight
                )
            )
        }
        self.sourceDiaryIDs = sourceDiaryIDs
    }

    var tags: [String] {
        tagsText
            .replacingOccurrences(
                of: "，",
                with: ","
            )
            .split(separator: ",")
            .map {
                $0.trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
            }
            .filter { !$0.isEmpty }
    }

    var canonicalMemberships:
        [UniverseGalaxyMembership]? {
        var seen = Set<String>()
        var result: [UniverseGalaxyMembership] = []

        for membership in memberships {
            guard seen.insert(membership.id).inserted,
                  let weight = Double(
                    membership.weightText
                        .trimmingCharacters(
                            in: .whitespacesAndNewlines
                        )
                  ),
                  weight.isFinite
            else {
                return nil
            }

            result.append(
                UniverseGalaxyMembership(
                    id: membership.id,
                    weight: weight
                )
            )
        }

        return result
    }

    static func numberText(
        _ value: Double
    ) -> String {
        String(value)
    }

    static func canonicalWeightText(
        fromPercent percent: Double
    ) -> String {
        roundedText(
            percent / 100,
            maximumFractionDigits: 6
        )
    }

    static func roundedText(
        _ value: Double,
        maximumFractionDigits: Int
    ) -> String {
        let formatter = NumberFormatter()
        formatter.locale =
            Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits =
            maximumFractionDigits

        return formatter.string(
            from: NSNumber(value: value)
        ) ?? String(value)
    }
}

enum UniverseMapMode: Equatable {
    case browse
    case placingNode
    case movingNode(String)
}

enum UniversePageState {
    case loading
    case notInitialized
    case failed
    case ready(UniverseReadResult)
}

enum UniverseSheetSelection:
    Identifiable,
    Equatable {
    case node(String)
    case create(UniversePosition)

    var id: String {
        switch self {
        case .node(let id):
            return "node:\(id)"
        case .create(let position):
            return "create:\(position.x):\(position.y)"
        }
    }
}
