import SwiftUI

// A temporary ElevenLabs tool result uses the same MP3 bubble geometry and
// playback state as a regular attachment. Nothing is uploaded or sent again.
struct NativeLiveElevenLabsResultSurface: View {
    let items: [NativeLiveElevenLabsResultItem]

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { timeline in
            let available = items.filter {
                $0.audio.expiresAt.map { $0 > timeline.date } ?? true
            }
            if !available.isEmpty {
                VStack(alignment: .leading, spacing: ChatPresentationLayout.assistantSpacing) {
                    ForEach(available) { item in
                        NativeLiveElevenLabsAudioCard(audio: item.audio)
                    }
                }
            }
        }
    }
}

struct NativeLiveElevenLabsAudioCard: View {
    let audio: NativeLiveElevenLabsAudioPresentation
    @StateObject private var playback = NativeLiveAudioPlaybackState()
    @State private var lease: NativeLiveFilePreviewLease?
    @State private var isOpening = false
    @State private var openError: String?

    private var failure: String? { openError ?? playback.error }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: NativeLiveVoiceBubbleGeometry.controlGap) {
                Button { playOrPause() } label: {
                    Group {
                        if playback.phase == .loading { ProgressView().controlSize(.small) }
                        else { Image(systemName: playback.phase == .playing ? "pause.fill" : "play.fill") }
                    }
                    .frame(width: NativeLiveVoiceBubbleGeometry.audioPlayWidth, height: NativeLiveVoiceBubbleGeometry.contentHeight)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(playback.phase == .loading)
                .accessibilityLabel(playback.phase == .playing ? "Pause audio" : "Play audio")

                Button { open() } label: {
                    HStack(spacing: NativeLiveVoiceBubbleGeometry.controlGap) {
                        NativeLiveElevenLabsWaveform(progress: playback.progress, identity: audio.generationID)
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
                .disabled(isOpening)
                .accessibilityLabel("Open audio file")
                .accessibilityValue(durationLabel)
            }
            .frame(height: NativeLiveVoiceBubbleGeometry.contentHeight)
            if let failure {
                Text(failure).font(.caption).foregroundStyle(.secondary)
                Button("Retry") { retry() }.font(.caption).buttonStyle(.borderless)
                    .disabled(isOpening || playback.phase == .loading)
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

    private var effectiveDuration: TimeInterval? {
        if playback.duration.isFinite, playback.duration > 0 { return playback.duration }
        return audio.durationSeconds
    }
    private var durationLabel: String {
        guard let seconds = effectiveDuration else { return "—" }
        return NativeLiveVoiceBubbleGeometry.durationLabel(seconds: seconds)
    }
    private var labelWidth: CGFloat { NativeLiveVoiceBubbleMetrics.durationLabelWidth(durationLabel) }
    private var bubbleWidth: CGFloat {
        NativeLiveVoiceBubbleGeometry.audioWidth(duration: effectiveDuration ?? 0, sizeBytes: nil,
            playWidth: NativeLiveVoiceBubbleGeometry.audioPlayWidth, labelWidth: labelWidth)
    }
    private func playOrPause() {
        Task { @MainActor in
            await playback.toggle { try await NativeLiveElevenLabsAudioLoader.bytes(from: audio) }
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
                if let cached = playback.verifiedData { bytes = cached }
                else { bytes = try await NativeLiveElevenLabsAudioLoader.bytes(from: audio) }
                lease = try NativeLiveFilePreviewLease(data: bytes, filename: "ElevenLabs.mp3", mimeType: "audio/mpeg")
            } catch {
                openError = (error as? NativeLiveMediaError ?? .previewFailed).localizedDescription
            }
        }
    }
}

private struct NativeLiveElevenLabsWaveform: View {
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

enum NativeLiveElevenLabsAudioLoader {
    static func bytes(from audio: NativeLiveElevenLabsAudioPresentation) async throws -> Data {
        guard NativeLiveElevenLabsResultProjector.audioURL(audio.url.absoluteString) != nil,
              audio.expiresAt.map({ $0 > Date() }) ?? true else {
            throw NativeLiveMediaError.unavailable
        }
        var request = URLRequest(url: audio.url)
        request.timeoutInterval = 25
        request.setValue("audio/mpeg", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await NativeLiveMediaTransport.session.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  http.statusCode == 200,
                  let finalURL = http.url,
                  NativeLiveElevenLabsResultProjector.audioURL(finalURL.absoluteString) != nil,
                  !data.isEmpty, data.count <= 20 * 1024 * 1024 else {
                throw NativeLiveMediaError.downloadFailed
            }
            return data
        } catch let error as NativeLiveMediaError {
            throw error
        } catch {
            throw NativeLiveMediaError.downloadFailed
        }
    }
}
