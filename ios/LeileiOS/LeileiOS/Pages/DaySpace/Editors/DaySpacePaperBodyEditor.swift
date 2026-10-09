import SwiftUI
import UIKit

enum DaySpacePaperTypography {
    static let bodySize: CGFloat = 14
    static let lineHeight: CGFloat = 30

    // UIKit places the extra fixed-line leading above the glyphs by default.
    // Raise the baseline by half that leading to center text between rules.
    static var bodyBaselineOffset: CGFloat {
        (lineHeight - UIFont.systemFont(ofSize: bodySize).lineHeight) / 2
    }

    static func layoutHeight(_ height: CGFloat, minimum: CGFloat) -> CGFloat {
        ceil(max(height, minimum) / lineHeight) * lineHeight
    }
}

struct DaySpacePaperBodyEditor: UIViewRepresentable {
    let text: String
    let disabled: Bool
    let onTextChange: (String) -> Void
    var minimumHeight: CGFloat = 420

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(
        context: Context
    ) -> UITextView {
        let textView = UITextView()
        textView.backgroundColor = .clear
        textView.isScrollEnabled = false
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        textView.delegate = context.coordinator
        textView.autocorrectionType = .default
        textView.spellCheckingType = .default
        configureTypingAppearance(
            for: textView
        )
        return textView
    }

    func updateUIView(
        _ textView: UITextView,
        context: Context
    ) {
        context.coordinator.parent = self
        textView.isEditable = !disabled
        configureTypingAppearance(
            for: textView
        )

        guard textView.text != text,
              textView.markedTextRange == nil
        else {
            return
        }

        let selection = textView.selectedRange
        textView.attributedText = attributedText(
            text
        )
        textView.selectedRange = NSRange(
            location: min(
                selection.location,
                text.utf16.count
            ),
            length: 0
        )
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize,
        uiView: UITextView,
        context: Context
    ) -> CGSize? {
        guard let width = proposal.width else {
            return nil
        }

        let fitting = uiView.sizeThatFits(
            CGSize(
                width: width,
                height: .greatestFiniteMagnitude
            )
        )

        return CGSize(
            width: width,
            height: DaySpacePaperTypography.layoutHeight(
                fitting.height,
                minimum: minimumHeight
            )
        )
    }

    private func configureTypingAppearance(
        for textView: UITextView
    ) {
        textView.typingAttributes = textAttributes
    }

    private var textAttributes: [
        NSAttributedString.Key: Any
    ] {
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = DaySpacePaperTypography.lineHeight
        paragraph.maximumLineHeight = DaySpacePaperTypography.lineHeight

        return [
            .font: UIFont.systemFont(
                ofSize: DaySpacePaperTypography.bodySize
            ),
            .foregroundColor: UIColor(
                white: 0.15,
                alpha: 1
            ),
            .paragraphStyle: paragraph,
            .baselineOffset: DaySpacePaperTypography.bodyBaselineOffset,
        ]
    }

    private func attributedText(
        _ value: String
    ) -> NSAttributedString {
        NSAttributedString(
            string: value,
            attributes: textAttributes
        )
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: DaySpacePaperBodyEditor

        init(
            parent: DaySpacePaperBodyEditor
        ) {
            self.parent = parent
        }

        func textViewDidChange(
            _ textView: UITextView
        ) {
            parent.onTextChange(
                textView.text
            )
            textView.invalidateIntrinsicContentSize()
        }
    }
}
