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

    var hasUnsavedChanges: Bool {
        draft != originalDraft
    }

    var confirmationTitle: String {
        switch confirmation {
        case .discardChanges: return "Discard changes?"
        case .deleteNode: return "Delete node?"
        case .restoreVersion: return "Restore previous version?"
        case .removeConnection: return "Remove connection?"
        case nil: return ""
        }
    }

    var confirmationCancelTitle: String {
        confirmation == .discardChanges ? "Keep Editing" : "Cancel"
    }

    var confirmationMessage: String {
        switch confirmation {
        case .discardChanges: return "Your unsaved changes will be lost."
        case .deleteNode: return "This node and its connections will be deleted."
        case .restoreVersion: return "This node will be replaced with its previous version."
        case .removeConnection: return "This connection will be removed. The connected nodes will be kept."
        case nil: return ""
        }
    }

    func cancel() {
        guard !isSaving else { return }
        if isEditing {
            if hasUnsavedChanges {
                confirmation = .discardChanges
            } else {
                discardChanges()
            }
        } else {
            onClose()
        }
    }

    func discardChanges() {
        guard !isSaving else { return }
        confirmation = nil
        resetDraft()
        errorMessage = nil
        if isCreate {
            onClose()
        } else {
            isEditing = false
        }
    }

    var canSave: Bool {
        !isSaving
            && (isCreate || hasUnsavedChanges)
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
        let submittedDraft = draft
        defer {
            isSaving = false
        }

        do {
            try await onSave(
                submittedDraft,
                createPosition
            )

            if isCreate {
                onClose()
            } else {
                originalDraft = submittedDraft
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
        guard !isSaving else { return }
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
        guard !isSaving else { return }
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
        guard !isSaving else { return }
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
        let fresh = UniverseNodeDraft(
            node: node,
            sourceDiaryIDs: sources.map(\.diaryId)
        )
        draft = fresh
        originalDraft = fresh
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
