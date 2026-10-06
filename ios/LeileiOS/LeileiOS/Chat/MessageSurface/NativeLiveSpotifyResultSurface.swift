import SwiftUI

struct NativeLiveSpotifyResultSurface: View {
    let items: [NativeLiveSpotifyResultSurfaceItem]

    var body: some View {
        VStack(alignment: .leading, spacing: ChatPresentationLayout.assistantSpacing) {
            ForEach(items) { item in
                NativeLiveSpotifyCard(presentation: item.presentation, tool: item.tool)
            }
        }
    }
}
