import SwiftUI

struct MindDateFilter: View {
    @Environment(\.dismiss) private var dismiss
    @State private var date: Date
    let onApply: (String) -> Void

    init(selectedDate: String?, onApply: @escaping (String) -> Void) {
        _date = State(initialValue: MindPresentation.filterDayDate(selectedDate))
        self.onApply = onApply
    }

    var body: some View {
        NavigationStack {
            DatePicker("Date", selection: $date, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .environment(\.timeZone, TimeZone(identifier: "Asia/Shanghai")!)
                .padding()
                .navigationTitle("Filter Date")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Apply") {
                            onApply(MindPresentation.filterDayKey(date))
                            dismiss()
                        }
                    }
                }
        }
        .presentationDetents([.medium, .large])
    }
}
