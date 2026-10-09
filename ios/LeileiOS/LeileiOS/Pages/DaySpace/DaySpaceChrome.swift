import SwiftUI
import UIKit

struct DaySpaceDateNavigationRow: View {
    let selectedDate: String?
    let onPrevious: () -> Void
    let onSelectDate: () -> Void
    let onNext: () -> Void

    var body: some View {
        HStack(spacing: 5) {
            Button(action: onPrevious) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 15, weight: .regular))
                    .frame(width: 32, height: 34)
            }
            .buttonStyle(.plain)
            .disabled(selectedDate == nil)
            .accessibilityLabel("Previous Day")

            Button(action: onSelectDate) {
                Text(
                    selectedDate.map(DaySpaceDate.fullLabel)
                        ?? "Loading…"
                )
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(.secondary)
                .frame(minWidth: 138, minHeight: 34)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(selectedDate == nil)
            .accessibilityLabel("Choose Day Space date")

            Button(action: onNext) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .regular))
                    .frame(width: 32, height: 34)
            }
            .buttonStyle(.plain)
            .disabled(selectedDate == nil)
            .accessibilityLabel("Next Day")
        }
        .frame(maxWidth: .infinity)
    }
}

struct DaySpaceReadingState: View {
    var body: some View {
        GeometryReader { proxy in
            let width = max(280, proxy.size.width)

            ZStack(alignment: .topLeading) {
                DaySpaceSkeletonPaper(width: min(158, width * 0.46), height: 112)
                    .rotationEffect(.degrees(-2.4))
                    .offset(x: 6, y: 18)

                DaySpaceSkeletonPaper(width: min(186, width * 0.55), height: 134)
                    .rotationEffect(.degrees(2.1))
                    .offset(x: max(0, width - min(186, width * 0.55) - 4), y: 128)

                DaySpaceSkeletonPaper(width: min(218, width * 0.64), height: 158)
                    .rotationEffect(.degrees(-1.6))
                    .offset(x: max(0, (width - min(218, width * 0.64)) * 0.3), y: 270)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .frame(height: daySpaceStateHeight)
        .accessibilityLabel("Loading…")
    }
}

private struct DaySpaceSkeletonPaper: View {
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.primary.opacity(0.08))
                .frame(width: width * 0.58, height: 10)

            RoundedRectangle(cornerRadius: 4)
                .fill(Color.primary.opacity(0.06))
                .frame(width: width * 0.78, height: 8)

            RoundedRectangle(cornerRadius: 4)
                .fill(Color.primary.opacity(0.06))
                .frame(width: width * 0.66, height: 8)
        }
        .padding(.horizontal, 14)
        .padding(.top, 15)
        .frame(width: width, height: height, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(Color(.systemBackground))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(Color.primary.opacity(0.08), lineWidth: 1)
        )
        .shadow(
            color: .black.opacity(0.04),
            radius: 10,
            y: 7
        )
    }
}

struct DaySpaceWarning: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
    }
}

struct DaySpacePartialFailure: View {
    let todoFailed: Bool
    var memoryFailed: Bool = false
    var onRetryMemory: () -> Void = {}
    let diaryFailed: Bool
    let onRetryTodo: () -> Void
    let onRetryDiary: () -> Void

    var body: some View {
        VStack(spacing: 6) {
            Text("Unavailable")
                .font(.caption)
            .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                if todoFailed {
                    Button("Retry Todo", action: onRetryTodo)
                }

                if memoryFailed { Button("Retry Memory", action: onRetryMemory) }
                if diaryFailed {
                    Button("Retry Diary", action: onRetryDiary)
                }
            }
            .font(.caption.weight(.medium))
        }
        .frame(maxWidth: .infinity)
    }
}

struct DaySpaceDatePickerSheet: View {
    @Binding var date: Date
    let onDone: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            DatePicker(
                "Date",
                selection: $date,
                displayedComponents: .date
            )
            .datePickerStyle(.graphical)
            .padding()
            .navigationTitle("Choose Date")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onDone()
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
