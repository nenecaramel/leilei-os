import SwiftUI
import UIKit

struct DaySpacePaperDetailLayer<
    Content: View,
    TopRight: View,
    Signature: View
>: View {
    let dateLabel: String
    let errorMessage: String?
    let onRequestClose: () -> Void
    let topRight: TopRight
    let signature: Signature
    let content: Content

    init(
        dateLabel: String,
        errorMessage: String?,
        onRequestClose: @escaping () -> Void,
        @ViewBuilder topRight: () -> TopRight,
        @ViewBuilder signature: () -> Signature,
        @ViewBuilder content: () -> Content
    ) {
        self.dateLabel = dateLabel
        self.errorMessage = errorMessage
        self.onRequestClose = onRequestClose
        self.topRight = topRight()
        self.signature = signature()
        self.content = content()
    }

    var body: some View {
        GeometryReader { proxy in
            let dimensions = paperDimensions(
                for: proxy.size
            )

            ZStack {
                Color.white
                    .opacity(0.82)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture {
                        onRequestClose()
                    }

                ZStack(
                    alignment: .topLeading
                ) {
                    RoundedRectangle(
                        cornerRadius: 14
                    )
                    .fill(Color.white)

                    ScrollView {
                        content
                            .frame(
                                maxWidth: .infinity,
                                minHeight: max(
                                    0,
                                    dimensions.height - 80
                                ),
                                alignment: .topLeading
                            )
                            .background {
                                DaySpacePaperRules()
                            }
                    }
                    .scrollIndicators(.hidden)
                    .padding(.horizontal, 24)
                    .padding(.top, 42)
                    .padding(.bottom, 38)

                    Text(dateLabel)
                        .font(
                            .system(
                                size: 13
                            )
                        )
                        .tracking(0.52)
                        .foregroundStyle(
                            Color(
                                white: 0.43
                            )
                        )
                        .padding(
                            .leading,
                            24
                        )
                        .padding(
                            .top,
                            13
                        )

                    topRight
                        .padding(
                            .trailing,
                            24
                        )
                        .padding(
                            .top,
                            13
                        )
                        .frame(
                            maxWidth: .infinity,
                            alignment: .topTrailing
                        )

                    signature
                        .padding(
                            .trailing,
                            24
                        )
                        .padding(
                            .bottom,
                            11
                        )
                        .frame(
                            maxWidth: .infinity,
                            maxHeight: .infinity,
                            alignment: .bottomTrailing
                        )

                    if let errorMessage {
                        Text(errorMessage)
                            .font(
                                .system(
                                    size: 12
                                )
                            )
                            .foregroundStyle(
                                Color.red
                            )
                            .lineLimit(2)
                            .padding(
                                .leading,
                                24
                            )
                            .padding(
                                .trailing,
                                68
                            )
                            .padding(
                                .bottom,
                                9
                            )
                            .frame(
                                maxWidth: .infinity,
                                maxHeight: .infinity,
                                alignment: .bottomLeading
                            )
                    }
                }
                .foregroundStyle(
                    Color(
                        white: 0.09
                    )
                )
                .frame(
                    width: dimensions.width,
                    height: dimensions.height
                )
                .clipShape(
                    RoundedRectangle(
                        cornerRadius: 14
                    )
                )
                .overlay(
                    RoundedRectangle(
                        cornerRadius: 14
                    )
                    .stroke(
                        Color.black.opacity(0.11),
                        lineWidth: 1
                    )
                )
                .shadow(
                    color: .black.opacity(0.09),
                    radius: 28,
                    y: 18
                )
                .offset(
                    y: dimensions.offsetY
                )
            }
            .frame(
                maxWidth: .infinity,
                maxHeight: .infinity
            )
        }
        .background(
            Color.clear
                .ignoresSafeArea()
        )
        .overlay(alignment: .topLeading) {
            Button(action: onRequestClose) {
                Color.clear
                    .frame(width: 1, height: 1)
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.cancelAction)
            .accessibilityHidden(true)
        }
    }

    private func paperDimensions(
        for size: CGSize
    ) -> (
        width: CGFloat,
        height: CGFloat,
        offsetY: CGFloat
    ) {
        let width = min(
            665,
            max(
                280,
                size.width - 46
            )
        )

        if size.height < 680 {
            return (
                width,
                max(
                    360,
                    size.height - 20
                ),
                min(
                    31,
                    max(
                        0,
                        size.height * 0.04
                    )
                )
            )
        }

        let height = min(
            696,
            max(
                536,
                size.height * 0.78 - 24
            )
        )

        return (
            width,
            min(
                size.height - 20,
                height
            ),
            31
        )
    }
}
