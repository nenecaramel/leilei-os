import SwiftUI
import UIKit

struct DaySpaceTodoLineEditor: UIViewRepresentable {
    let text: String
    let kind: DaySpaceTodoEntryKind
    let rowID: String
    let focusRequest: DaySpaceTodoFocusRequest?
    let onTextChange: (String) -> Void
    let onSplit: (NSRange) -> Bool
    let onMergePrevious: () -> Bool
    let onMergeNext: () -> Bool
    let onMovePrevious: () -> Bool
    let onMoveNext: () -> Bool
    let onPasteMultiline: (NSRange, String) -> Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(
        context: Context
    ) -> DaySpaceTodoNativeTextView {
        let textView = DaySpaceTodoNativeTextView()
        textView.backgroundColor = .clear
        textView.isScrollEnabled = false
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        textView.delegate = context.coordinator
        textView.autocorrectionType = .default
        textView.spellCheckingType = .default
        textView.smartQuotesType = .default
        textView.smartDashesType = .default
        textView.returnKeyType = .default
        textView.setContentCompressionResistancePriority(
            .required,
            for: .vertical
        )
        textView.setContentHuggingPriority(
            .required,
            for: .vertical
        )
        wire(
            textView,
            coordinator: context.coordinator
        )
        applyAppearance(
            to: textView,
            coordinator: context.coordinator
        )
        return textView
    }

    func updateUIView(
        _ textView: DaySpaceTodoNativeTextView,
        context: Context
    ) {
        context.coordinator.parent = self
        wire(
            textView,
            coordinator: context.coordinator
        )
        applyAppearance(
            to: textView,
            coordinator: context.coordinator
        )

        guard let focusRequest,
              focusRequest.rowID == rowID,
              context.coordinator.lastFocusToken
                != focusRequest.token
        else {
            return
        }

        context.coordinator.lastFocusToken =
            focusRequest.token

        let offset = max(
            0,
            min(
                focusRequest.offset,
                text.utf16.count
            )
        )

        DispatchQueue.main.async {
            textView.becomeFirstResponder()
            textView.selectedRange = NSRange(
                location: offset,
                length: 0
            )
        }
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize,
        uiView: DaySpaceTodoNativeTextView,
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
            height: max(
                30,
                ceil(fitting.height)
            )
        )
    }

    private func wire(
        _ textView: DaySpaceTodoNativeTextView,
        coordinator: Coordinator
    ) {
        textView.onBackspaceAtStart = {
            coordinator.parent.onMergePrevious()
        }
        textView.onDeleteForwardAtEnd = {
            coordinator.parent.onMergeNext()
        }
        textView.onMovePrevious = {
            coordinator.parent.onMovePrevious()
        }
        textView.onMoveNext = {
            coordinator.parent.onMoveNext()
        }
        textView.onPasteMultiline = {
            range,
            value in
            coordinator.parent.onPasteMultiline(
                range,
                value
            )
        }
    }

    private func applyAppearance(
        to textView: DaySpaceTodoNativeTextView,
        coordinator: Coordinator
    ) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = 30
        paragraph.maximumLineHeight = 30

        let textColor: UIColor = kind == .completed
            ? UIColor(
                white: 0.56,
                alpha: 1
            )
            : UIColor(
                white: 0.09,
                alpha: 1
            )

        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(
                ofSize: 14
            ),
            .foregroundColor: textColor,
            .paragraphStyle: paragraph,
            .strikethroughStyle: kind == .completed
                ? NSUnderlineStyle.single.rawValue
                : 0,
        ]

        if textView.text != text
            || coordinator.lastKind != kind {
            let selection = textView.selectedRange
            textView.attributedText = NSAttributedString(
                string: text,
                attributes: attributes
            )
            textView.selectedRange = NSRange(
                location: min(
                    selection.location,
                    text.utf16.count
                ),
                length: 0
            )
        }

        textView.typingAttributes = attributes
        coordinator.lastKind = kind
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: DaySpaceTodoLineEditor
        var lastFocusToken: UUID?
        var lastKind: DaySpaceTodoEntryKind?

        init(
            parent: DaySpaceTodoLineEditor
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

        func textView(
            _ textView: UITextView,
            shouldChangeTextIn range: NSRange,
            replacementText value: String
        ) -> Bool {
            guard value == "\n",
                  textView.markedTextRange == nil
            else {
                return true
            }

            if let native = textView
                as? DaySpaceTodoNativeTextView,
               native.consumeShiftReturn() {
                return true
            }

            return !parent.onSplit(range)
        }
    }
}

final class DaySpaceTodoNativeTextView: UITextView {
    var onBackspaceAtStart: (() -> Bool)?
    var onDeleteForwardAtEnd: (() -> Bool)?
    var onMovePrevious: (() -> Bool)?
    var onMoveNext: (() -> Bool)?
    var onPasteMultiline: ((NSRange, String) -> Bool)?

    private var shiftReturnPending = false

    override func deleteBackward() {
        if selectedRange.length == 0,
           selectedRange.location == 0,
           onBackspaceAtStart?() == true {
            return
        }

        super.deleteBackward()
    }

    override func paste(
        _ sender: Any?
    ) {
        if let value = UIPasteboard.general.string,
           (value.contains("\n")
                || value.contains("\r")),
           onPasteMultiline?(
                selectedRange,
                value
           ) == true {
            return
        }

        super.paste(sender)
    }

    override func pressesBegan(
        _ presses: Set<UIPress>,
        with event: UIPressesEvent?
    ) {
        guard let key = presses.first?.key else {
            super.pressesBegan(
                presses,
                with: event
            )
            return
        }

        let textLength = text.utf16.count
        let collapsed = selectedRange.length == 0

        if key.keyCode == .keyboardReturn,
           key.modifierFlags.contains(.shift) {
            shiftReturnPending = true
            super.pressesBegan(
                presses,
                with: event
            )
            return
        }

        if key.keyCode == .keyboardDeleteForward,
           collapsed,
           selectedRange.location == textLength,
           onDeleteForwardAtEnd?() == true {
            return
        }

        if key.keyCode == .keyboardLeftArrow,
           collapsed,
           selectedRange.location == 0,
           onMovePrevious?() == true {
            return
        }

        if key.keyCode == .keyboardRightArrow,
           collapsed,
           selectedRange.location == textLength,
           onMoveNext?() == true {
            return
        }

        if key.keyCode == .keyboardUpArrow,
           collapsed,
           selectedRange.location == 0,
           onMovePrevious?() == true {
            return
        }

        if key.keyCode == .keyboardDownArrow,
           collapsed,
           selectedRange.location == textLength,
           onMoveNext?() == true {
            return
        }

        super.pressesBegan(
            presses,
            with: event
        )
    }

    func consumeShiftReturn() -> Bool {
        defer {
            shiftReturnPending = false
        }

        return shiftReturnPending
    }
}
