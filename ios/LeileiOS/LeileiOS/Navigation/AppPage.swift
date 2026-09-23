import SwiftUI

enum AppPage: String, Identifiable {
    case home = "Home"
    case chat = "Chat"
    case diary = "Diary"
    case daySpace = "Day Space"
    case conversations = "Conversations"
    case universe = "Universe"
    case sentinel = "Sentinel"

    case globalSearch = "Global Search"

    case account = "Account"
    case connections = "Connections"
    case data = "Data"
    case activity = "Activity"
    case about = "About"

    var id: String { rawValue }
}
