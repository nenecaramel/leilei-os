import SwiftUI

/// A value-returning layout helper preserves the original LazyVStack view graph.
/// Prepared rows and measurements only; scroll policy/state remain in the surface.
@ViewBuilder
func nativeLiveMessageList<Pagination: View>(
    rows: [NativeLiveConversationRowPresentation],
    currentHeadMessageID: String?,
    isTurnInFlight: Bool,
    copiedMessageID: String?,
    bottomAnchorID: String,
    onCopyMessage: @escaping (String, String) -> Void,
    onRetryMessage: @escaping (String) -> Void,
    onEditMessage: @escaping (NativeLiveCurrentPathMessage) -> Void,
    onResolveRuntimeInteraction: ((NativeLiveRuntimeInteractionSnapshot, [String: NativeLiveJSONValue]) async throws -> Void)?,
    @ViewBuilder pagination: @escaping () -> Pagination
) -> some View {
    LazyVStack(spacing: ChatPresentationLayout.turnSpacing) {
        if !rows.contains(where: \.isHistoryDivider) {
            pagination()
        }

        ForEach(rows) { row in
            NativeLiveMessageRow(row:row,
                isCurrentHead:row.assistant?.canonicalMessageID == currentHeadMessageID,
                isTurnInFlight:isTurnInFlight,isCopied:copiedMessageID == row.id,
                onCopyMessage:{ onCopyMessage($0,row.id) },onRetryMessage:onRetryMessage,
                onEditMessage:onEditMessage,onResolveInteraction:onResolveRuntimeInteraction)
                .id(row.id)
                .background(GeometryReader { geometry in
                    Color.clear.preference(key:NativeLiveRowFramesKey.self,
                        value:[row.id:geometry.frame(in:.named("native-live-viewport"))])
                })

            if row.isHistoryDivider {
                pagination()
            }
        }

        Color.clear
            .frame(height: 1)
            .id(bottomAnchorID)
    }
    .padding(.horizontal, ChatPresentationLayout.messageGutter)
    .padding(.top, ChatPresentationLayout.messageVerticalInset)
    .padding(.bottom, ChatPresentationLayout.messageVerticalInset)
}

struct NativeLiveRowFramesKey: PreferenceKey {
    static var defaultValue: [String:CGRect] { [:] }
    static func reduce(value:inout [String:CGRect],nextValue:()->[String:CGRect]) { value.merge(nextValue()) { _,fresh in fresh } }
}
