import Foundation

// Presentation only: no download, playback or transcript state ownership.
enum NativeLiveVoiceBubbleGeometry {
    static func userWidth(transcript: String?) -> CGFloat {
        let count = (transcript ?? "").filter { character in
            !character.isWhitespace && character.unicodeScalars.contains {
                $0.properties.generalCategory != .control && $0.properties.generalCategory != .format
            }
        }.count
        return 68 + 57 * min(1, log1p(Double(count)) / log1p(240))
    }

    static func audioWidth(duration: TimeInterval, sizeBytes: Int?) -> CGFloat {
        // A coarse compressed-audio estimate, never a duration label.
        let seconds = duration.isFinite && duration > 0
            ? duration : sizeBytes.map { max(0, Double($0)) / 24_000 } ?? 10
        return 150 + 100 * min(1, log1p(seconds) / log1p(120))
    }

    static func identity(entityID: String?, sha256: String?, draftID: String?, filename: String) -> String {
        [entityID, sha256, draftID, filename].compactMap { $0 }.first { !$0.isEmpty } ?? "audio"
    }

    static func waveform(identity: String, width: CGFloat) -> [CGFloat] {
        let count = min(28, max(12, Int(((width - 150) * 0.16).rounded()) + 12))
        // FNV-1a and a fixed LCG remain identical across process launches.
        var state = identity.utf8.reduce(UInt64(14_695_981_039_346_656_037)) { ($0 ^ UInt64($1)) &* 1_099_511_628_211 }
        return (0..<count).map { _ in
            state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return 6 + CGFloat(state % 17)
        }
    }

    static func isFilled(index: Int, count: Int, progress: Double) -> Bool {
        Double(index) / Double(max(1, count)) < min(1, max(0, progress))
    }
}
