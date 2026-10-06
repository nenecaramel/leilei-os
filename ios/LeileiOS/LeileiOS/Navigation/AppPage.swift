import SwiftUI

enum AppPage: String, Identifiable {
    case chat = "Chat"
    case diary = "Diary"
    case daySpace = "Day Space"
    case conversations = "Conversations"
    case mind = "Mind"
    case universe = "Universe"

    case globalSearch = "Global Search"

    case account = "Account"
    case connections = "Connections"
    case data = "Data"
    case activity = "Activity"
    case about = "About"

    var id: String { rawValue }
}
