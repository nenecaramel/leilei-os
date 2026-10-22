import Foundation
#if canImport(UIKit)
import UIKit
#endif

// Presentation only: no download, playback or transcript state ownership.
enum NativeLiveVoiceBubbleGeometry {
    // Shared outer height: contentHeight + 2 * verticalInset = 45pt for both bubbles.
    static let contentHeight: CGFloat = 21
    static let horizontalInset: CGFloat = 14
    static let verticalInset: CGFloat = 12
    static let controlGap: CGFloat = 6

    // MARK: User voice (content width, i.e. inside the bubble padding)

    // Fallback only when the row offers no width; in Chat the row's clearance sets the maximum.
    static let userMaxContentWidth: CGFloat = 125
    // Transcripts up to this many characters keep the shortest width.
    static let userShortestCharacterCount = 2
    static let userLeadingInset: CGFloat = 8
    static let userTrailingInset: CGFloat = 14
    static let userClusterSpacing: CGFloat = 6
    // Fallback only when UIKit cannot measure; the app always measures the real symbols.
    static let userFallbackClusterWidth: CGFloat = 40

    static func userWidth(transcript: String?, clusterWidth: CGFloat = userFallbackClusterWidth,
                          maxContentWidth: CGFloat = userMaxContentWidth) -> CGFloat {
        let count = (transcript ?? "").filter { character in
            !character.isWhitespace && character.unicodeScalars.contains {
                $0.properties.generalCategory != .control && $0.properties.generalCategory != .format
            }
        }.count
        let minimum = min(clusterWidth, maxContentWidth)
        let growth = Double(max(0, count - userShortestCharacterCount))
        return minimum + (maxContentWidth - minimum) * CGFloat(min(1, log1p(growth) / log1p(Double(240 - userShortestCharacterCount))))
    }

    // MARK: Assistant audio (outer width)

    static let audioPlayWidth: CGFloat = 24
    static let audioMinimumWaveformWidth: CGFloat = 28
    // Fallback only when the row offers no width; in Chat the row's clearance sets the maximum.
    static let audioMaximumWidth: CGFloat = 236
    // Audio up to this length keeps the shortest width.
    static let audioShortestSeconds: TimeInterval = 2
    static let audioFallbackLabelWidth: CGFloat = 24
    static let waveformBarWidth: CGFloat = 2
    static let waveformBarSpacing: CGFloat = 2
    static let waveformMinimumHeight: CGFloat = 4
    static let waveformMaximumHeight: CGFloat = 15

    /// padding + play + gaps + minimum waveform + duration label
    static func audioMinimumWidth(playWidth: CGFloat = audioPlayWidth, labelWidth: CGFloat = audioFallbackLabelWidth) -> CGFloat {
        2 * horizontalInset + playWidth + 2 * controlGap + audioMinimumWaveformWidth + labelWidth
    }

    static func audioWidth(duration: TimeInterval, sizeBytes: Int?, playWidth: CGFloat = audioPlayWidth,
                           labelWidth: CGFloat = audioFallbackLabelWidth,
                           maximumWidth: CGFloat = audioMaximumWidth) -> CGFloat {
        let minimum = audioMinimumWidth(playWidth: playWidth, labelWidth: labelWidth)
        let growth = max(0, maximumWidth - minimum)
        let seconds = max(0, audioSeconds(duration: duration, sizeBytes: sizeBytes) - audioShortestSeconds)
        return minimum + growth * CGFloat(min(1, log1p(seconds) / log1p(60 - audioShortestSeconds)))
    }

    /// A coarse compressed-audio estimate, used only until the decoded duration is known.
    static func audioSeconds(duration: TimeInterval, sizeBytes: Int?) -> TimeInterval {
        duration.isFinite && duration > 0 ? duration : sizeBytes.map { max(0, Double($0)) / 24_000 } ?? 10
    }

    /// Total length only, e.g. 1″ 8″ 23″ (U+2033).
    static func durationLabel(seconds: TimeInterval) -> String {
        "\(max(1, Int(seconds.rounded())))\u{2033}"
    }

    static func identity(entityID: String?, sha256: String?, draftID: String?, filename: String) -> String {
        [entityID, sha256, draftID, filename].compactMap { $0 }.first { !$0.isEmpty } ?? "audio"
    }

    static func waveformBarCount(width: CGFloat) -> Int {
        min(48, max(8, Int(((width + waveformBarSpacing) / (waveformBarWidth + waveformBarSpacing)).rounded(.down))))
    }

    static func waveform(identity: String, width: CGFloat) -> [CGFloat] {
        let count = waveformBarCount(width: width)
        // FNV-1a and a fixed LCG remain identical across process launches; widening only appends bars.
        var state = identity.utf8.reduce(UInt64(14_695_981_039_346_656_037)) { ($0 ^ UInt64($1)) &* 1_099_511_628_211 }
        let span = UInt64(waveformMaximumHeight - waveformMinimumHeight) + 1
        return (0..<count).map { _ in
            state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return waveformMinimumHeight + CGFloat(state % span)
        }
    }

    static func isFilled(index: Int, count: Int, progress: Double) -> Bool {
        Double(index) / Double(max(1, count)) < min(1, max(0, progress))
    }
}

#if canImport(UIKit)
// Real intrinsic widths of the controls, measured from the same fonts the views use.
enum NativeLiveVoiceBubbleMetrics {
    static var userClusterWidth: CGFloat {
        func symbol(_ name: String, _ size: CGFloat, _ weight: UIImage.SymbolWeight) -> CGFloat {
            UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: size, weight: weight))?.size.width ?? 0
        }
        let wave = symbol("waveform", 18, .regular)
        let chevron = max(symbol("chevron.down", 9, .semibold), symbol("chevron.up", 9, .semibold))
        guard wave > 0, chevron > 0 else { return NativeLiveVoiceBubbleGeometry.userFallbackClusterWidth }
        return ceil(wave + NativeLiveVoiceBubbleGeometry.userClusterSpacing + chevron)
    }

    static func durationLabelWidth(_ text: String) -> CGFloat {
        let base = UIFont.preferredFont(forTextStyle: .caption1)
        let font = UIFont.monospacedDigitSystemFont(ofSize: base.pointSize, weight: .regular)
        func width(_ string: String) -> CGFloat { ceil((string as NSString).size(withAttributes: [.font: font]).width) }
        return max(width(text), width(NativeLiveVoiceBubbleGeometry.durationLabel(seconds: 88)))
    }
}
#else
enum NativeLiveVoiceBubbleMetrics {
    static var userClusterWidth: CGFloat { NativeLiveVoiceBubbleGeometry.userFallbackClusterWidth }
    static func durationLabelWidth(_ text: String) -> CGFloat { NativeLiveVoiceBubbleGeometry.audioFallbackLabelWidth }
}
#endif
