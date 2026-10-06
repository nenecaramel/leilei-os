import SwiftUI

struct NativeLiveAudioAttachmentBubble: View {
    @EnvironmentObject private var appModel: AppModel
    let input: NativeLiveAttachmentPresentationInput
    @StateObject private var playback = NativeLiveAudioPlaybackState()
    @State private var lease: NativeLiveFilePreviewLease?
    @State private var isOpening = false
    @State private var openError: String?

    private var uploading: Bool { input.presentationState == .uploading }
    private var failure: String? {
        if let openError { return openError }
        if let error = playback.error { return error }
        if playback.verifiedData != nil { return nil }
        switch input.presentationState {
        case .failed: return "Audio download failed. Try again."
        case .unavailable: return "Audio unavailable. Try again."
        case .integrityFailed: return "Audio integrity check failed. Try again."
        default: return nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                // Sibling buttons: playing can never open a Quick Look lease.
                Button { playOrPause() } label: {
                    Group {
                        if uploading || playback.phase == .loading { ProgressView() }
                        else { Image(systemName: playback.phase == .playing ? "pause.fill" : "play.fill") }
                    }
                    .frame(width: 36, height: 36)
                    .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(uploading || playback.phase == .loading)
                .accessibilityLabel(playback.phase == .playing ? "Pause audio" : "Play audio")

                Button { open() } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        NativeLiveAudioWaveform(progress: playback.progress)
                        HStack(spacing: 4) {
                            Text(statusLabel)
                            Spacer(minLength: 0)
                            if isOpening { ProgressView().controlSize(.mini) }
                        }
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(isOpening || uploading)
                .accessibilityLabel("Open audio file")
            }
            if let failure {
                Text(failure).font(.caption).foregroundStyle(.secondary)
                Button("Retry") { retry() }.font(.caption).buttonStyle(.borderless)
                    .disabled(uploading || isOpening || playback.phase == .loading)
            }
        }
        .padding(11)
        .frame(maxWidth: 280, alignment: .leading)
        .background(Color.chatSoftFill, in: RoundedRectangle(cornerRadius: 18))
        .onDisappear { playback.deactivate() }
        .sheet(item: $lease, onDismiss: { lease?.cleanup(); lease = nil }) {
            NativeLiveFileOpenView(lease: $0)
        }
    }

    private var statusLabel: String {
        if uploading { return "Uploading…" }
        if playback.phase == .loading { return "Loading…" }
        guard playback.duration > 0 else { return "Audio" }
        return "\(time(playback.currentTime)) / \(time(playback.duration))"
    }

    private func time(_ seconds: TimeInterval) -> String {
        let value = Int(max(0, seconds).rounded(.down))
        return String(format: "%d:%02d", value / 60, value % 60)
    }

    private func playOrPause() {
        Task { @MainActor in
            await playback.toggle { try await appModel.nativeLiveAttachmentBytes(input).data }
        }
    }

    private func retry() {
        if openError != nil { open() }
        else { playOrPause() }
    }

    private func open() {
        guard !isOpening else { return }
        isOpening = true; openError = nil
        Task { @MainActor in
            defer { isOpening = false }
            do {
                let bytes: Data
                if let verified = playback.verifiedData { bytes = verified }
                else { bytes = try await appModel.nativeLiveAttachmentBytes(input).data }
                let preview = try NativeLiveFilePreviewLease(data: bytes, filename: input.filename, mimeType: input.mimeType)
                lease = preview
            } catch { openError = (error as? NativeLiveMediaError ?? .previewFailed).localizedDescription }
        }
    }
}

private struct NativeLiveAudioWaveform: View {
    let progress: Double
    // Stable voice bars, not an amplitude measurement. Only the filled fraction
    // represents live AVAudioPlayer progress.
    private let heights: [CGFloat] = [8, 14, 20, 11, 24, 17, 9, 21, 28, 16, 23, 12, 18, 26, 10, 19, 24, 14, 8, 20, 12, 25, 17, 10]
    var body: some View {
        GeometryReader { geometry in
            let spacing: CGFloat = 3
            let width = max(1, (geometry.size.width - spacing * CGFloat(heights.count - 1)) / CGFloat(heights.count))
            HStack(alignment: .center, spacing: spacing) {
                ForEach(heights.indices, id: \.self) { index in
                    Capsule().fill(Color.primary.opacity(Double(index) / Double(heights.count) < progress ? 0.75 : 0.2))
                        .frame(width: width, height: heights[index])
                }
            }
            .frame(height: 28)
        }
        .frame(height: 28)
        .accessibilityLabel("Playback progress")
        .accessibilityValue("\(Int(progress * 100)) percent")
    }
}
