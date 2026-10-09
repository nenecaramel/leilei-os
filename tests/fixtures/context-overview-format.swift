import Foundation

@main struct ContextFormatChecks {
    static func main() {
        for (value, expected) in [(-10.0, 0.0), (0, 0), (12.5, 0.125), (100, 1), (125, 1)] {
            precondition(ContextOverviewFormat.clampedProgress(value) == expected)
        }
        for (value, expected) in [(0.0, "0%"), (12.4, "12%"), (12.5, "13%"), (-12.5, "-13%"), (120, "120%")] {
            precondition(ContextOverviewFormat.percentText(value) == expected)
        }
        for value in [0.0, 0.4, 0.5, -0.5, 1234567.4, 1234567.5] {
            precondition(ContextOverviewFormat.integerText(value) == Int(value.rounded()).formatted())
        }
        for (input, expected): (String?, String?) in [(nil, nil), ("", nil), (" \n\t ", nil), ("  model\n", "model"), (" a · b ", "a · b"), (" 中文 ", "中文")] {
            precondition(ContextOverviewFormat.normalized(input) == expected)
        }
        print("Context format PASS")
    }
}
