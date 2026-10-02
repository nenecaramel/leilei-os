import SwiftUI
import UIKit

enum DaySpaceHash {
    static func hash(_ value: String) -> UInt32 {
        var hash: UInt32 = 2_166_136_261

        for codeUnit in value.utf16 {
            hash ^= UInt32(codeUnit)
            hash = hash &* 16_777_619
        }

        return hash
    }

    static func seededUnit(_ seed: String) -> Double {
        Double(hash(seed) % 100_000)
            / 100_000
    }
}

enum DaySpaceDate {
    static func businessDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    static func isValid(_ value: String) -> Bool {
        date(value) != nil
    }

    nonisolated static func date(_ value: String) -> Date? {
        let components = value.split(
            separator: "-",
            omittingEmptySubsequences: false
        )

        guard components.count == 3,
              let year = Int(components[0]),
              let month = Int(components[1]),
              let day = Int(components[2]),
              (1...12).contains(month),
              (1...31).contains(day)
        else {
            return nil
        }

        var calendar = Calendar(
            identifier: .gregorian
        )
        calendar.timeZone = .current

        guard let date = calendar.date(
            from: DateComponents(
                year: year,
                month: month,
                day: day
            )
        ) else {
            return nil
        }

        let resolved = calendar.dateComponents(
            [.year, .month, .day],
            from: date
        )

        guard resolved.year == year,
              resolved.month == month,
              resolved.day == day
        else {
            return nil
        }

        return date
    }

    static func shift(
        _ value: String,
        by amount: Int
    ) -> String {
        guard let date = date(value),
              let shifted = Calendar.current.date(
                byAdding: .day,
                value: amount,
                to: date
              )
        else {
            return value
        }

        return businessDate(shifted)
    }

    static func rowLabel(_ value: String) -> String {
        let components = value.split(
            separator: "-",
            omittingEmptySubsequences: false
        )
        guard components.count == 3,
              let month = Int(components[1]),
              let day = Int(components[2])
        else {
            return value
        }

        return "\(month)/\(day)"
    }

    static func paperLabel(_ value: String) -> String {
        value.replacingOccurrences(
            of: "-",
            with: "."
        )
    }

    nonisolated static func fullLabel(_ value: String) -> String {
        guard let date = date(value) else {
            return value
        }

        return date.formatted(
            .dateTime
                .month(.wide)
                .day()
                .year()
        )
    }

    static func toolbarLabel(_ value: String) -> String {
        guard let date = date(value) else {
            return value
        }

        return date.formatted(
            .dateTime
                .month(.abbreviated)
                .day()
        )
    }
}
