import SwiftUI

struct NativeLiveSpotifyCard: View {
    let presentation: NativeLiveSpotifyResultPresentation
    let tool: NativeLiveTurnActivityProjection.ToolActivity
    @Environment(\.openURL) private var openURL
    @State private var isShowingDetails = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Spotify").font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Button { isShowingDetails = true } label: {
                    Image(systemName: "info.circle").font(.system(size: 13)).foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Tool details")
            }
            if presentation.isEmpty {
                Text("Nothing is currently playing").font(.subheadline).foregroundStyle(.secondary)
            } else if presentation.errorTitle != nil || presentation.errorMessage != nil || presentation.errorCode != nil {
                if let title = presentation.errorTitle { Text(title).font(.subheadline.weight(.medium)).lineLimit(2) }
                if let message = presentation.errorMessage { Text(message).font(.caption).lineLimit(4).foregroundStyle(.secondary) }
                if let code = presentation.errorCode { Text(code).font(.caption2).lineLimit(1).foregroundStyle(.secondary) }
            } else {
                ForEach(Array(presentation.entities.prefix(5).enumerated()), id: \.offset) { _, entity in
                    Button {
                        if let url = entity.url { openURL(url) }
                    } label: {
                        NativeLiveSpotifyEntityRow(entity: entity)
                    }
                    .buttonStyle(.plain)
                    .disabled(entity.url == nil)
                }
            }
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 9)
        .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        .frame(maxWidth: .infinity, alignment: .leading)
        .sheet(isPresented: $isShowingDetails) {
            NativeLiveToolDetailSheet(
                title: nativeLiveToolDisplayName(tool.toolName),
                status: detailStatus,
                sectionTitle: "Input", detail: nativeLiveJSONDetail(tool.input),
                secondarySectionTitle: tool.output == nil ? nil : "Output", secondaryDetail: nativeLiveJSONDetail(tool.output),
                tertiarySectionTitle: tool.resourceLinks.isEmpty ? nil : "Resources",
                tertiaryDetail: tool.resourceLinks.isEmpty ? nil : nativeLiveJSONDetail(.array(tool.resourceLinks))
            )
        }
    }
    private var detailStatus: String {
        switch tool.state {
        case .running: return "Running"
        case .completed: return "Done"
        case .failed: return "Failed"
        case .unknown: return "No result"
        }
    }
}

private struct NativeLiveSpotifyEntityRow: View {
    let entity: NativeLiveSpotifyEntityPresentation
    var body: some View {
        HStack(spacing: 10) {
            AsyncImage(url: entity.coverURL) { phase in
                if let image = phase.image { image.resizable().scaledToFill() }
                else { ZStack { Color.primary.opacity(0.06); Image(systemName: "music.note").foregroundStyle(.secondary) } }
            }
            .frame(width: 48, height: 48)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 3) {
                Text(entity.name).font(.subheadline.weight(.medium)).lineLimit(1)
                if let creator = entity.creator { Text(creator).font(.caption).lineLimit(1).foregroundStyle(.secondary) }
                Text([entity.typeLabel, entity.parent].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption2).lineLimit(1).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if entity.url != nil { Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(.secondary) }
        }
        .frame(height: 60)
        .contentShape(Rectangle())
    }
}
