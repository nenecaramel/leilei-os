import SwiftUI

struct PixelCrabView: View {
    let size: CGFloat

    private let rows = [
        "00010001000",
        "00110001100",
        "01111111110",
        "11111111111",
        "11011111011",
        "11111111111",
        "01111111110",
        "00110001100",
        "01000000010"
    ]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(
                Array(rows.enumerated()),
                id: \.offset
            ) { rowIndex, row in

                HStack(spacing: 0) {
                    ForEach(
                        Array(Array(row).enumerated()),
                        id: \.offset
                    ) { columnIndex, value in

                        pixel(
                            row: rowIndex,
                            column: columnIndex,
                            value: value
                        )
                        .frame(
                            width: size,
                            height: size
                        )
                    }
                }
            }
        }
        .drawingGroup()
        .accessibilityLabel("Claude Code")
    }

    @ViewBuilder
    private func pixel(
        row: Int,
        column: Int,
        value: Character
    ) -> some View {
        if isEye(row: row, column: column) {
            Rectangle()
                .fill(Color.black.opacity(0.80))
        } else if value == "1" {
            Rectangle()
                .fill(
                    Color(
                        red: 0.91,
                        green: 0.38,
                        blue: 0.20
                    )
                )
        } else {
            Color.clear
        }
    }

    private func isEye(
        row: Int,
        column: Int
    ) -> Bool {
        row == 3 &&
        (column == 3 || column == 7)
    }
}
