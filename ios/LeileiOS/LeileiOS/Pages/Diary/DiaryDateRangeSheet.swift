import SwiftUI
import UIKit

struct DiaryCustomDateRangeSheet: View {
    @Binding var startDate: Date
    @Binding var endDate: Date

    let onApply: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                DatePicker(
                    "Start",
                    selection: $startDate,
                    in: ...endDate,
                    displayedComponents: .date
                )
                .datePickerStyle(.compact)

                DatePicker(
                    "End",
                    selection: $endDate,
                    in: startDate...,
                    displayedComponents: .date
                )
                .datePickerStyle(.compact)
            }
            .navigationTitle("Custom Range")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onApply()
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
