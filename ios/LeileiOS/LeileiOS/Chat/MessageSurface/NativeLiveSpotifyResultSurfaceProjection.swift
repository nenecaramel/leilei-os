import Foundation

struct NativeLiveSpotifyResultSurfaceItem: Equatable, Identifiable {
    let tool: NativeLiveTurnActivityProjection.ToolActivity
    let presentation: NativeLiveSpotifyResultPresentation
    var id: String { tool.id }
    var order: Int { tool.order }
}

// Consume the turn's already-reconciled tools; identity/schema stay with the
// existing Spotify projector, and suppression stays with the turn projection.
enum NativeLiveSpotifyResultSurfaceProjector {
    static func project(tools: [NativeLiveTurnActivityProjection.ToolActivity]) -> [NativeLiveSpotifyResultSurfaceItem] {
        tools.sorted { $0.order < $1.order }.compactMap { tool in
            guard tool.state != .running,
                  let presentation = NativeLiveSpotifyProjector.project(
                    providerToolName: tool.providerToolName, output: tool.output
                  ) else { return nil }
            return .init(tool: tool, presentation: presentation)
        }
    }
}
