import SwiftUI
import Foundation

struct NativeLivePermissionInteractionCard: View {
    let interaction: NativeLiveRuntimeInteractionSnapshot
    let onResolve:
        (
            NativeLiveRuntimeInteractionSnapshot,
            [String: NativeLiveJSONValue]
        ) async throws -> Void

    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(interaction.permissionTitle)
                    .font(.system(
                        size: 16,
                        weight: .medium
                    ))

                if let tool = interaction.permissionToolName {
                    Text(tool)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let detail = interaction.permissionDetail {
                    Text(detail)
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            HStack(spacing: 10) {
                Button("Deny", role: .destructive) {
                    submit(
                        [
                            "decision": .string("deny"),
                            "message":
                                .string("Denied by user in LeileiOS."),
                            "interrupt": .bool(false),
                        ]
                    )
                }
                .buttonStyle(.bordered)
                .disabled(isSubmitting)

                Button("Allow") {
                    submit(
                        [
                            "decision": .string("allow"),
                        ]
                    )
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSubmitting)
            }
        }
        .padding(14)
        .background(
            Color.primary.opacity(0.055),
            in: RoundedRectangle(
                cornerRadius: 14,
                style: .continuous
            )
        )
    }

    private func submit(
        _ response: [String: NativeLiveJSONValue]
    ) {
        guard !isSubmitting else { return }

        isSubmitting = true
        errorMessage = nil

        Task { @MainActor in
            do {
                try await onResolve(
                    interaction,
                    response
                )
            } catch {
                errorMessage = error.localizedDescription
                isSubmitting = false
            }
        }
    }
}

struct NativeLiveQuestionInteractionCard: View {
    let interaction: NativeLiveRuntimeInteractionSnapshot
    let onResolve:
        (
            NativeLiveRuntimeInteractionSnapshot,
            [String: NativeLiveJSONValue]
        ) async throws -> Void

    @State private var selectedOptions:
        [String: Set<String>] = [:]
    @State private var customAnswers:
        [String: String] = [:]
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        let questions = interaction.questions

        VStack(alignment: .leading, spacing: 16) {
            ForEach(questions) { question in
                VStack(alignment: .leading, spacing: 10) {
                    if let header = question.header {
                        Text(header)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Text(question.text)
                        .font(.system(
                            size: 16,
                            weight: .medium
                        ))

                    if !question.options.isEmpty {
                        VStack(spacing: 7) {
                            ForEach(question.options) { option in
                                Button {
                                    toggle(
                                        option.label,
                                        for: question
                                    )
                                } label: {
                                    HStack(
                                        alignment: .top,
                                        spacing: 10
                                    ) {
                                        Image(
                                            systemName:
                                                isSelected(
                                                    option.label,
                                                    for: question
                                                )
                                                ? (
                                                    question.multiSelect
                                                        ? "checkmark.square.fill"
                                                        : "checkmark.circle.fill"
                                                )
                                                : (
                                                    question.multiSelect
                                                        ? "square"
                                                        : "circle"
                                                )
                                        )
                                        .foregroundStyle(
                                            isSelected(
                                                option.label,
                                                for: question
                                            )
                                                ? Color.accentColor
                                                : Color.secondary
                                        )

                                        VStack(
                                            alignment: .leading,
                                            spacing: 2
                                        ) {
                                            Text(option.label)
                                                .foregroundStyle(.primary)

                                            if let description =
                                                option.description {
                                                Text(description)
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                            }
                                        }

                                        Spacer(minLength: 0)
                                    }
                                    .frame(
                                        maxWidth: .infinity,
                                        alignment: .leading
                                    )
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .disabled(isSubmitting)
                            }
                        }
                    }

                    TextField(
                        question.options.isEmpty
                            ? "Answer"
                            : "Other answer",
                        text: customAnswerBinding(
                            for: question.text
                        ),
                        axis: .vertical
                    )
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
                    .disabled(isSubmitting)
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            HStack(spacing: 10) {
                Button("Cancel") {
                    submit(
                        [
                            "decision": .string("cancel"),
                            "message":
                                .string("User dismissed the question."),
                        ]
                    )
                }
                .buttonStyle(.bordered)
                .disabled(isSubmitting)

                Button("Submit") {
                    submitAnswers()
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    isSubmitting
                        || !canSubmit(questions)
                )
            }
        }
        .padding(14)
        .background(
            Color.primary.opacity(0.055),
            in: RoundedRectangle(
                cornerRadius: 14,
                style: .continuous
            )
        )
    }

    private func isSelected(
        _ option: String,
        for question: NativeLiveRuntimeQuestion
    ) -> Bool {
        selectedOptions[question.text]?.contains(option) == true
    }

    private func toggle(
        _ option: String,
        for question: NativeLiveRuntimeQuestion
    ) {
        customAnswers[question.text] = ""

        if question.multiSelect {
            var selected =
                selectedOptions[question.text] ?? []
            if selected.contains(option) {
                selected.remove(option)
            } else {
                selected.insert(option)
            }
            selectedOptions[question.text] = selected
        } else {
            selectedOptions[question.text] = [option]
        }
    }

    private func customAnswerBinding(
        for question: String
    ) -> Binding<String> {
        Binding(
            get: {
                customAnswers[question] ?? ""
            },
            set: { value in
                customAnswers[question] = value
                if !value.trimmingCharacters(
                    in: .whitespacesAndNewlines
                ).isEmpty {
                    selectedOptions[question] = []
                }
            }
        )
    }

    private func answer(
        for question: NativeLiveRuntimeQuestion
    ) -> String? {
        let custom =
            customAnswers[question.text]?
                .trimmingCharacters(
                    in: .whitespacesAndNewlines
                ) ?? ""
        if !custom.isEmpty {
            return custom
        }

        let selected =
            selectedOptions[question.text] ?? []
        let ordered =
            question.options
                .map(\.label)
                .filter {
                    selected.contains($0)
                }

        guard !ordered.isEmpty else {
            return nil
        }
        return ordered.joined(separator: ", ")
    }

    private func canSubmit(
        _ questions: [NativeLiveRuntimeQuestion]
    ) -> Bool {
        !questions.isEmpty
            && questions.allSatisfy {
                answer(for: $0) != nil
            }
    }

    private func submitAnswers() {
        let questions = interaction.questions
        guard canSubmit(questions) else {
            return
        }

        var answers:
            [String: NativeLiveJSONValue] = [:]
        for question in questions {
            guard let answer = answer(
                for: question
            ) else {
                return
            }
            answers[question.text] = .string(answer)
        }

        submit(
            [
                "decision": .string("answer"),
                "answers": .object(answers),
            ]
        )
    }

    private func submit(
        _ response: [String: NativeLiveJSONValue]
    ) {
        guard !isSubmitting else { return }

        isSubmitting = true
        errorMessage = nil

        Task { @MainActor in
            do {
                try await onResolve(
                    interaction,
                    response
                )
            } catch {
                errorMessage = error.localizedDescription
                isSubmitting = false
            }
        }
    }
}
