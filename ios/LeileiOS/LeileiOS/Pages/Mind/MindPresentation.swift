import Foundation

enum MindPresentation {
    static func filterDayKey(_ date: Date) -> String {
        filterDayFormatter().string(from: date)
    }

    static func filterDayDate(_ key: String?) -> Date {
        key.flatMap { filterDayFormatter().date(from: $0) } ?? Date()
    }

    private static func filterDayFormatter() -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }

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
