import Foundation

// The parent tool explicitly selects this presentation; no title matching.
enum NativeLiveInteractionHistoryPresentation {
    case standard
    case nestedPermission

    func title(for interaction: NativeLiveRuntimeInteractionSnapshot) -> String {
        if interaction.kind == "permission" {
            return self == .nestedPermission ? "Permission" : interaction.permissionTitle
        }
        if let question = interaction.questions.first {
            return question.header ?? question.text
        }
        return interaction.kind.capitalized
    }

    func statusLabel(for interaction: NativeLiveRuntimeInteractionSnapshot) -> String {
        guard self == .nestedPermission, interaction.kind == "permission" else {
            return interaction.status.capitalized
        }
        if interaction.status == "cancelled" { return "Cancelled" }
        if interaction.status == "resolved" {
            switch interaction.response?["decision"]?.stringValue {
            case "allow": return "Allowed"
            case "deny": return "Denied"
            default: return "Resolved"
            }
        }
        return interaction.status.capitalized
    }
}
