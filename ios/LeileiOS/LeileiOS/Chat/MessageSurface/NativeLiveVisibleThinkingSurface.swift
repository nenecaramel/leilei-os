import SwiftUI

struct NativeLiveVisibleThinkingSurface: View {
    let items: [NativeLiveVisibleThinkingItem]

    @State private var isShowingThoughtProcess = false

    var body: some View {
        if !items.isEmpty {
            Button { isShowingThoughtProcess = true } label: {
                HStack(spacing: 8) {
                    NativeLiveThoughtProcessIcon()
                        .frame(width: 14, height: 14)
                        .scaleEffect(1.2)
                        .accessibilityHidden(true)
                    Text("Thought process")
                        .font(.system(size: 14))
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .light))
                        .frame(height: 22)
                    Spacer(minLength: 8)
                }
                .foregroundStyle(.secondary)
                .contentShape(Rectangle())
            }
            .padding(.leading, ChatPresentationLayout.processLeadingInset)
            .buttonStyle(.plain)
            .accessibilityLabel("Thought process")
            .sheet(isPresented: $isShowingThoughtProcess) {
                NativeLiveThoughtProcessSheet(items: items)
            }
        }
    }
}

// A small dotted clock, matching the Thought process reference glyph.
private struct NativeLiveThoughtProcessIcon: View {
    var body: some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let radius = min(size.width, size.height) * 0.41
            let stroke = StrokeStyle(lineWidth: 1.2, lineCap: .round, lineJoin: .round)
            var outline = Path()
            outline.addArc(center: center, radius: radius,
                           startAngle: .degrees(-90), endAngle: .degrees(180), clockwise: false)
            context.stroke(outline, with: .foreground, style: stroke)
            for degrees in [200.0, 220, 240, 260] {
                let angle = degrees * .pi / 180
                let point = CGPoint(x: center.x + radius * cos(angle),
                                    y: center.y + radius * sin(angle))
                context.fill(Path(ellipseIn: CGRect(x: point.x - 0.6, y: point.y - 0.6,
                                                    width: 1.2, height: 1.2)), with: .foreground)
            }
            var hands = Path()
            hands.move(to: CGPoint(x: center.x, y: center.y - radius * 0.6))
            hands.addLine(to: center)
            hands.addLine(to: CGPoint(x: center.x + radius * 0.48, y: center.y + radius * 0.28))
            context.stroke(hands, with: .foreground, style: stroke)
        }
    }
}

private struct NativeLiveThoughtProcessSheet: View {
    let items: [NativeLiveVisibleThinkingItem]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(items) { item in
                        Text(item.text)
                            .font(.body)
                            .foregroundStyle(.primary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 18)
            }
            .navigationTitle("Thought process")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
}
