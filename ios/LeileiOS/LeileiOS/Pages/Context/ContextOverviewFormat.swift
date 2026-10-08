import Foundation

enum ContextOverviewFormat {
    static func clampedProgress(
        _ percentage: Double
    ) -> Double {
        min(
            max(
                percentage / 100,
                0
            ),
            1
        )
    }

    static func percentText(
        _ value: Double
    ) -> String {
        "\(Int(value.rounded()))%"
    }

    static func integerText(
        _ value: Double
    ) -> String {
        Int(value.rounded()).formatted()
    }

    static func normalized(
        _ value: String?
    ) -> String? {
        guard let value else {
            return nil
        }

        let trimmed = value.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return trimmed.isEmpty
            ? nil
            : trimmed
    }
}
