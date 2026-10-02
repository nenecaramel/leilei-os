import SwiftUI
import Foundation

struct NativeLiveBlockView: View {
    let block: NativeLiveCurrentPathBlock
    let fillsAvailableWidth: Bool
    let isUserMessage: Bool

    @ViewBuilder
    var body: some View {
        switch block.kind {
        case "text":
            if let text = normalizedText {
                ChatMarkdownView(
                    text: text,
                    fillsAvailableWidth: fillsAvailableWidth,
                    lineSpacing: isUserMessage ? 5 : 6,
                    paragraphSpacing: isUserMessage ? 19 : 22
                )
            }

        case "tool_use":
            NativeLiveToolCallCard(
                toolName:
                    block.payload?["tool_name"]?.stringValue
                    ?? "Tool",
                detail: nativeLiveJSONDetail(
                    block.payload?["input"]
                ),
                state: .completed
            )

        case "tool_result":
            NativeLiveToolResultCard(
                isError:
                    block.payload?["is_error"]?.boolValue
                    == true,
                detail: nativeLiveJSONDetail(
                    block.payload?["output"]
                )
            )

        case "attachment":
            NativeLiveAttachmentBlockView(block: block)

        default:
            EmptyView()
        }
    }

    private var normalizedText: String? {
        guard let text = block.text else { return nil }
        let normalized = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return normalized.isEmpty ? nil : normalized
    }
}
