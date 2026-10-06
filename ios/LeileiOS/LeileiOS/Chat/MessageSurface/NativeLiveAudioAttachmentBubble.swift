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
            HStack(spacing: NativeLiveVoiceBubbleGeometry.controlGap) {
                // Sibling buttons: playing can never open a Quick Look lease.
                Button { playOrPause() } label: {
                    Group {
                        if uploading || playback.phase == .loading { ProgressView().controlSize(.small) }
                        else { Image(systemName: playback.phase == .playing ? "pause.fill" : "play.fill") }
                    }
                    .frame(width: NativeLiveVoiceBubbleGeometry.audioPlayWidth, height: NativeLiveVoiceBubbleGeometry.contentHeight)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(uploading || playback.phase == .loading)
                .accessibilityLabel(playback.phase == .playing ? "Pause audio" : "Play audio")

                Button { open() } label: {
                    HStack(spacing: NativeLiveVoiceBubbleGeometry.controlGap) {
                        NativeLiveAudioWaveform(progress: playback.progress, identity: waveformIdentity)
                        Group {
                            if isOpening { ProgressView().controlSize(.mini) }
                            else { Text(durationLabel).lineLimit(1).fixedSize() }
                        }
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: labelWidth, alignment: .trailing)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(isOpening || uploading)
                .accessibilityLabel("Open audio file")
                .accessibilityValue(durationLabel)
            }
            .frame(height: NativeLiveVoiceBubbleGeometry.contentHeight)
            if let failure {
                Text(failure).font(.caption).foregroundStyle(.secondary)
                Button("Retry") { retry() }.font(.caption).buttonStyle(.borderless)
                    .disabled(uploading || isOpening || playback.phase == .loading)
            }
        }
        .padding(.horizontal, NativeLiveVoiceBubbleGeometry.horizontalInset)
        .padding(.vertical, NativeLiveVoiceBubbleGeometry.verticalInset)
        .frame(width: bubbleWidth, alignment: .leading)
        .animation(.easeInOut(duration: 0.16), value: bubbleWidth)
        .background(Color.chatSoftFill, in: RoundedRectangle(cornerRadius: ChatPresentationLayout.bubbleRadius, style: .continuous))
        .onDisappear { playback.deactivate() }
        .sheet(item: $lease, onDismiss: { lease?.cleanup(); lease = nil }) {
            NativeLiveFileOpenView(lease: $0)
        }
    }

    private var bubbleWidth: CGFloat {
        NativeLiveVoiceBubbleGeometry.audioWidth(duration: playback.duration, sizeBytes: input.sizeBytes,
            playWidth: NativeLiveVoiceBubbleGeometry.audioPlayWidth, labelWidth: labelWidth)
    }

    private var labelWidth: CGFloat { NativeLiveVoiceBubbleMetrics.durationLabelWidth(durationLabel) }

    private var waveformIdentity: String {
        NativeLiveVoiceBubbleGeometry.identity(
            entityID: input.entityID, sha256: input.sha256, draftID: input.draftID, filename: input.filename)
    }

    private var durationLabel: String {
        NativeLiveVoiceBubbleGeometry.durationLabel(
            seconds: NativeLiveVoiceBubbleGeometry.audioSeconds(duration: playback.duration, sizeBytes: input.sizeBytes))
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
    let identity: String
    var body: some View {
        GeometryReader { geometry in
            let heights = NativeLiveVoiceBubbleGeometry.waveform(identity: identity, width: geometry.size.width)
            HStack(alignment: .center, spacing: NativeLiveVoiceBubbleGeometry.waveformBarSpacing) {
                ForEach(heights.indices, id: \.self) { index in
                    Capsule().fill(Color.primary.opacity(NativeLiveVoiceBubbleGeometry.isFilled(index: index, count: heights.count, progress: progress) ? 0.75 : 0.2))
                        .frame(width: NativeLiveVoiceBubbleGeometry.waveformBarWidth, height: heights[index])
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .leading)
        }
        .frame(height: NativeLiveVoiceBubbleGeometry.contentHeight)
        .accessibilityLabel("Playback progress")
        .accessibilityValue("\(Int(progress * 100)) percent")
    }
}
