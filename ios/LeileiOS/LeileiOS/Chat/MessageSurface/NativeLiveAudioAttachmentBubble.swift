import SwiftUI

struct NativeLiveAudioAttachmentBubble: View {
    @Environment(\.chatTheme) private var chatTheme
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
                        .foregroundStyle(
                            chatTheme == .iMessage
                                ? AnyShapeStyle(Color.white.opacity(0.98))
                                : AnyShapeStyle(HierarchicalShapeStyle.secondary)
                        )
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
                Text(failure).font(.caption).foregroundStyle(
                    chatTheme == .iMessage
                        ? AnyShapeStyle(Color.white.opacity(0.98))
                        : AnyShapeStyle(HierarchicalShapeStyle.secondary)
                )
                Button("Retry") { retry() }.font(.caption).buttonStyle(.borderless)
                    .disabled(uploading || isOpening || playback.phase == .loading)
            }
        }
        .padding(.horizontal, NativeLiveVoiceBubbleGeometry.horizontalInset)
        .padding(
            .vertical,
            chatTheme == .iMessage
                ? ChatPresentationLayout.iMessageUserBubbleVerticalInset
                : NativeLiveVoiceBubbleGeometry.verticalInset
        )
        // Up to the row width left of the trailing clearance, like a text reply.
        .nativeLiveVoiceBubbleWidth(alignment: .leading, fallbackMaximum: NativeLiveVoiceBubbleGeometry.audioMaximumWidth) { maximum in
            NativeLiveVoiceBubbleGeometry.audioWidth(duration: effectiveDuration ?? 0, sizeBytes: input.sizeBytes,
                playWidth: NativeLiveVoiceBubbleGeometry.audioPlayWidth, labelWidth: labelWidth, maximumWidth: maximum)
        }
        .animation(.easeInOut(duration: 0.16), value: effectiveDuration)
        .modifier(NativeLiveAssistantAudioBubbleBackground())
        // Mirror the 70pt clearance on the right of incoming text bubbles.
        .padding(
            .trailing,
            chatTheme == .iMessage ? ChatPresentationLayout.iMessageUserLeadingClearance : 0
        )
        .onDisappear { playback.deactivate() }
        .sheet(item: $lease, onDismiss: { lease?.cleanup(); lease = nil }) {
            NativeLiveFileOpenView(lease: $0)
        }
    }

    private var labelWidth: CGFloat { NativeLiveVoiceBubbleMetrics.durationLabelWidth(durationLabel) }

    private var waveformIdentity: String {
        NativeLiveVoiceBubbleGeometry.identity(
            entityID: input.entityID, sha256: input.sha256, draftID: input.draftID, filename: input.filename)
    }

    private var effectiveDuration: TimeInterval? {
        if playback.duration.isFinite, playback.duration > 0 {
            return playback.duration
        }
        return input.durationSeconds
    }

    private var durationLabel: String {
        guard let duration = effectiveDuration else { return "—" }
        return NativeLiveVoiceBubbleGeometry.durationLabel(seconds: duration)
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
    @Environment(\.chatTheme) private var chatTheme
    let progress: Double
    let identity: String
    var body: some View {
        GeometryReader { geometry in
            let heights = NativeLiveVoiceBubbleGeometry.waveform(identity: identity, width: geometry.size.width)
            HStack(alignment: .center, spacing: NativeLiveVoiceBubbleGeometry.waveformBarSpacing) {
                ForEach(heights.indices, id: \.self) { index in
                    Capsule().fill(
                        chatTheme == .iMessage
                            ? Color.white.opacity(NativeLiveVoiceBubbleGeometry.isFilled(index: index, count: heights.count, progress: progress) ? 0.98 : 0.30)
                            : Color.primary.opacity(NativeLiveVoiceBubbleGeometry.isFilled(index: index, count: heights.count, progress: progress) ? 0.75 : 0.2)
                    )
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
