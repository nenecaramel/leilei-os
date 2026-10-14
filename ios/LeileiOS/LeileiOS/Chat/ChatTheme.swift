import SwiftUI

/// UI-only selection: message identity, composer state and runtime actions
/// remain owned by ChatView/AppModel regardless of the active shell.
enum ChatTheme: String, CaseIterable, Identifiable, Sendable {
    case original = "original"
    case iMessage = "imessage"

    static let storageKey = "chat.theme"
    static let defaultValue: ChatTheme = .original

    var id: String { rawValue }

    var title: String {
        switch self {
        case .original: "Original"
        case .iMessage: "iMessage"
        }
    }
}

private struct ChatThemeEnvironmentKey: EnvironmentKey {
    static let defaultValue: ChatTheme = ChatTheme.defaultValue
}

private struct IMessageWallpaperVisibleKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var chatTheme: ChatTheme {
        get { self[ChatThemeEnvironmentKey.self] }
        set { self[ChatThemeEnvironmentKey.self] = newValue }
    }

    // View-only signal: use light, shadowed section labels only when the
    // iMessage transcript actually has a photographic wallpaper behind it.
    var iMessageWallpaperVisible: Bool {
        get { self[IMessageWallpaperVisibleKey.self] }
        set { self[IMessageWallpaperVisibleKey.self] = newValue }
    }
}
