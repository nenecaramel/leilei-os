import Foundation
import SwiftUI
import UniformTypeIdentifiers

enum UniversePalette {
    static let background = Color(
        red: 11.0 / 255.0,
        green: 12.0 / 255.0,
        blue: 18.0 / 255.0
    )

    static let surface = Color(
        red: 23.0 / 255.0,
        green: 24.0 / 255.0,
        blue: 32.0 / 255.0
    )

    static let border = Color(
        red: 52.0 / 255.0,
        green: 54.0 / 255.0,
        blue: 64.0 / 255.0
    )

    static func blendedColor(
        hex: String?,
        toward targetHex: String,
        fraction: Double
    ) -> Color {
        let source =
            rgb(hex: hex)
                ?? (154, 154, 154)
        let target =
            rgb(hex: targetHex)
                ?? (198, 197, 205)
        let amount = min(
            1,
            max(0, fraction)
        )

        return Color(
            red:
                (source.0
                    + (target.0 - source.0) * amount)
                    / 255,
            green:
                (source.1
                    + (target.1 - source.1) * amount)
                    / 255,
            blue:
                (source.2
                    + (target.2 - source.2) * amount)
                    / 255
        )
    }

    private static func rgb(
        hex: String?
    ) -> (Double, Double, Double)? {
        guard let hex else {
            return nil
        }

        let normalized = hex
            .trimmingCharacters(
                in: CharacterSet(
                    charactersIn: "#"
                )
            )

        guard normalized.count == 6,
              let value = Int(
                normalized,
                radix: 16
              )
        else {
            return nil
        }

        return (
            Double((value >> 16) & 0xff),
            Double((value >> 8) & 0xff),
            Double(value & 0xff)
        )
    }

    static func color(
        hex: String?
    ) -> Color {
        guard let hex else {
            return Color(
                red: 154.0 / 255.0,
                green: 154.0 / 255.0,
                blue: 154.0 / 255.0
            )
        }

        let normalized = hex
            .trimmingCharacters(
                in: CharacterSet(
                    charactersIn: "#"
                )
            )

        guard normalized.count == 6,
              let value = Int(
                normalized,
                radix: 16
              )
        else {
            return Color(
                red: 154.0 / 255.0,
                green: 154.0 / 255.0,
                blue: 154.0 / 255.0
            )
        }

        return Color(
            red:
                Double(
                    (value >> 16) & 0xff
                ) / 255,
            green:
                Double(
                    (value >> 8) & 0xff
                ) / 255,
            blue:
                Double(value & 0xff) / 255
        )
    }
}
