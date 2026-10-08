import SwiftUI
import Foundation

private let nativeLiveLeileiOSToolDisplayNames: [String: String] = [
    "mcp__leileios__create_diary": "Create Diary",
    "mcp__leileios__update_diary": "Update Diary",
    "mcp__leileios__search_diary": "Search Diary",
    "mcp__leileios__get_diary": "Read Diary",
    "mcp__leileios__add_diary_comment": "Add Diary Comment",
    "mcp__leileios__get_diary_comment": "Read Diary Comment",
    "mcp__leileios__list_diary_comments": "List Diary Comments",
    "mcp__leileios__update_diary_comment": "Update Diary Comment",
    "mcp__leileios__delete_diary_comment": "Delete Diary Comment",
    "mcp__leileios__toy_set": "Set Toy",
    "mcp__leileios__toy_stop": "Stop Toy",
    "mcp__leileios__global_search": "Global Search",
    "mcp__leileios__get_universe_node": "Read Universe Node",
    "mcp__leileios__list_universe_galaxies": "List Universe Galaxies",
    "mcp__leileios__list_universe_nodes": "List Universe Nodes",
    "mcp__leileios__get_universe_relations": "Read Universe Relations",
    "mcp__leileios__create_universe_node": "Create Universe Node",
    "mcp__leileios__update_universe_node": "Update Universe Node",
    "mcp__leileios__create_universe_relation": "Create Universe Relation",
    "mcp__leileios__update_universe_relation": "Update Universe Relation",
    "mcp__leileios__delete_universe_relation": "Delete Universe Relation",
    "mcp__leileios__get_universe_diary_sources": "Read Universe Diary Sources",
    "mcp__leileios__add_universe_diary_source": "Add Universe Diary Source",
    "mcp__leileios__delete_universe_diary_source": "Delete Universe Diary Source",
    "mcp__leileios__read_todo_day": "Read Todo Day",
    "mcp__leileios__list_todo_dates": "List Todo Dates",
    "mcp__leileios__replace_todo_paper": "Replace Todo Paper",
    "mcp__leileios__append_todo_entries": "Add Todo Entries",
    "mcp__leileios__append_todo_entry": "Add Todo Entry",
    "mcp__leileios__update_todo_entry": "Update Todo Entry",
    "mcp__leileios__delete_todo_entry": "Delete Todo Entry",
    "mcp__leileios__search_todo": "Search Todo",
    "mcp__leileios__get_health": "Read Health",
    "mcp__leileios__get_current_time": "Get Current Time",
    "mcp__leileios__render_note_card": "Render Note Card",
    "mcp__leileios_local__send_file": "Send File",
    "mcp__leileios_memes__send_meme": "Send Sticker",
    "Send Meme": "Send Sticker",
]

func nativeLiveToolDisplayName(
    _ raw: String
) -> String {
    if let displayName =
        nativeLiveLeileiOSToolDisplayNames[raw] {
        return displayName
    }

    let prefixes = [
        "mcp__leileios__",
        "mcp__leileios_local__",
        "mcp__leileios_memes__",
    ]
    guard let prefix = prefixes.first(
        where: { raw.hasPrefix($0) }
    ) else {
        return raw
    }

    return String(raw.dropFirst(prefix.count))
        .split(separator: "_")
        .map { $0.capitalized }
        .joined(separator: " ")
}

func nativeLiveJSONDetail(
    _ value: NativeLiveJSONValue?
) -> String? {
    guard let value else { return nil }
    let rendered = nativeLiveJSONDescription(value)
    let normalized = rendered.trimmingCharacters(
        in: .whitespacesAndNewlines
    )
    return normalized.isEmpty ? nil : normalized
}

private func nativeLiveJSONDescription(
    _ value: NativeLiveJSONValue
) -> String {
    switch value {
    case .string(let string):
        return string
    case .number(let number):
        return String(number)
    case .bool(let bool):
        return bool ? "true" : "false"
    case .null:
        return "null"
    case .array(let values):
        return "["
            + values.map(nativeLiveJSONDescription)
                .joined(separator: ", ")
            + "]"
    case .object(let object):
        return "{"
            + object.keys.sorted().map { key in
                let value = object[key] ?? .null
                return key
                    + ": "
                    + nativeLiveJSONDescription(value)
            }
            .joined(separator: ", ")
            + "}"
    }
}
