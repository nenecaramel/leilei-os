import SwiftUI
import UIKit

// One device-wide iMessage bubble palette. Neither conversation storage
// nor the Original chat theme reads these presentation-only preferences.
enum IMessageBubbleAppearance {
    static let outgoingColorKey = "chat.imessage.bubble.outgoing.color"
    static let incomingColorKey = "chat.imessage.bubble.incoming.color"
    static let outgoingOpacityKey = "chat.imessage.bubble.outgoing.opacity"
    static let incomingOpacityKey = "chat.imessage.bubble.incoming.opacity"

    // Match the existing blue / dark gray exactly on first launch.
    static let defaultOutgoingColorHex = "#008CFF"
    static let defaultIncomingColorHex = "#38424A"
    static let defaultOutgoingOpacity = 0.88
    static let defaultIncomingOpacity = 0.82

    static func color(hex: String) -> Color {
        let digits = hex.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard digits.count == 6, let rgb = UInt32(digits, radix: 16) else {
            return Color(red: 0, green: 0.55, blue: 1)
        }
        return Color(
            red: Double((rgb >> 16) & 0xff) / 255,
            green: Double((rgb >> 8) & 0xff) / 255,
            blue: Double(rgb & 0xff) / 255
        )
    }

    // SwiftUI ColorPicker works in Color, while AppStorage persists a simple
    // HEX value that survives app restart and updates all open chat bubbles.
    static func hex(from color: Color) -> String {
        let resolved = UIColor(color)
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        guard resolved.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
            return defaultOutgoingColorHex
        }
        return String(
            format: "#%02X%02X%02X",
            Int((red * 255).rounded()),
            Int((green * 255).rounded()),
            Int((blue * 255).rounded())
        )
    }
}
