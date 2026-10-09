import Foundation

nonisolated func normalizedEnvironmentValues(_ values: [String]) -> [String] {
    values.compactMap(ContextOverviewFormat.normalized)
}

nonisolated func normalizedEnvironmentValue(_ value: String?) -> String? {
    ContextOverviewFormat.normalized(value)
}

@main
struct ContextIsolationCheck {
    static func main() {
        precondition(normalizedEnvironmentValues(["  first  ", "", " \n ", "second"]) == ["first", "second"])
        precondition(normalizedEnvironmentValue(nil) == nil)
        precondition(normalizedEnvironmentValue(" \ntrimmed\t ") == "trimmed")
        print("Context isolation PASS")
    }
}
