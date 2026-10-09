import SwiftUI
import UIKit

enum DaySpacePaperTypography {
    static let bodySize: CGFloat = 14
    static let lineHeight: CGFloat = 30

    static let bodyFont = UIFont.systemFont(ofSize: bodySize)

    // Keep the font's natural line box. In TextKit 2, baselineOffset on a
    // fixed-height paragraph changes the line advance and drifts off the rules.
    static var bodyParagraphStyle: NSParagraphStyle {
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = bodyFont.lineHeight
        paragraph.maximumLineHeight = bodyFont.lineHeight
        paragraph.lineSpacing = lineHeight - bodyFont.lineHeight
        return paragraph
    }

    // Share the unused row height equally above and below the text. Together
    // with lineSpacing this gives a centered first row and a 30pt line advance.
    static var bodyInsets: UIEdgeInsets {
        let leading = (lineHeight - bodyFont.lineHeight) / 2
        return UIEdgeInsets(top: leading, left: 0, bottom: leading, right: 0)
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
        textView.textContainerInset = DaySpacePaperTypography.bodyInsets
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
        return [
            .font: DaySpacePaperTypography.bodyFont,
            .foregroundColor: UIColor(
                white: 0.15,
                alpha: 1
            ),
            .paragraphStyle: DaySpacePaperTypography.bodyParagraphStyle,
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
