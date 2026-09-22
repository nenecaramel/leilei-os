import Foundation

enum AppPage: String, Identifiable {
    case home = "Home"
    case chat = "Chat"
    case memory = "Memory"
    case diary = "Diary"
    case task = "Task"
    case daySpace = "Day Space"
    case sharedPaper = "Shared Paper"
    case conversations = "Conversations"
    case universe = "Universe"
    case sentinel = "Sentinel"

    case globalSearch = "Global Search"

    case system = "System"

    case account = "Account"
    case connections = "Connections"
    case data = "Data"
    case activity = "Activity"
    case about = "About"

    var id: String { rawValue }
}
