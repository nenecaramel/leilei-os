import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension UniverseNodeSheet {
    var contextLine: String? {
        if isCreate {
            return "New Node · Draft"
        }

        guard let node else {
            return nil
        }

        return "Current Node · \(node.title)"
    }

    var isCreate: Bool {
        if case .create = mode {
            return true
        }
        return false
    }

    private var createPosition: UniversePosition? {
        if case .create(let position) = mode {
            return position
        }
        return nil
    }

    var canSave: Bool {
        !isSaving
            && !draft.title
                .trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
                .isEmpty
            && draft.canonicalMemberships != nil
    }

    var availableNodeTypes: [String] {
        var values = UniverseNodeOptions.types
        if !values.contains(draft.type) {
            values.append(draft.type)
        }
        return values
    }

    var availableImportance: [String] {
        var values = UniverseNodeOptions.importance
        if !values.contains(draft.importance) {
            values.append(draft.importance)
        }
        return values
    }

    var relationCandidates:
        [UniverseNode] {
        guard let node else {
            return []
        }

        return allNodes.filter {
            $0.id != node.id
        }
    }

    func save() async {
        guard canSave else {
            return
        }

        isSaving = true
        errorMessage = nil
        defer {
            isSaving = false
        }

        do {
            try await onSave(
                draft,
                createPosition
            )

            if isCreate {
                onClose()
            } else {
                isEditing = false
            }
        } catch {
            errorMessage =
                UniverseAPIService.userMessage(
                    for: error
                )
        }
    }

    func delete(
        _ node: UniverseNode
    ) async {
        isSaving = true
        errorMessage = nil
        defer {
            isSaving = false
        }

        do {
            try await onDelete(node)
            onClose()
        } catch {
            errorMessage =
                UniverseAPIService.userMessage(
                    for: error
                )
        }
    }

    func restore(
        _ node: UniverseNode
    ) async {
        isSaving = true
        errorMessage = nil
        defer {
            isSaving = false
        }

        do {
            try await onRestore(node)
        } catch {
            errorMessage =
                UniverseAPIService.userMessage(
                    for: error
                )
        }
    }

    func deleteRelation(
        _ relation: UniverseRelation
    ) async {
        isSaving = true
        errorMessage = nil
        defer {
            isSaving = false
        }

        do {
            try await onDeleteRelation(
                relation
            )
        } catch {
            errorMessage =
                UniverseAPIService.userMessage(
                    for: error
                )
        }
    }

    func resetDraft() {
        draft = UniverseNodeDraft(
            node: node,
            sourceDiaryIDs:
                sources.map(\.diaryId)
        )
    }

    func formattedDate(
        _ value: String
    ) -> String {
        let fractional =
            ISO8601DateFormatter()
        fractional.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds,
        ]

        let standard =
            ISO8601DateFormatter()
        standard.formatOptions = [
            .withInternetDateTime,
        ]

        guard let date =
            fractional.date(from: value)
                ?? standard.date(
                    from: value
                )
        else {
            return value
        }

        return date.formatted(
            date: .abbreviated,
            time: .omitted
        )
    }

    func formattedMembershipWeight(
        _ weight: Double
    ) -> String {
        if weight >= 0,
           weight <= 1 {
            return "\(Int((weight * 100).rounded()))%"
        }

        return weight.formatted(
            .number.precision(
                .fractionLength(0...2)
            )
        )
    }

    func sourceDate(
        _ value: String
    ) -> String {
        let prefix = String(
            value.prefix(10)
        )
        let parts = prefix.split(
            separator: "-"
        )

        guard parts.count == 3 else {
            return prefix
        }

        return "\(parts[0]).\(parts[1]).\(parts[2])"
    }
}
