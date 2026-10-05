import SwiftUI

extension Color {
    static var chatSoftFill: Color {
        LeileiUI.Color.softFill
    }
}

struct ComposerCircleButton: View {
    let systemName: String
    var weight: Font.Weight = .medium

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.chatSoftFill)
                .frame(width: LeileiUI.ControlGeometry.compact, height: LeileiUI.ControlGeometry.compact)

            Image(systemName: systemName)
                .font(LeileiUI.Typography.controlGlyph(weight: weight))
                .foregroundStyle(.primary)
        }
    }
}

struct CombinedModelCapsule: View {
    let model: String
    let effort: String

    var body: some View {
        HStack(spacing: 5) {
            Text(model)
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(.primary)

            Text(effort)
                .font(.system(size: 11.5, weight: .regular))
                .foregroundStyle(.primary.opacity(0.55))
        }
        .padding(.horizontal, 10)
        .frame(height: LeileiUI.ControlGeometry.compact)
        .background(
            Capsule()
                .fill(Color.chatSoftFill)
        )
    }
}

/// Pure presentation only. It neither owns runtime state nor authorizes an
/// action; ChatComposer retains its existing callbacks and disabled predicates.
struct ComposerPrimaryActionPresentation {
    enum Mode { case voice, send, midTurnSend, interrupt, interruptPending, disabledSend }
    let mode: Mode
    let isDimmed: Bool

    init(hasText: Bool, hasAttachments: Bool, attachmentsReady: Bool,
         isRuntimeTurnActive: Bool, isRuntimeControlInFlight: Bool,
         interruptRequested: Bool, isSending: Bool) {
        isDimmed = isRuntimeControlInFlight
            || (isSending && !isRuntimeTurnActive)
            || (!isRuntimeTurnActive && !attachmentsReady)
        if isRuntimeTurnActive {
            mode = hasText ? .midTurnSend : (interruptRequested ? .interruptPending : .interrupt)
        } else if !hasText && !hasAttachments {
            mode = .voice
        } else {
            mode = isDimmed ? .disabledSend : .send
        }
    }

    var symbol: String {
        switch mode {
        case .voice: "waveform"
        case .interrupt, .interruptPending: "square.fill"
        case .send, .midTurnSend, .disabledSend: "arrow.up"
        }
    }

    var weight: Font.Weight {
        mode == .voice ? .semibold : .regular
    }
}
