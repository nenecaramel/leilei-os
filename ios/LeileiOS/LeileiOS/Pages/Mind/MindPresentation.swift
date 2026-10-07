import Foundation

enum MindPresentation {
    static func normalized(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return trimmed.isEmpty ? nil : trimmed
    }

    static func sourceLabel(_ source: String) -> String {
        source == "manual" ? "Manual" : "Runtime"
    }

    static func dateText(_ value: String?) -> String? {
        guard let value else { return nil }

        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds
        ]

        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]

        guard let parsed =
            fractional.date(from: value)
            ?? standard.date(from: value) else {
            return nil
        }

        return parsed.formatted(
            date: .abbreviated,
            time: .shortened
        )
    }
}
